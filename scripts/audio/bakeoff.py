"""Model bake-off: generate the test set with several models/variants, then score with qc.py.

  python scripts/audio/bakeoff.py generate [--variants a,b] [--max-credits 1500]
  python scripts/audio/bakeoff.py score [--whisper large-v3-turbo]

Raw audio (FLAC, untrimmed) + results go to public/audio/_bakeoff/ (temporary; deleted afterwards).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as C  # noqa: E402
from bakeoff_set import SENTENCES, WORDS  # noqa: E402

OUT = C.ROOT / "public" / "audio" / "_bakeoff"

# name -> generation options for the word clips
V = dict
VARIANTS = {
    "ml2": V(model="eleven_multilingual_v2"),
    "ml2_ctx": V(model="eleven_multilingual_v2", ctx=True),
    "flash": V(model="eleven_flash_v2_5"),
    "flash_ctx": V(model="eleven_flash_v2_5", ctx=True),
    "v4": V(model="eleven_v4"),
    "v4_ctx": V(model="eleven_v4", ctx=True),
    "v4t": V(model="eleven_v4_turbo"),
    "v4t_ctx": V(model="eleven_v4_turbo", ctx=True),
    "v3": V(model="eleven_v3"),
    "ml2_s2": V(model="eleven_multilingual_v2", salt=1),  # second seed: consistency check
    "flash_s2": V(model="eleven_flash_v2_5", salt=1),
    # round 2: eleven_v4 refinements
    "v4_s2": V(model="eleven_v4", salt=1),
    "v4_s3": V(model="eleven_v4", salt=2),
    "v4_punct": V(model="eleven_v4", suffix="。"),
    "v4_sp10": V(model="eleven_v4", speed=1.0),
    "v4_st50": V(model="eleven_v4", stability=0.5),
    "v4t_s2": V(model="eleven_v4_turbo", salt=1),
}
SENTENCE_MODELS = ["eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_v4", "eleven_v4_turbo", "eleven_v3"]


def jobs(variants: list[str]):
    for v in variants:
        o = VARIANTS[v]
        model = o["model"]
        settings = C.voice_settings("word", model, o.get("speed"))
        if "stability" in o:
            settings["stability"] = o["stability"]
        for trad, pn, ex in WORDS:
            prev, nxt = C.context_from_example(trad, ex) if o.get("ctx") else (None, None)
            yield {
                "variant": v, "kind": "word", "text": trad, "tts_text": trad + o.get("suffix", ""),
                "pinyinNumbered": pn, "example": ex, "model": model, "prev": prev, "next": nxt,
                "settings": settings, "seed": C.stable_seed("bake:" + trad, o.get("salt", 0)),
            }
    for model in SENTENCE_MODELS:
        if not any(VARIANTS[v]["model"] == model for v in variants):
            continue
        for s in SENTENCES:
            yield {
                "variant": "sent_" + model, "kind": "sentence", "text": s, "tts_text": s, "model": model,
                "prev": None, "next": None, "settings": C.voice_settings("sentence", model),
                "seed": C.stable_seed("bake:" + s),
            }


def cmd_generate(args):
    OUT.mkdir(parents=True, exist_ok=True)
    results_path = OUT / "results.json"
    results = C.load_json(results_path, {})
    client = C.ElevenClient()
    used0, limit, remaining = client.remaining_credits()
    print(f"subscription: used {used0}/{limit}")
    todo = []
    for j in jobs(args.variants.split(",")):
        key = f"{j['variant']}|{j['text']}"
        if key in results and (OUT / results[key]["file"]).exists():
            continue
        todo.append((key, j))
    est = sum(C.estimate_cost(j["tts_text"], j["model"]) for _, j in todo)
    print(f"{len(todo)} clips to generate, estimated <= {est:.0f} credits")
    if est > args.max_credits:
        raise SystemExit("estimate exceeds --max-credits")

    def run(item):
        key, j = item
        t = time.time()
        try:
            res = client.tts(j["tts_text"], j["model"], j["settings"], seed=j["seed"],
                             previous_text=j["prev"], next_text=j["next"])
        except C.ApiError as e:
            return key, j, None, str(e)
        x = C.pcm_to_float(res.pcm)
        fname = f"{j['variant']}_{'-'.join(f'{ord(c):x}' for c in j['text'] if C.hanzi_count(c))}.flac"
        (OUT / fname).write_bytes(C.encode_flac(x))
        return key, j, {"file": fname, "cost": res.cost, "secs": round(time.time() - t, 2),
                        "dur": round(len(x) / C.PCM_RATE, 3)}, None

    with ThreadPoolExecutor(max_workers=3) as ex:
        for key, j, info, err in ex.map(run, todo):
            if err:
                print("ERR", key, err[:200])
                continue
            results[key] = {**j, **info}
            print(key, info)
            C.write_json_atomic(results_path, results)
    time.sleep(3)
    used1, _, _ = client.remaining_credits()
    hdr = sum((r.get("cost") or 0) for r in results.values())
    print(f"subscription used now {used1} (delta this run {used1 - used0}); header cost total {hdr}")


def cmd_score(args):
    import qc

    results = C.load_json(OUT / "results.json", {})
    checker = qc.QC(whisper_model=args.whisper, device=args.device, prompt=args.prompt)
    scored = {}
    t0 = time.time()
    for key, r in sorted(results.items()):
        x = C.decode_audio(OUT / r["file"], sr=C.PCM_RATE)
        x, _ = C.trim_silence(x)
        if r["kind"] == "word":
            rep = checker.check_word(x, C.PCM_RATE, r["text"], r["pinyinNumbered"])
        else:
            rep = checker.check_sentence(x, C.PCM_RATE, r["text"])
        scored[key] = {**r, "qc": rep}
    dt = time.time() - t0
    out = OUT / f"scored_{args.whisper}{'_p' if args.prompt else ''}.json"
    C.write_json_atomic(out, scored)
    print(f"scored {len(scored)} clips in {dt:.1f}s -> {out}")
    summarize(scored)


def summarize(scored):
    from collections import defaultdict

    agg = defaultdict(lambda: defaultdict(int))
    for key, r in scored.items():
        v = r["variant"]
        q = r["qc"]
        agg[v]["n"] += 1
        agg[v][q["verdict"]] += 1
        agg[v]["asr_ok"] += int(q["asr"]["status"] == "match")
        agg[v]["primed"] += int(q["asr"]["status"] == "primed_match")
        if "pitch" in q and q["pitch"]:
            agg[v]["pitch_ok"] += int(q["pitch"]["status"] == "ok")
    print(f"{'variant':28s} n  pass suspect fail asr_ok primed pitch_ok")
    for v, a in sorted(agg.items()):
        print(f"{v:28s} {a['n']:2d} {a['pass']:5d} {a['suspect']:7d} {a['fail']:4d} {a['asr_ok']:6d} {a['primed']:6d} {a['pitch_ok']:8d}")
    print()
    for key, r in sorted(scored.items()):
        q = r["qc"]
        if q["verdict"] != "pass":
            print(f"{key:30s} {q['verdict']:7s} asr='{q['asr'].get('transcript')}' {'; '.join(q['reasons'])}")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate")
    g.add_argument("--variants", default=",".join(VARIANTS))
    g.add_argument("--max-credits", type=float, default=1500)
    s = sub.add_parser("score")
    s.add_argument("--whisper", default="small")
    s.add_argument("--device", default="auto")
    s.add_argument("--prompt", default=None)
    args = ap.parse_args()
    {"generate": cmd_generate, "score": cmd_score}[args.cmd](args)


if __name__ == "__main__":
    main()
