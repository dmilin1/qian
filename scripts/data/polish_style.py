"""One-off style polish of gloss / hint / note text in data/enriched/chunk-*.json (see data/NOTES.md, "Polish").

Run:  ./.venv/Scripts/python scripts/data/polish_style.py [--write]

Idempotent: each table entry is applied only if the field still holds the old text, is skipped if it already
holds the new text, and is reported as a conflict otherwise (someone edited it since). Without --write it only
prints what it would change. Then run scripts/data/build_words.py.

  * Quotes: English quoted inside gloss, hint and note uses single quotes ('my'), the majority style in the deck.
    Double quotes ("my") are converted. Apostrophes inside ('it's raining') are already common and left as is.
  * HINTS: Say-card hints that only gave the answer's syllable count now give a meaning or usage cue. The
    syllable count stays only where the words are true synonyms and nothing else separates them (忘 / 忘記,
    事 / 事情, 後 / 之後, 但 / 但是).
  * NOTES: pinyin in notes is written one syllable at a time, like headword pinyin.
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

# rank: (trad, old hint, new hint)
HINTS = {
    11: ("這", "one syllable", "as in 'this is…'; before a measure word"),
    44: ("這個", "two syllables; this one, with a measure word", "this one; can stand alone"),
    36: ("那", "one syllable; also 'well then'", "as in 'that is…'; also 'well then'"),
    133: ("那個", "two syllables; that one", "that one; can stand alone"),
    53: ("但", "one syllable", "slightly formal 'but'; one syllable"),
    63: ("多", "one syllable", "'there are many'; also 'more'"),
    224: ("很多", "two syllables; 'very many', before a noun", "'lots of', before a noun"),
    71: ("下", "one syllable", "'next' (next month); 'get off' (a bus)"),
    93: ("出", "one syllable", "plain 'out' (leave the house); no direction"),
    94: ("後", "one syllable", "one syllable, after a time or event; also 'back'"),
    102: ("該", "one syllable", "'time to go'; 'your turn'"),
    109: ("應該", "two syllables", "the usual 'should'; also 'probably'"),
    157: ("家", "one syllable", "home itself; also counts shops"),
    158: ("開", "one syllable", "all-purpose: open, drive, switch on"),
    688: ("打開", "two-syllable form, not plain kāi", "open up (a box, an app); not plain kāi"),
    181: ("起", "one syllable", "rise; mostly in compounds like 'get out of bed'"),
    186: ("回", "one syllable", "go back; also 'reply' (to a message)"),
    203: ("錯", "one syllable", "everyday 'wrong'; also 'my fault'"),
    220: ("進", "one syllable", "enter, no direction ('please come in')"),
    35: ("沒有", "two syllables (full form)", "can stand alone: 'no, I didn't'"),
    40: ("沒", "one syllable (short form)", "short form, only before a verb or noun"),
    437: ("學", "everyday one-syllable word", "everyday 'learn' (learn to drive)"),
    690: ("學習", "two syllables, more formal", "more formal; studying as an activity"),
    542: ("睡", "one-syllable verb", "be asleep; 'sleep well'"),
    934: ("睡覺", "go to bed, two syllables", "go to bed"),
    621: ("害怕", "feeling fear, two syllables", "feel scared; no object needed"),
    668: ("直到", "all the way until, two syllables", "all the way until (a time)"),
    663: ("受到", "two syllables, before abstract nouns", "undergo; before abstract nouns (influence)"),
    216: ("或", "one syllable, in statements", "a bit formal 'or', in statements"),
    259: ("或者", "two syllables, in statements", "everyday 'or' in statements"),
    458: ("夠", "one syllable, everyday", "everyday 'enough'; 'that's enough!'"),
    652: ("忘", "one syllable", "one syllable; as in 'I forgot!'"),
    972: ("美麗", "two syllables, a bit literary", "a bit literary or poetic"),
}

# rank: (field, old substring, new substring)
NOTES = {
    576: ("note", "(nǐ zài máng shénme?)", "(nǐ zài máng shén me?)"),
    584: ("note", "(zěnme bàn)", "(zěn me bàn)"),
}


def single_quotes(s: str) -> str:
    return re.sub(r'"([^"]*)"', r"'\1'", s)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    changed, conflicts = [], []
    files = [(Path(f), json.loads(Path(f).read_text(encoding="utf-8"))) for f in sorted(glob.glob(str(CHUNKS / "chunk-*.json")))]
    for path, words in files:
        for w in words:
            r = w["rank"]
            for k in ("gloss", "hint", "note"):
                if k in w and '"' in w[k]:
                    new = single_quotes(w[k])
                    changed.append(f"{r} {w['trad']} {k}: {w[k]!r} -> {new!r}")
                    w[k] = new
            if r in HINTS:
                trad, old, new = HINTS[r]
                if w["trad"] != trad:
                    conflicts.append(f"{r}: expected {trad}, found {w['trad']}")
                elif w.get("hint") == old:
                    changed.append(f"{r} {trad} hint: {old!r} -> {new!r}")
                    w["hint"] = new
                elif w.get("hint") != new:
                    conflicts.append(f"{r} {trad}: hint is {w.get('hint')!r}, expected {old!r}")
            if r in NOTES:
                field, old, new = NOTES[r]
                if old in w.get(field, ""):
                    changed.append(f"{r} {w['trad']} {field}: {old!r} -> {new!r}")
                    w[field] = w[field].replace(old, new)
                elif new not in w.get(field, ""):
                    conflicts.append(f"{r} {w['trad']}: {field} has neither {old!r} nor {new!r}")
    for c in changed:
        print(c)
    for c in conflicts:
        print("CONFLICT " + c)
    print(f"== {len(changed)} changes, {len(conflicts)} conflicts ==")
    if conflicts:
        return 1
    if args.write and changed:
        for path, words in files:
            path.write_text(json.dumps(words, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print("written; now run scripts/data/build_words.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
