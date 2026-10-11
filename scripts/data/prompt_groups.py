"""Group words whose English glosses overlap, to review Say-card (English -> Chinese) prompts.

On the Say card the learner sees only gloss + hint (+ pos) and must produce the Chinese word. Words whose glosses
share a sense ("to know", "can", "but") need hints that tell them apart. This script prints every such group so
a human (or agent) can check that each prompt points to exactly one word.

Run:  ./.venv/Scripts/python scripts/data/prompt_groups.py [--senses-only] [--min N] [--grep WORD]

  --senses-only  only group by whole senses ("to know", "but"), not by shared content words ("know", "time")
  --min N        only print groups with at least N members (default 2)
  --grep WORD    only print groups whose key contains WORD

Keys
  sense:  one ;-separated piece of the gloss, lowercased, with parenthesised text, leading "to/a/an/the" and
          trailing punctuation removed. "to know (a fact)" -> "know".
  word:   each content word of the gloss (stopwords removed), with a crude plural strip. Catches looser overlaps
          such as "time" in "time; moment" / "this time" / "at the same time", or "want" in "to want" / "to not want".
Groups with exactly the same members are printed once, with all their keys. Exit status 1 if any two words have
an identical gloss + hint (build_words.py enforces the same rule, plus "no hint contains the word's own pinyin").
"""
from __future__ import annotations

import argparse
import glob
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHUNKS = ROOT / "data" / "enriched"

STOP = set(
    """
    a an the to of in on at for with by from as and or not no be is are am it its it's this that these those
    one one's someone someone's something sb sth etc e.g. i.e. up out off do does did done get got
    very more most so such much many some any all
    """.split()
)
STOP_WORD_KEYS = STOP | {"(", ")"}


def senses(gloss: str) -> list[str]:
    out = []
    for part in re.split(r";", gloss):
        s = re.sub(r"\([^)]*\)", " ", part).lower()
        s = s.replace("…", " ").replace("...", " ")
        s = re.sub(r"[!?.,\"']", " ", s)
        s = re.sub(r"\s+", " ", s).strip()
        s = re.sub(r"^(to|a|an|the) ", "", s)
        if s:
            out.append(s)
    return out


def content_words(gloss: str) -> set[str]:
    s = re.sub(r"[()…!?.,;/\"]", " ", gloss.lower())
    out = set()
    for w in s.split():
        w = w.strip("-'")
        if not w or w in STOP_WORD_KEYS or len(w) < 2:
            continue
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.add(w)
    return out


def load() -> list[dict]:
    words = []
    for f in sorted(glob.glob(str(CHUNKS / "chunk-*.json"))):
        words += json.loads(Path(f).read_text(encoding="utf-8"))
    return sorted(words, key=lambda w: w["rank"])


def groups(words: list[dict], senses_only: bool = False) -> list[tuple[list[str], list[dict]]]:
    by_key: dict[str, list[dict]] = {}
    for w in words:
        keys = {f"sense:{s}" for s in senses(w["gloss"])}
        if not senses_only:
            keys |= {f"word:{c}" for c in content_words(w["gloss"])}
        for k in keys:
            by_key.setdefault(k, []).append(w)
    merged: dict[tuple[int, ...], tuple[list[str], list[dict]]] = {}
    for k, ws in by_key.items():
        if len(ws) < 2:
            continue
        sig = tuple(sorted(w["rank"] for w in ws))
        if sig in merged:
            merged[sig][0].append(k)
        else:
            merged[sig] = ([k], ws)
    return sorted(merged.values(), key=lambda g: (-len(g[1]), g[0][0]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--senses-only", action="store_true")
    ap.add_argument("--min", type=int, default=2)
    ap.add_argument("--grep", default="")
    args = ap.parse_args()
    words = load()
    gs = [g for g in groups(words, args.senses_only) if len(g[1]) >= args.min]
    if args.grep:
        gs = [g for g in gs if any(args.grep.lower() in k for k in g[0])]
    for keys, ws in gs:
        print(f"== {' | '.join(sorted(keys))}  ({len(ws)})")
        for w in sorted(ws, key=lambda w: w["rank"]):
            hint = f"  [{w['hint']}]" if w.get("hint") else ""
            print(f"  {w['rank']:>4} {w['trad']:<5} {w['pinyin']:<14} {w['pos']:<8} {w['gloss']}{hint}")
    # Exact duplicates of the full Say prompt are an error in build_words.py; report them here too.
    seen: dict[tuple[str, str], list[str]] = {}
    for w in words:
        seen.setdefault((w["gloss"].strip().lower(), w.get("hint", "").strip().lower()), []).append(
            f"{w['rank']} {w['trad']}"
        )
    dups = {k: v for k, v in seen.items() if len(v) > 1}
    print(f"\n{len(gs)} groups; {len(dups)} identical gloss+hint prompts")
    for (g, h), who in dups.items():
        print(f"  DUPLICATE {g!r} / {h!r}: {', '.join(who)}")
    return 1 if dups else 0


if __name__ == "__main__":
    sys.exit(main())
