"""Automatic quality control for generated clips.

(a) ASR: faster-whisper transcribes the clip (language zh). Text is compared after normalization
    (OpenCC t2s, punctuation stripped). Single words are compared on tone-marked pinyin, so
    homophones pass but a wrong syllable or tone does not.
(b) Pitch (words only): praat-parselmouth F0 contour -> per-syllable tone-shape scores vs. the
    expected citation tones, allowing 3rd-tone sandhi, 不/一 sandhi, neutral tones and low/creaky 3rd
    tones without the final rise.

Verdict: pass / suspect / fail with human-readable reasons. Thresholds are deliberately lenient
(a false fail costs credits): only clear evidence (ASR hears different syllables, or ASR hears a
different tone AND the contour disagrees) produces "fail".

CLI:
  python scripts/audio/qc.py FILE.mp3 --word 知道 --pinyin "zhi1 dao4"
  python scripts/audio/qc.py FILE.mp3 --sentence 你知道他住哪裡嗎？
  python scripts/audio/qc.py --all [--words src/data/words.json] [--audio-dir public/audio]
"""

from __future__ import annotations

import argparse
import math
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as C  # noqa: E402

DEFAULT_WHISPER = "auto"  # large-v3 on CUDA, small on CPU (see NOTES.md)
AUTO_MODEL = {"cuda": "large-v3", "cpu": "small"}

# ------------------------------------------------------------------------------------------------
# Speaker register for the pitch classifier, in semitones re 100 Hz. Calibrated on the bake-off
# clips of voice 9lHjugDhwqoxA5MhX0az (see NOTES.md). MID is roughly the boundary between "high"
# (tone 1 / start of tone 4) and "low" (tone 3) for this voice.
# ------------------------------------------------------------------------------------------------
VOICE_MID_ST = 13.5


# ================================================================================================
# Pitch analysis
# ================================================================================================

@dataclass
class Syllable:
    t0: float
    t1: float
    st: np.ndarray  # semitone values (voiced frames only) in the syllable core
    creak: bool = False

    def features(self) -> dict[str, float]:
        v = self.st
        n = len(v)
        q = max(1, n // 4)
        start = float(np.median(v[:q]))
        end = float(np.median(v[-q:]))
        imin = int(np.argmin(v))
        return {
            "dur": round(self.t1 - self.t0, 3),
            "start": round(start, 2),
            "end": round(end, 2),
            "mean": round(float(np.mean(v)), 2),
            "min": round(float(np.min(v)), 2),
            "max": round(float(np.max(v)), 2),
            "pos_min": round(imin / max(1, n - 1), 2),
            "creak": self.creak,
        }


def _sig(x: float, k: float = 1.5) -> float:
    """Smooth step: 0 at x << 0, 0.5 at 0, 1 at x >> 0 (k = steepness per semitone)."""
    return 1.0 / (1.0 + math.exp(-k * x))


def tone_scores(f: dict[str, float], mid: float = VOICE_MID_ST) -> dict[int, float]:
    """Compatibility (0..1) of a syllable's contour with each citation tone.

    Lenient by design: scores express "this contour could plausibly be tone T", not a hard
    classification. Semitone thresholds were calibrated on bake-off clips (NOTES.md).
    """
    s, e, mn, mx, mean, pmin = f["start"], f["end"], f["min"], f["max"], f["mean"], f["pos_min"]
    d = e - s
    rise_from_min = e - mn
    fall_to_min = s - mn
    level_range = mx - mn
    high = mean - mid  # >0 means high register

    # Tone 1: high and level.
    t1 = _sig(3.0 - abs(d), 1.5) * _sig(high + 1.5, 1.0) * _sig(4.0 - level_range, 1.0)
    # Tone 2: rising (possibly after a short initial dip).
    t2 = max(_sig(d - 1.5, 1.5), _sig(rise_from_min - 2.5, 1.5) * _sig(0.75 - pmin, 8.0))
    t2 *= _sig(3.0 - (fall_to_min if pmin > 0.6 else 0.0), 1.0)
    # Tone 3: low (level, falling, dipping, or dip-rise) - i.e. reaches a low pitch.
    low = _sig(mid - 1.0 - mn, 0.8)
    dip = _sig(fall_to_min - 2.0, 1.0) * _sig(rise_from_min - 1.5, 1.0)
    t3 = max(low * _sig(3.5 - (s - mid), 0.8), dip, 1.0 if f.get("creak") else 0.0)
    # Tone 4: falling from mid/high.
    t4 = _sig(-d - 2.5, 1.2) * _sig(s - mid + 2.0, 0.8)
    return {1: round(t1, 3), 2: round(t2, 3), 3: round(t3, 3), 4: round(t4, 3), 5: 1.0}


def allowed_tones(chars: str, tones: list[int], spoken_tones: list[int] | None = None) -> list[set[int]]:
    """Per-syllable sets of acceptable realized tones (citation + sandhi variants)."""
    n = len(tones)
    out = [{t} for t in tones]
    for i, t in enumerate(tones):
        nxt = tones[i + 1] if i + 1 < n else None
        ch = chars[i] if i < len(chars) else ""
        if t == 3 and nxt == 3:
            out[i].add(2)  # 3rd-tone sandhi
        if t == 3 and nxt is not None:
            out[i].add(4)  # half-third realized as a low fall can look like a fall
        if ch == "不" and nxt == 4:
            out[i].add(2)
        if ch == "一" and nxt is not None:
            out[i].update({2, 4})
        if t == 5:
            out[i] = {1, 2, 3, 4, 5}
        if i > 0 and t != 5:
            # Unstressed second syllables are often reduced toward neutral in fast speech.
            pass
        if spoken_tones and i < len(spoken_tones):
            out[i].add(spoken_tones[i])
    return out


class PitchAnalyzer:
    def __init__(self, floor: float = 75.0, ceiling: float = 600.0, mid: float = VOICE_MID_ST):
        self.floor = floor
        self.ceiling = ceiling
        self.mid = mid

    def track(self, x: np.ndarray, sr: int):
        import parselmouth

        snd = parselmouth.Sound(x.astype(np.float64), sr)
        pitch = snd.to_pitch_ac(time_step=0.01, pitch_floor=self.floor, pitch_ceiling=self.ceiling)
        f0 = pitch.selected_array["frequency"]
        times = pitch.xs()
        inten = snd.to_intensity(minimum_pitch=100.0, time_step=0.01)
        idb = np.array([inten.get_value(t) or np.nan for t in times], dtype=float)
        idb = np.nan_to_num(idb, nan=np.nanmin(idb) if np.isfinite(idb).any() else 0.0)
        return times, f0, idb

    def syllables(self, x: np.ndarray, sr: int, n_syll: int) -> tuple[list[Syllable], dict[str, Any]]:
        times, f0, idb = self.track(x, sr)
        info: dict[str, Any] = {}
        voiced = f0 > 0
        st = np.where(voiced, 12 * np.log2(np.maximum(f0, 1e-6) / 100.0), np.nan)
        if voiced.sum() < 5:
            return [], {"error": "too little voicing"}
        # Outliers: octave errors / bursts / creak far from the clip's median.
        med = np.nanmedian(st)
        creak_mask = voiced & (st < med - 8.5)
        bad = voiced & ((st > med + 9) | (st < med - 8.5))
        voiced = voiced & ~bad
        st = np.where(voiced, st, np.nan)
        # Voiced runs, merging gaps <= 3 frames, dropping runs shorter than 5 frames (50 ms).
        runs = []
        i = 0
        N = len(voiced)
        while i < N:
            if voiced[i]:
                j = i
                while j < N and voiced[j]:
                    j += 1
                runs.append([i, j])
                i = j
            else:
                i += 1
        merged: list[list[int]] = []
        for r in runs:
            if merged and r[0] - merged[-1][1] <= 3:
                merged[-1][1] = r[1]
            else:
                merged.append(r)
        runs = [r for r in merged if r[1] - r[0] >= 5]
        if not runs:
            return [], {"error": "no voiced run >= 50 ms"}

        def weight(r):
            return (r[1] - r[0]) * (np.mean(idb[r[0]:r[1]]) - idb.min() + 1)

        if len(runs) > n_syll:
            keep = sorted(sorted(runs, key=weight, reverse=True)[:n_syll])
            extra = [r for r in runs if r not in keep]
            info["extra_runs_ms"] = [10 * (r[1] - r[0]) for r in extra]
            runs = keep
        while len(runs) < n_syll:
            # Split the longest run at its deepest intensity dip (outside the outer 20%).
            k = max(range(len(runs)), key=lambda q: runs[q][1] - runs[q][0])
            a, b = runs[k]
            L = b - a
            if L < 8:
                break
            lo, hi = a + max(2, int(L * 0.2)), b - max(2, int(L * 0.2))
            seg = idb[lo:hi]
            # A dip must be a real local minimum ~1.5 dB below its neighbourhood, else split evenly.
            cut = None
            if len(seg) >= 3:
                m = int(np.argmin(seg)) + lo
                if min(idb[a:m].max(), idb[m:b].max()) - idb[m] >= 1.5:
                    cut = m
            if cut is None:
                share = 1.0 / (n_syll - len(runs) + 1)
                cut = a + int(L * share) if len(runs) < n_syll - 1 else a + L // 2
                info["even_split"] = True
            runs[k:k + 1] = [[a, cut], [cut, b]]
        sylls = []
        for a, b in runs:
            L = b - a
            ca = a + int(round(L * 0.15))
            cb = b - int(round(L * 0.10))
            seg = st[ca:cb]
            seg = seg[np.isfinite(seg)]
            if len(seg) < 3:
                seg = st[a:b][np.isfinite(st[a:b])]
            # Light 3-point median smoothing.
            if len(seg) >= 3:
                sm = seg.copy()
                sm[1:-1] = np.median(np.stack([seg[:-2], seg[1:-1], seg[2:]]), axis=0)
                seg = sm
            creak = bool(creak_mask[a:min(N, b + 5)].sum() >= 2)
            sylls.append(Syllable(float(times[a]), float(times[min(b, N - 1)]), seg, creak))
        return sylls, info

    def check(self, x: np.ndarray, sr: int, chars: str, tones: list[int],
              spoken_tones: list[int] | None = None) -> dict[str, Any]:
        n = len(tones)
        sylls, info = self.syllables(x, sr, n)
        if len(sylls) != n:
            return {"status": "unknown", "score": None, "reasons": [info.get("error", "segmentation failed")],
                    "info": info}
        allowed = allowed_tones(chars, tones, spoken_tones)
        per = []
        reasons = []
        scores = []
        for i, (sy, al) in enumerate(zip(sylls, allowed)):
            f = sy.features()
            ts = tone_scores(f, self.mid)
            best_allowed = max(ts[t] for t in al)
            guess = max((1, 2, 3, 4), key=lambda t: ts[t])
            per.append({"features": f, "scores": ts, "allowed": sorted(al), "best": best_allowed, "guess": guess})
            # Neutral-tone syllables carry no evidence; don't let them dilute the score.
            if tones[i] != 5:
                scores.append(best_allowed)
                if best_allowed < 0.25:
                    reasons.append(f"syllable {i + 1} contour looks like tone {guess}, expected {tones[i]}"
                                   f" (score {best_allowed:.2f})")
        score = float(min(scores)) if scores else 1.0
        status = "ok" if score >= 0.4 else ("weak" if score >= 0.15 else "mismatch")
        if info.get("extra_runs_ms") and max(info["extra_runs_ms"]) >= 150:
            reasons.append(f"extra voiced segment(s) {info['extra_runs_ms']} ms")
        return {"status": status, "score": round(score, 3), "reasons": reasons, "syllables": per, "info": info}


# ================================================================================================
# ASR
# ================================================================================================

_PY_CACHE: dict[str, set[tuple[str, int]]] = {}


def char_readings(ch: str) -> set[tuple[str, int]]:
    """All dictionary readings of a character as (toneless, tone) with neutral = 5."""
    if ch in _PY_CACHE:
        return _PY_CACHE[ch]
    from pypinyin import Style, pinyin

    out = set()
    for variant in {ch, C.to_simplified(ch)}:
        for r in pinyin(variant, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True)[0]:
            r = r.replace("ü", "v")
            if r and r[-1].isdigit():
                out.add((r[:-1], int(r[-1])))
            else:
                out.add((r, 5))
    _PY_CACHE[ch] = out
    return out


def align_cost(expected: list[tuple[str, int]], heard: list[set[tuple[str, int]]]) -> tuple[float, int, int]:
    """Edit distance between expected syllables and heard candidate sets.

    substitution: 0 if exact (tone 5 on either side is a wildcard), 0.5 if same syllable but
    different tone, 1 otherwise. Returns (cost, n_tone_errors, n_syllable_errors) along the best path.
    """
    n, m = len(expected), len(heard)
    INF = 1e9
    D = [[(INF, 0, 0)] * (m + 1) for _ in range(n + 1)]
    D[0][0] = (0.0, 0, 0)
    for i in range(n + 1):
        for j in range(m + 1):
            c, te, se = D[i][j]
            if c >= INF:
                continue
            if i < n and D[i + 1][j][0] > c + 1:
                D[i + 1][j] = (c + 1, te, se + 1)
            if j < m and D[i][j + 1][0] > c + 1:
                D[i][j + 1] = (c + 1, te, se + 1)
            if i < n and j < m:
                syl, tone = expected[i]
                cands = heard[j]
                if any(s == syl and (t == tone or t == 5 or tone == 5) for s, t in cands):
                    sub = (c, te, se)
                elif any(s == syl for s, _ in cands):
                    sub = (c + 0.5, te + 1, se)
                else:
                    sub = (c + 1, te, se + 1)
                if D[i + 1][j + 1][0] > sub[0]:
                    D[i + 1][j + 1] = sub
    return D[n][m]


def toneless(s: str) -> list[str]:
    from pypinyin import lazy_pinyin

    return [p for p in lazy_pinyin(C.to_simplified(s)) if p.strip() and p.isalpha()]


def edit_distance(a: list, b: list) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


_HALLUCINATIONS = ("字幕", "订阅", "訂閱", "点赞", "點贊", "谢谢观看", "謝謝觀看", "感谢收看", "感謝收看", "明镜", "明鏡")


def _setup_cuda_dlls() -> None:
    """On Windows, make pip-installed NVIDIA DLLs (nvidia-cublas-cu12) visible to CTranslate2."""
    if sys.platform != "win32":
        return
    import glob
    import os
    import site

    roots = site.getsitepackages() + [site.getusersitepackages()]
    for root in roots:
        for d in glob.glob(os.path.join(root, "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(d)
            except OSError:
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


def resolve_device(device: str) -> str:
    if device != "auto":
        if device == "cuda":
            _setup_cuda_dlls()
        return device
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            _setup_cuda_dlls()
            return "cuda"
    except Exception:
        pass
    return "cpu"


class ASR:
    def __init__(self, model: str = DEFAULT_WHISPER, device: str = "auto", compute_type: str | None = None,
                 workers: int = 1, cpu_threads: int = 0):
        from faster_whisper import WhisperModel

        device = resolve_device(device)
        auto = model == "auto"
        if auto:
            model = AUTO_MODEL[device]
        if compute_type is None:
            compute_type = "int8" if device == "cpu" else "float16"
        self.model_name = model
        self.device = device
        try:
            self.model = WhisperModel(model, device=device, compute_type=compute_type, num_workers=workers,
                                      cpu_threads=cpu_threads)
            if device == "cuda":  # fail fast here (missing cuBLAS etc.) rather than mid-run
                self._run(np.zeros(8000, dtype=np.float32), None)
        except Exception as e:
            if device == "cpu":
                raise
            print(f"[qc] CUDA unavailable ({str(e)[:120]}); falling back to CPU", file=sys.stderr)
            self.device = "cpu"
            if auto:
                self.model_name = model = AUTO_MODEL["cpu"]
            self.model = WhisperModel(model, device="cpu", compute_type="int8", num_workers=workers,
                                      cpu_threads=cpu_threads)

    def _run(self, audio: np.ndarray, prompt: str | None):
        segments, _ = self.model.transcribe(
            audio, language="zh", beam_size=5, temperature=0.0, condition_on_previous_text=False,
            without_timestamps=True, vad_filter=False, initial_prompt=prompt,
        )
        return list(segments)

    def transcribe(self, x16k: np.ndarray, prompt: str | None = None) -> str:
        # Pad with 0.3 s of silence on both sides: whisper is more reliable on tiny clips with some room.
        pad = np.zeros(4800, dtype=np.float32)
        audio = np.concatenate([pad, x16k.astype(np.float32), pad])
        texts = []
        for s in self._run(audio, prompt):
            t = s.text.strip()
            # Drop the classic whisper silence hallucinations ("subtitles by ...").
            if any(h in t for h in _HALLUCINATIONS) or (s.no_speech_prob > 0.8 and s.avg_logprob < -0.8):
                continue
            texts.append(t)
        return "".join(texts).strip()


_DIGITS = str.maketrans("0123456789", "〇一二三四五六七八九")

ASR_RANK = {"match": 6, "primed_match": 5, "tone_mismatch": 4, "partial": 3, "empty": 2, "unclear": 2, "mismatch": 0}


def compare_word(transcript: str, text: str, pinyin_numbered: str) -> dict[str, Any]:
    t = C.normalize_zh(transcript.translate(_DIGITS))
    e = C.normalize_zh(text)
    out: dict[str, Any] = {"transcript": transcript}
    if not t:
        return {**out, "status": "empty", "detail": "no speech recognized"}
    if t == e:
        return {**out, "status": "match", "detail": "exact text"}
    expected = C.parse_numbered(pinyin_numbered)
    hanzi = [ch for ch in t if C.hanzi_count(ch)]
    if not hanzi:
        # Whisper sometimes writes an isolated syllable in Latin letters ("E", "Sin"): no evidence either way.
        return {**out, "status": "unclear", "detail": "no Chinese characters in transcript"}
    heard = [char_readings(ch) for ch in hanzi]
    cost, tone_err, syl_err = align_cost(expected, heard)
    out.update({"cost": cost, "tone_errors": tone_err, "syllable_errors": syl_err})
    if cost == 0:
        return {**out, "status": "match", "detail": "homophone"}
    if syl_err == 0:
        return {**out, "status": "tone_mismatch", "detail": f"{tone_err} syllable(s) heard with a different tone"}
    if e in t and len(t) - len(e) <= 2:
        return {**out, "status": "partial", "detail": "expected word heard with extra material"}
    return {**out, "status": "mismatch", "detail": f"{syl_err} syllable(s) differ"}


_SYLLABLES: set[str] | None = None


def valid_syllables() -> set[str]:
    global _SYLLABLES
    if _SYLLABLES is None:
        from pypinyin.pinyin_dict import pinyin_dict

        syl = set()
        for v in pinyin_dict.values():
            for r in v.split(","):
                b, _ = C.parse_marked_syllable(r)
                if b.isalpha():
                    syl.add(b)
        syl.add("r")  # erhua written as a separate syllable (玩兒 wánr)
        _SYLLABLES = syl
    return _SYLLABLES


def split_pinyin(pinyin_text: str, n: int) -> list[str] | None:
    """Tone-marked sentence pinyin ("Nǐ zhīdào tā zhù nǎlǐ ma?") -> exactly n toneless syllables.

    Used to compare sentences against the Taiwan-standard readings in the data (e.g. 垃圾 lèsè) rather
    than pypinyin's mainland defaults. Returns None if no segmentation with n syllables exists.
    """
    import re

    syl = valid_syllables()
    chunks = []
    for w in re.findall(r"[^\W\d_]+(?:'[^\W\d_]+)*", pinyin_text.lower()):
        for part in w.split("'"):
            base = "".join(C.parse_marked_syllable(ch)[0] for ch in part)
            if base:
                chunks.append(base)

    def segs(word: str) -> dict[int, list[str]]:
        # count -> one segmentation (longest-match-first), via memoized recursion
        memo: dict[int, dict[int, list[str]]] = {}

        def go(i: int) -> dict[int, list[str]]:
            if i == len(word):
                return {0: []}
            if i in memo:
                return memo[i]
            out: dict[int, list[str]] = {}
            for j in range(min(len(word), i + 6), i, -1):
                piece = word[i:j]
                # Pinyin orthography: a syllable starting with a/o/e inside a word needs an apostrophe.
                if i > 0 and piece[0] in "aoe":
                    continue
                if piece in syl:
                    for k, rest in go(j).items():
                        out.setdefault(k + 1, [piece] + rest)
            memo[i] = out
            return out

        return go(0)

    # Combine chunks so the total syllable count equals n.
    combos: dict[int, list[str]] = {0: []}
    for c in chunks:
        options = segs(c)
        if not options:
            return None
        nxt: dict[int, list[str]] = {}
        for k, acc in combos.items():
            for m, seg in options.items():
                if k + m <= n:
                    nxt.setdefault(k + m, acc + seg)
        combos = nxt
    return combos.get(n)


def compare_sentence(transcript: str, text: str, pinyin: str | None = None) -> dict[str, Any]:
    t = C.normalize_zh(transcript)
    e = C.normalize_zh(text)
    out: dict[str, Any] = {"transcript": transcript}
    if not t:
        return {**out, "status": "empty", "error_rate": 1.0}
    cer = edit_distance(list(t), list(e)) / max(1, len(e))
    pe = (split_pinyin(pinyin, C.hanzi_count(text)) if pinyin else None) or toneless(e)
    pt = toneless(t)
    per = edit_distance(pt, pe) / max(1, len(pe))
    rate = round(min(cer, per), 3)
    out.update({"cer": round(cer, 3), "pinyin_er": round(per, 3), "error_rate": rate})
    if rate == 0:
        out["status"] = "match"
    elif rate <= SENT_PASS:
        out["status"] = "near"
    elif rate <= SENT_SUSPECT:
        out["status"] = "suspect"
    else:
        out["status"] = "mismatch"
    return out


SENT_PASS = 0.12
SENT_SUSPECT = 0.30


# ================================================================================================
# Combined QC
# ================================================================================================

class QC:
    def __init__(self, whisper_model: str = DEFAULT_WHISPER, device: str = "auto", workers: int = 1,
                 cpu_threads: int = 0, prompt: str | None = None, prime: bool = True):
        self.prime = prime
        self.asr = ASR(whisper_model, device=device, workers=workers, cpu_threads=cpu_threads)
        self.pitch = PitchAnalyzer()
        self.prompt = prompt
        self._lock = threading.Lock()

    def _transcribe(self, x: np.ndarray, sr: int, prompt: str | None = None) -> str:
        return self.asr.transcribe(C.resample(x, sr, 16000), prompt or self.prompt)

    def check_word(self, x: np.ndarray, sr: int, text: str, pinyin_numbered: str,
                   spoken_as: str | None = None) -> dict[str, Any]:
        reasons: list[str] = []
        dur = len(x) / sr
        expected = C.parse_numbered(pinyin_numbered)
        tones = [t for _, t in expected]
        spoken_tones = None
        if spoken_as:
            spoken_tones = [C.parse_marked_syllable(s)[1] for s in spoken_as.split()]
            if len(spoken_tones) != len(tones):
                spoken_tones = None
        asr = compare_word(self._transcribe(x, sr), text, pinyin_numbered)
        if asr["status"] != "match" and self.prime:
            # Second opinion primed with the expected word: whisper resolves ambiguous isolated syllables
            # toward the prompt, so only audio that clearly sounds different still mismatches. This keeps
            # ASR quirks on 1-syllable clips from causing false fails.
            primed = compare_word(self._transcribe(x, sr, prompt=text), text, pinyin_numbered)
            asr["primed"] = primed
            if primed["status"] == "match":
                asr["status"] = "primed_match"
            elif ASR_RANK[primed["status"]] > ASR_RANK[asr["status"]]:
                asr["status"] = primed["status"]
        try:
            pitch = self.pitch.check(x, sr, text, tones, spoken_tones)
        except Exception as e:  # never let the pitch tracker crash a run
            pitch = {"status": "unknown", "score": None, "reasons": [f"pitch error: {e}"]}
        max_dur = 0.9 + 0.55 * len(tones)
        dur_bad = dur < 0.15 or dur > max_dur
        if dur_bad:
            reasons.append(f"duration {dur:.2f}s outside [0.15, {max_dur:.2f}]")
        a, p = asr["status"], pitch["status"]
        if a != "match":
            heard = asr["transcript"] + (f" / primed '{asr['primed']['transcript']}'" if "primed" in asr else "")
            reasons.append(f"ASR {a}: heard '{heard}'")
        reasons.extend(pitch.get("reasons", []))

        if a == "mismatch" or dur_bad:
            verdict = "fail"
        elif a == "match":
            verdict = "suspect" if p == "mismatch" else "pass"
        elif a == "primed_match":
            verdict = "pass" if p in ("ok", "unknown") else "suspect"
        elif a == "tone_mismatch":
            verdict = "fail" if p in ("mismatch", "weak") else "suspect"
        else:  # partial / empty / unclear
            verdict = "fail" if p == "mismatch" else "suspect"
        asr_score = {"match": 1.0, "primed_match": 0.8, "tone_mismatch": 0.4, "partial": 0.4, "empty": 0.3,
                     "unclear": 0.3}.get(a, 0.0)
        pscore = pitch["score"] if pitch.get("score") is not None else 0.5
        score = round(0.6 * asr_score + 0.4 * pscore - (0.5 if dur_bad else 0), 3)
        return {"verdict": verdict, "score": score, "reasons": reasons, "duration": round(dur, 3),
                "asr": asr, "pitch": pitch}

    def check_sentence(self, x: np.ndarray, sr: int, text: str, pinyin: str | None = None) -> dict[str, Any]:
        reasons: list[str] = []
        dur = len(x) / sr
        n = C.hanzi_count(text)
        asr = compare_sentence(self._transcribe(x, sr), text, pinyin)
        cps = n / dur if dur > 0 else 0
        dur_bad = n >= 3 and (cps < 1.2 or cps > 9.0)
        if dur_bad:
            reasons.append(f"speaking rate {cps:.1f} chars/s is implausible")
        a = asr["status"]
        if a not in ("match", "near"):
            reasons.append(f"ASR {a}: heard '{asr['transcript']}' (error rate {asr.get('error_rate')})")
        if a in ("match", "near") and not dur_bad:
            verdict = "pass"
        elif a == "suspect" or (a in ("match", "near") and dur_bad):
            verdict = "suspect"
        else:
            verdict = "fail"
        score = round(max(0.0, 1.0 - asr.get("error_rate", 1.0)) - (0.3 if dur_bad else 0), 3)
        return {"verdict": verdict, "score": score, "reasons": reasons, "duration": round(dur, 3),
                "asr": asr}


# ================================================================================================
# CLI
# ================================================================================================

def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?")
    ap.add_argument("--word")
    ap.add_argument("--pinyin")
    ap.add_argument("--sentence")
    ap.add_argument("--all", action="store_true", help="QC every clip referenced by words.json in --audio-dir")
    ap.add_argument("--words", default=str(C.ROOT / "src" / "data" / "words.json"))
    ap.add_argument("--audio-dir", default=str(C.ROOT / "public" / "audio"))
    ap.add_argument("--whisper", default=DEFAULT_WHISPER)
    ap.add_argument("--device", default="auto", help="auto (cuda if available) | cuda | cpu")
    args = ap.parse_args()
    qc = QC(args.whisper, args.device)
    import json

    if args.file:
        x = C.decode_audio(args.file, sr=C.PCM_RATE)
        if args.sentence:
            rep = qc.check_sentence(x, C.PCM_RATE, args.sentence)
        else:
            rep = qc.check_word(x, C.PCM_RATE, args.word, args.pinyin)
        print(json.dumps(rep, ensure_ascii=False, indent=1))
        return
    if args.all:
        words = C.load_json(Path(args.words), [])
        ad = Path(args.audio_dir)
        counts: dict[str, int] = {}
        for w in words:
            for kind, sub in (("word", "w"), ("sentence", "s")):
                p = ad / sub / f"{w['id']}.mp3"
                if not p.exists():
                    continue
                x = C.decode_audio(p, sr=C.PCM_RATE)
                if kind == "word":
                    rep = qc.check_word(x, C.PCM_RATE, w["trad"], w["pinyinNumbered"], w.get("spokenAs"))
                else:
                    rep = qc.check_sentence(x, C.PCM_RATE, w["example"]["trad"], w["example"].get("pinyin"))
                counts[rep["verdict"]] = counts.get(rep["verdict"], 0) + 1
                if rep["verdict"] != "pass":
                    print(f"{rep['verdict']:7s} {sub}/{w['id']} {w['trad'] if kind == 'word' else w['example']['trad']}: "
                          + "; ".join(rep["reasons"]))
        print(counts)
        return
    ap.print_help()


if __name__ == "__main__":
    main()
