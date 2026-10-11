"""Re-run QC on the cached attempts of clips in state.json, re-pick each clip's best attempt, reinstall
it if it changed, and rewrite the manifest + flags. No API calls, no credits.

Use after changing qc.py (thresholds, normalization) so state.json, flags.json and the installed files
reflect the current QC instead of the QC at generation time.

  python scripts/audio/rescore.py              # clips whose verdict is not "pass"
  python scripts/audio/rescore.py --all        # every clip
  python scripts/audio/rescore.py --only s/w767e,w/w548c
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as C  # noqa: E402
import generate as G  # noqa: E402


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated clip keys (w/<id>, s/<id>)")
    ap.add_argument("--whisper", default="auto")
    ap.add_argument("--device", default="auto")
    a = ap.parse_args()

    # Reuse generate.py's defaults (paths, model chain) so manifest/flags are written identically.
    gargs = _generate_args()
    words = C.load_json(Path(gargs.words), [])
    runner = G.Runner(gargs, G.build_clips(words, gargs))
    clips = {c.key: c for c in runner.clips}

    only = set(a.only.split(",")) if a.only else None
    keys = [k for k, rec in runner.state["clips"].items()
            if k in clips and (only is None or k in only) and (a.all or only or rec.get("verdict") != "pass")]
    print(f"re-scoring {len(keys)} clips")

    import qc as QCmod

    runner.qc = QCmod.QC(whisper_model=a.whisper, device=a.device)
    changed = 0
    for key in keys:
        rec, clip = runner.state["clips"][key], clips[key]
        old = (rec["verdict"], rec["best"])
        best = None
        for att in rec["attempts"]:
            if not att.get("cache") or not (runner.cache_dir / att["cache"]).exists():
                continue
            x = C.decode_audio(runner.cache_dir / att["cache"], sr=C.PCM_RATE)
            rep = runner.run_qc(clip, x)
            att.update({"verdict": rep["verdict"], "score": rep.get("score"), "reasons": rep.get("reasons", []),
                        "transcript": (rep.get("asr") or {}).get("transcript"),
                        "asr": (rep.get("asr") or {}).get("status"), "pitch": (rep.get("pitch") or {}).get("status")})
            if best is None or G.Runner._better(att, best):
                best = att
        if best is None:
            continue
        if best["i"] != rec["best"]:
            src = runner.cache_dir / best["cache"]
            rel = clip.rel_path(src.read_bytes())
            dst = runner.out_dir / rel.split("/", 1)[1]
            shutil.copyfile(src, dst)
            G.remove_superseded(dst.parent, clip.word_id, dst.name)
            rec["path"] = rel
        rec.update({"best": best["i"], "model": best["model"], "seed": best["seed"], "verdict": best["verdict"],
                    "score": best["score"], "reasons": best["reasons"], "transcript": best["transcript"]})
        if (rec["verdict"], rec["best"]) != old:
            changed += 1
            print(f"  {key:22s} {clip.text[:20]}: {old[0]} #{old[1]} -> {rec['verdict']} #{rec['best']}")
    runner.save_state(force=True)
    runner.write_outputs(words)
    print(f"{changed} clips changed")


def _generate_args():
    # generate.main() builds its parser inline; rebuild the same defaults by parsing an empty command line.
    import argparse as _ap

    p = _ap.ArgumentParser()
    p.add_argument("--words", default=str(G.DEFAULT_WORDS))
    p.add_argument("--out-dir", default=str(G.DEFAULT_OUT))
    p.add_argument("--manifest", default=str(G.DEFAULT_MANIFEST))
    p.add_argument("--state", default=str(G.DEFAULT_STATE))
    p.add_argument("--flags", default=str(G.DEFAULT_FLAGS))
    p.add_argument("--reviews", default=str(G.DEFAULT_REVIEWS))
    p.add_argument("--cache-dir", default=str(G.DEFAULT_CACHE))
    p.add_argument("--overrides", default=str(G.OVERRIDES))
    p.add_argument("--manifest-only", action="store_true")
    ns = p.parse_args([])
    ns.limit, ns.only, ns.words_only, ns.examples_only = 0, "", False, False
    ns.model, ns.fallback_model = G.DEFAULT_MODEL, G.DEFAULT_FALLBACK
    ns.word_speed, ns.sentence_speed = 0.9, 0.95
    ns.force, ns.retry_flagged, ns.concurrency, ns.extra = False, False, 1, []
    return ns


if __name__ == "__main__":
    main()
