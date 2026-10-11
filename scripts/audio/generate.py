"""Generate word + example-sentence audio with ElevenLabs, QC every clip, write the manifest.

  python scripts/audio/generate.py --dry-run          # plan + worst-case credit cost, no API calls
  python scripts/audio/generate.py                    # full run (resumable; re-run any time)
  python scripts/audio/generate.py --limit 50 --words-only
  python scripts/audio/generate.py --only w4f60,w662f --force

For each Word in src/data/words.json (rank order, most common first):
  word clip    -> public/audio/w/<id>.mp3   (text: Word.trad)
  example clip -> public/audio/s/<id>.mp3   (text: Word.example.trad)
then writes src/data/audio-manifest.json (AudioManifest; paths like "audio/w/<id>.mp3").

Resumable/idempotent: scripts/audio/state.json records, per clip, the hash of (text, model chain,
voice settings, voice), every attempt's seed/model/cost/QC result, and the chosen attempt. A clip is
skipped when its hash is unchanged, its mp3 exists, and it either passed QC or already used all its
attempts (use --retry-flagged to give flagged clips more attempts).

QC (qc.py) runs on every attempt. On fail/suspect the clip is regenerated with a new seed (max 2
extra attempts; the last one uses the fallback model), the best-scoring attempt is kept, and clips
that never pass are listed in scripts/audio/flags.json for human review.

Credits: a hard budget (--max-credits) is enforced using the per-request 'character-cost' header
(falls back to the worst-case estimate), the subscription endpoint is checked before and during the
run, and --reserve credits are always left on the account.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as C  # noqa: E402

DEFAULT_MODEL = "eleven_v4"
DEFAULT_FALLBACK = "eleven_flash_v2_5"
PIPELINE_VERSION = 1  # bump when trimming/encoding changes in a way that should regenerate audio
VERDICT_RANK = {"pass": 3, "unchecked": 2, "suspect": 1, "fail": 0}

DEFAULT_WORDS = C.ROOT / "src" / "data" / "words.json"
DEFAULT_MANIFEST = C.ROOT / "src" / "data" / "audio-manifest.json"
DEFAULT_OUT = C.ROOT / "public" / "audio"
DEFAULT_STATE = C.AUDIO_DIR / "state.json"
DEFAULT_FLAGS = C.AUDIO_DIR / "flags.json"
DEFAULT_CACHE = C.AUDIO_DIR / "cache"
OVERRIDES = C.AUDIO_DIR / "overrides.json"


# ------------------------------------------------------------------------------------------------
# Jobs
# ------------------------------------------------------------------------------------------------

@dataclass
class Clip:
    key: str  # "w/<id>" or "s/<id>"
    word_id: str
    kind: str  # "word" | "sentence"
    text: str  # what the clip should say (QC reference)
    tts_text: str  # what we send to the API (normally == text; see overrides.json)
    pinyin: str = ""  # pinyinNumbered for words
    spoken_as: str | None = None
    rank: int = 0
    models: list[str] = field(default_factory=list)
    settings: dict[str, Any] = field(default_factory=dict)

    @property
    def rel_path(self) -> str:
        sub = "w" if self.kind == "word" else "s"
        return f"audio/{sub}/{self.word_id}.mp3"

    def hash(self) -> str:
        return C.sha1({
            "text": self.tts_text, "models": self.models, "settings": self.settings, "voice": C.VOICE_ID,
            "fmt": [C.PCM_FORMAT, C.MP3_BITRATE], "v": PIPELINE_VERSION,
        })


def build_clips(words: list[dict], args) -> list[Clip]:
    overrides = C.load_json(Path(args.overrides), {})
    models = [args.model] + ([args.fallback_model] if args.fallback_model not in ("", "none", args.model) else [])
    only = set(args.only.split(",")) if args.only else None
    clips: list[Clip] = []
    ws = sorted(words, key=lambda w: w["rank"])
    if only:
        ws = [w for w in ws if w["id"] in only]
    if args.limit:
        ws = ws[: args.limit]
    for w in ws:
        ov = overrides.get(w["id"], {})
        if not args.examples_only:
            clips.append(Clip(
                key=f"w/{w['id']}", word_id=w["id"], kind="word", text=w["trad"],
                tts_text=ov.get("wordText", w["trad"]), pinyin=w["pinyinNumbered"],
                spoken_as=w.get("spokenAs"), rank=w["rank"], models=models,
                settings=C.voice_settings("word", args.model, args.word_speed),
            ))
        ex = (w.get("example") or {}).get("trad")
        if ex and not args.words_only:
            clips.append(Clip(
                key=f"s/{w['id']}", word_id=w["id"], kind="sentence", text=ex,
                tts_text=ov.get("exampleText", ex), pinyin=w["example"].get("pinyin", ""), rank=w["rank"],
                models=models,
                settings=C.voice_settings("sentence", args.model, args.sentence_speed),
            ))
    return clips


# ------------------------------------------------------------------------------------------------
# Budget
# ------------------------------------------------------------------------------------------------

class BudgetExceeded(Exception):
    pass


class Budget:
    """Tracks credits spent in this run. Reservations use the worst-case estimate; commits use the
    'character-cost' header when present. The subscription endpoint is re-checked periodically."""

    def __init__(self, client: C.ElevenClient | None, max_credits: float, reserve: float,
                 max_retry_credits: float, check_every: int = 40):
        self.client = client
        self.max_credits = max_credits
        self.reserve = reserve
        self.max_retry_credits = max_retry_credits
        self.spent = 0.0
        self.retry_spent = 0.0
        self.pending = 0.0
        self.requests = 0
        self.check_every = check_every
        self.lock = threading.Lock()
        self.stopped: str | None = None
        self.account_remaining: float | None = None
        self.initial_remaining = 0.0
        self.account_baseline = 0.0
        if client:
            self.refresh()

    def refresh(self) -> None:
        used, limit, remaining = self.client.remaining_credits()
        self.account_used, self.account_limit = used, limit
        if self.account_remaining is None:
            self.initial_remaining = float(remaining)
        self.account_remaining = float(remaining)
        self.account_baseline = self.spent

    def headroom(self) -> float:
        h = self.max_credits - self.spent - self.pending
        if self.account_remaining is not None:
            # The balance endpoint lags by a few minutes, so take the tighter of: balance at start minus
            # everything spent since, and latest balance minus what was spent after that check.
            acct = min(self.initial_remaining - self.spent,
                       self.account_remaining - (self.spent - self.account_baseline))
            h = min(h, acct - self.pending - self.reserve)
        return h

    def reserve_for(self, est: float, is_retry: bool) -> None:
        with self.lock:
            if self.stopped:
                raise BudgetExceeded(self.stopped)
            if is_retry and self.retry_spent + est > self.max_retry_credits:
                raise BudgetExceeded("retry credit cap reached")
            if est > self.headroom():
                self.stopped = (f"credit budget reached (spent {self.spent:.0f}, max {self.max_credits:.0f}, "
                                f"reserve {self.reserve:.0f})")
                raise BudgetExceeded(self.stopped)
            self.pending += est

    def commit(self, est: float, actual: float | None, is_retry: bool) -> None:
        with self.lock:
            self.pending -= est
            cost = est if actual is None else actual
            self.spent += cost
            if is_retry:
                self.retry_spent += cost
            self.requests += 1
            need_refresh = self.client is not None and self.requests % self.check_every == 0
        if need_refresh:
            try:
                with self.lock:
                    self.refresh()
            except Exception as e:  # a failed balance check is not fatal; header accounting continues
                print(f"[budget] subscription check failed: {e}", file=sys.stderr)

    def release(self, est: float) -> None:
        with self.lock:
            self.pending -= est


# ------------------------------------------------------------------------------------------------
# Audio post-processing
# ------------------------------------------------------------------------------------------------

def normalize_loudness(x: np.ndarray, sr: int, target_dbfs: float = -20.0, peak_dbfs: float = -1.0) -> np.ndarray:
    """Scale so the RMS of the active (non-silent) part is target_dbfs, without exceeding peak_dbfs."""
    hop = int(sr * 0.01)
    n = len(x) // hop
    if n < 3:
        return x
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop).astype(np.float64) ** 2, axis=1) + 1e-12)
    active = rms[rms > rms.max() * 10 ** (-30 / 20)]
    if active.size == 0:
        return x
    cur = 20 * np.log10(np.sqrt(np.mean(active ** 2)))
    gain = 10 ** ((target_dbfs - cur) / 20)
    peak = float(np.max(np.abs(x))) or 1.0
    gain = min(gain, 10 ** (peak_dbfs / 20) / peak)
    return (x * gain).astype(np.float32)


def postprocess(pcm: bytes) -> tuple[np.ndarray, np.ndarray, dict]:
    raw = C.pcm_to_float(pcm)
    x, info = C.trim_silence(raw, C.PCM_RATE)
    x = normalize_loudness(x, C.PCM_RATE)
    return raw, x, info


# ------------------------------------------------------------------------------------------------
# Runner
# ------------------------------------------------------------------------------------------------

class Runner:
    def __init__(self, args, clips: list[Clip]):
        self.args = args
        self.clips = clips
        self.out_dir = Path(args.out_dir)
        self.cache_dir = Path(args.cache_dir)
        self.state_path = Path(args.state)
        self.state = C.load_json(self.state_path, {"version": 1, "clips": {}})
        self.state_lock = threading.Lock()
        self.qc_lock = threading.Lock()
        self.client: C.ElevenClient | None = None
        self.budget: Budget | None = None
        self.qc = None
        self.sem = threading.Semaphore(args.concurrency)
        self.stats = {"generated": 0, "skipped": 0, "pass": 0, "suspect": 0, "fail": 0, "unchecked": 0,
                      "errors": 0, "budget_stopped": 0, "requests": 0}
        self.stats_lock = threading.Lock()
        self.last_save = 0.0

    # ---------------- planning ----------------
    def needs_work(self, clip: Clip) -> bool:
        rec = self.state["clips"].get(clip.key)
        if self.args.force or rec is None:
            return True
        if rec.get("hash") != clip.hash() or not (self.out_dir / clip.rel_path.split("/", 1)[1]).exists():
            return True
        if rec.get("verdict") == "pass":
            return False
        if self.args.retry_flagged:
            return True
        return not rec.get("done", False)

    def plan(self) -> list[Clip]:
        return [c for c in self.clips if self.needs_work(c)]

    # ---------------- per clip ----------------
    def _bump(self, k: str, n: int = 1) -> None:
        with self.stats_lock:
            self.stats[k] += n

    def save_state(self, force: bool = False) -> None:
        with self.state_lock:
            if not force and time.time() - self.last_save < 5:
                return
            C.write_json_atomic(self.state_path, self.state)
            self.last_save = time.time()

    def run_qc(self, clip: Clip, x: np.ndarray) -> dict[str, Any]:
        if self.qc is None:
            return {"verdict": "unchecked", "score": 0.5, "reasons": []}
        with self.qc_lock:
            if clip.kind == "word":
                rep = self.qc.check_word(x, C.PCM_RATE, clip.text, clip.pinyin, clip.spoken_as)
            else:
                rep = self.qc.check_sentence(x, C.PCM_RATE, clip.text, clip.pinyin or None)
        return rep

    def process(self, clip: Clip) -> None:
        args = self.args
        with self.state_lock:
            prev = self.state["clips"].get(clip.key)
            same = prev is not None and prev.get("hash") == clip.hash() and not args.force
            attempts: list[dict] = list(prev.get("attempts", [])) if same else []
        n_prev = len(attempts)
        max_total = n_prev + 1 + args.max_retries if (same and args.retry_flagged) else 1 + args.max_retries
        best: dict | None = None
        for a in attempts:
            if a.get("cache") and (self.cache_dir / a["cache"]).exists() and (best is None or self._better(a, best)):
                best = a
        while len(attempts) < max_total:
            idx = len(attempts)
            # The last allowed attempt switches to the fallback model (if any).
            model = clip.models[-1] if (len(clip.models) > 1 and idx == max_total - 1 and idx > 0) else clip.models[0]
            seed = C.stable_seed(clip.key, idx)
            settings = dict(clip.settings)
            if model != clip.models[0]:
                settings = C.voice_settings(clip.kind, model, settings.get("speed"))
            est = C.estimate_cost(clip.tts_text, model)
            is_retry = idx > 0
            try:
                self.budget.reserve_for(est, is_retry)
            except BudgetExceeded as e:
                self._bump("budget_stopped")
                if best is None:
                    return
                print(f"  [{clip.key}] stop retrying: {e}")
                break
            try:
                with self.sem:
                    res = self.client.tts(clip.tts_text, model, settings, seed=seed)
                self.budget.commit(est, res.cost, is_retry)
            except C.QuotaExceeded as e:
                self.budget.release(est)
                self.budget.stopped = f"account quota exceeded: {e}"
                self._bump("errors")
                break
            except Exception as e:
                self.budget.release(est)
                print(f"  [{clip.key}] API error: {str(e)[:200]}")
                self._bump("errors")
                break
            self._bump("requests")
            if len(res.pcm) < int(0.05 * C.PCM_RATE) * 2:  # < 50 ms of audio: count as a failed attempt
                attempts.append({"i": idx, "model": model, "seed": seed, "settings": settings, "cost": res.cost,
                                 "verdict": "fail", "score": -1, "reasons": ["empty audio"], "cache": None})
                print(f"  fail    {clip.key:22s} #{idx} {model:22s} empty audio")
                continue
            raw, x, trim = postprocess(res.pcm)
            cache_file = self.cache_dir / clip.key.replace("/", "_") / f"{idx}_{model}_{seed}.flac"
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_bytes(C.encode_flac(raw))
            mp3 = C.encode_mp3(x)
            mp3_cache = cache_file.with_suffix(".mp3")
            mp3_cache.write_bytes(mp3)
            try:
                rep = self.run_qc(clip, C.decode_audio(mp3, sr=C.PCM_RATE))
            except Exception as e:
                traceback.print_exc()
                rep = {"verdict": "unchecked", "score": 0.5, "reasons": [f"QC error: {e}"]}
            attempt = {
                "i": idx, "model": model, "seed": seed, "settings": settings, "cost": res.cost,
                "requestId": res.request_id, "verdict": rep["verdict"], "score": rep.get("score"),
                "reasons": rep.get("reasons", []), "transcript": (rep.get("asr") or {}).get("transcript"),
                "asr": (rep.get("asr") or {}).get("status"), "pitch": (rep.get("pitch") or {}).get("status"),
                "duration": round(len(x) / C.PCM_RATE, 3), "trim": {k: round(v) for k, v in trim.items()},
                "cache": str(mp3_cache.relative_to(self.cache_dir)).replace("\\", "/"),
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
            attempts.append(attempt)
            if best is None or self._better(attempt, best):
                best = attempt
            tag = f"{rep['verdict']:7s}"
            extra = "" if rep["verdict"] == "pass" else " | " + "; ".join(rep.get("reasons", []))[:200]
            print(f"  {tag} {clip.key:22s} #{idx} {model:22s} {clip.text[:20]}{extra}")
            if rep["verdict"] in ("pass", "unchecked") or rep["verdict"] not in args.regen_on:
                break
        if best is None:
            return
        # Install the best attempt.
        src = self.cache_dir / best["cache"]
        dst = self.out_dir / clip.rel_path.split("/", 1)[1]
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(".mp3.tmp")
        shutil.copyfile(src, tmp)
        tmp.replace(dst)
        done = len(attempts) >= max_total or best["verdict"] in ("pass", "unchecked") \
            or best["verdict"] not in args.regen_on
        rec = {
            "key": clip.key, "id": clip.word_id, "kind": clip.kind, "rank": clip.rank, "text": clip.text,
            "ttsText": clip.tts_text, "pinyin": clip.pinyin or None, "hash": clip.hash(),
            "textHash": C.sha1(clip.text), "path": clip.rel_path, "best": best["i"], "model": best["model"],
            "seed": best["seed"], "verdict": best["verdict"], "score": best["score"],
            "reasons": best["reasons"], "transcript": best["transcript"], "done": done, "attempts": attempts,
        }
        with self.state_lock:
            self.state["clips"][clip.key] = rec
        self._bump("generated")
        self._bump(best["verdict"])
        self.save_state()

    @staticmethod
    def _better(a: dict, b: dict) -> bool:
        ka = (VERDICT_RANK.get(a["verdict"], 0), a.get("score") or 0)
        kb = (VERDICT_RANK.get(b["verdict"], 0), b.get("score") or 0)
        return ka > kb

    # ---------------- outputs ----------------
    def write_outputs(self, words: list[dict]) -> None:
        args = self.args
        entries: dict[str, dict[str, str]] = {}
        flags = []
        for w in sorted(words, key=lambda w: w["rank"]):
            e: dict[str, str] = {}
            for kind, sub, text in (("word", "w", w["trad"]), ("example", "s", (w.get("example") or {}).get("trad"))):
                rec = self.state["clips"].get(f"{sub}/{w['id']}")
                if not rec or not text or rec.get("textHash") != C.sha1(text):
                    continue  # missing or stale (text changed since generation): app falls back to TTS
                if not (self.out_dir / sub / f"{w['id']}.mp3").exists():
                    continue
                e[kind] = rec["path"]
                if rec.get("verdict") not in ("pass", "unchecked"):
                    flags.append({
                        "key": rec["key"], "id": w["id"], "rank": w["rank"], "kind": rec["kind"], "text": text,
                        "expectedPinyin": w["pinyin"] if kind == "word" else w["example"].get("pinyin"),
                        "verdict": rec["verdict"], "transcript": rec.get("transcript"),
                        "reasons": rec.get("reasons", []), "model": rec.get("model"),
                        "attempts": len(rec.get("attempts", [])), "path": rec["path"],
                    })
            if e:
                entries[w["id"]] = e
        manifest = {"voiceId": C.VOICE_ID, "model": args.model,
                    "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "entries": entries}
        C.write_json_atomic(Path(args.manifest), manifest)
        C.write_json_atomic(Path(args.flags), flags)
        print(f"manifest: {len(entries)} words with audio -> {args.manifest}")
        print(f"flags: {len(flags)} clips for human review -> {args.flags}")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--words", default=str(DEFAULT_WORDS))
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT), help="audio root (contains w/ and s/)")
    ap.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    ap.add_argument("--state", default=str(DEFAULT_STATE))
    ap.add_argument("--flags", default=str(DEFAULT_FLAGS))
    ap.add_argument("--cache-dir", default=str(DEFAULT_CACHE), help="raw FLAC + mp3 of every attempt (gitignored)")
    ap.add_argument("--overrides", default=str(OVERRIDES),
                    help="JSON {wordId: {wordText?, exampleText?}}: alternative TTS input text (e.g. homophones for polyphones)")
    ap.add_argument("--limit", type=int, default=0, help="only the first N words by rank")
    ap.add_argument("--only", default="", help="comma-separated word ids")
    ap.add_argument("--words-only", action="store_true")
    ap.add_argument("--examples-only", action="store_true")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--fallback-model", default=DEFAULT_FALLBACK,
                    help="model for the last retry of a clip that keeps failing QC ('none' to disable)")
    ap.add_argument("--word-speed", type=float, default=0.9)
    ap.add_argument("--sentence-speed", type=float, default=0.95)
    ap.add_argument("--force", action="store_true", help="regenerate even if up to date")
    ap.add_argument("--retry-flagged", action="store_true", help="give non-passing clips more attempts")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and credit cost; no API calls")
    ap.add_argument("--max-credits", type=float, default=15000, help="hard cap on credits spent by this run")
    ap.add_argument("--reserve", type=float, default=2000, help="credits always left on the account")
    ap.add_argument("--max-retries", type=int, default=2, help="extra attempts per clip on QC failure")
    ap.add_argument("--max-retry-credits", type=float, default=3000, help="cap on credits spent on retries")
    ap.add_argument("--regen-on", default="fail,suspect", help="QC verdicts that trigger regeneration")
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--no-qc", action="store_true")
    ap.add_argument("--whisper", default="auto", help="faster-whisper model; auto = large-v3 on CUDA, small on CPU")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--manifest-only", action="store_true", help="just rebuild manifest + flags from state")
    args = ap.parse_args()
    args.regen_on = set(v.strip() for v in args.regen_on.split(",") if v.strip())

    words = C.load_json(Path(args.words), [])
    if not words:
        raise SystemExit(f"no words in {args.words}")
    clips = build_clips(words, args)
    runner = Runner(args, clips)
    if args.manifest_only:
        runner.write_outputs(words)
        return
    todo = runner.plan()
    chars = sum(len(c.tts_text) for c in todo)
    est = sum(C.estimate_cost(c.tts_text, args.model) for c in todo)
    n_w = sum(1 for c in todo if c.kind == "word")
    print(f"{len(clips)} clips selected, {len(todo)} need generation ({n_w} words, {len(todo) - n_w} sentences), "
          f"{chars} characters")
    print(f"worst-case cost of first attempts: {est:.0f} credits ({args.model}, per-character estimate); "
          f"retries add at most --max-retry-credits {args.max_retry_credits:.0f}")
    print("note: the actual 'character-cost' ElevenLabs bills for short Chinese clips has been far below the "
          "per-character estimate (see scripts/audio/NOTES.md); the estimate is an upper bound")
    if args.dry_run:
        for c in todo[:10]:
            print(f"  {c.key:22s} rank {c.rank:4d}  {c.tts_text}")
        if len(todo) > 10:
            print(f"  ... {len(todo) - 10} more")
        return

    runner.client = C.ElevenClient()
    runner.budget = Budget(runner.client, args.max_credits, args.reserve, args.max_retry_credits)
    b = runner.budget
    print(f"account: used {b.account_used}/{b.account_limit}, remaining {b.account_remaining:.0f}, "
          f"reserve {args.reserve:.0f}, run budget {args.max_credits:.0f}")
    if b.headroom() <= 0:
        raise SystemExit("no credit headroom (check --max-credits / --reserve)")

    if todo and not args.no_qc:
        import qc as QCmod

        t = time.time()
        runner.qc = QCmod.QC(whisper_model=args.whisper, device=args.device)
        print(f"QC: faster-whisper {runner.qc.asr.model_name} on {runner.qc.asr.device} "
              f"(loaded in {time.time() - t:.0f}s)")

    t0 = time.time()
    try:
        with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            futs = [ex.submit(runner.process, c) for c in todo]
            cancelled = False
            for i, f in enumerate(as_completed(futs), 1):
                try:
                    f.result()
                except Exception:
                    traceback.print_exc()
                    runner._bump("errors")
                if i % 50 == 0:
                    el = time.time() - t0
                    print(f"[progress] {i}/{len(todo)} clips, {el / 60:.1f} min, credits spent {b.spent:.0f}")
                if b.stopped and not cancelled:
                    cancelled = True
                    for g in futs:
                        g.cancel()
    except KeyboardInterrupt:
        print("interrupted; saving state")
    finally:
        runner.save_state(force=True)
        runner.write_outputs(words)
    if runner.client and runner.client.max_concurrency and runner.client.max_concurrency < args.concurrency:
        print(f"note: account allows only {runner.client.max_concurrency} concurrent requests")
    try:
        used, limit, remaining = runner.client.remaining_credits()
        acct = f"account now {used}/{limit} (may lag a few minutes)"
    except Exception:
        acct = ""
    s = runner.stats
    print(f"done in {(time.time() - t0) / 60:.1f} min: {s['generated']} clips written "
          f"(pass {s['pass']}, suspect {s['suspect']}, fail {s['fail']}, unchecked {s['unchecked']}), "
          f"{s['requests']} API requests, {s['errors']} errors; credits spent {b.spent:.0f} "
          f"(retries {b.retry_spent:.0f}). {acct}")
    if b.stopped:
        print(f"STOPPED EARLY: {b.stopped}. Re-run the same command later to continue.")


if __name__ == "__main__":
    main()
