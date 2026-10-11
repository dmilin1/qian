"""Re-rank the enrichment chunks after data/selected.json changes (new order, words added or removed).

Run:  ./.venv/Scripts/python scripts/data/rechunk.py [--add NEW_ENTRIES.json ...] [--check]

  * Every authored entry in data/enriched/chunk-*.json is matched to selected.json by `trad`, and its `rank`
    is set from selected.json.
  * --add files hold authored entries for newly selected words. They use the same fields as chunk entries,
    and `rank` may be omitted.
  * Entries whose word is no longer selected are moved to data/enriched-removed.json. That file is appended
    and keyed by trad, so their authored text is kept if a word is ever re-added.
  * The chunks are rewritten as chunk-01..chunk-NN with 50 ranks each, in a uniform JSON format.
  * Exits 1 without writing anything if a selected word has no entry or a word has two entries.
Then run scripts/data/build_words.py to rebuild src/data/words.json.
"""
from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHUNKS = ROOT / "data" / "enriched"
SELECTED = ROOT / "data" / "selected.json"
REMOVED = ROOT / "data" / "enriched-removed.json"
PER_CHUNK = 50
KEY_ORDER = ["rank", "trad", "pinyin", "gloss", "hint", "pos", "note", "example"]


def ordered(e: dict) -> dict:
    out = {k: e[k] for k in KEY_ORDER if k in e}
    out.update({k: v for k, v in e.items() if k not in out})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--add", action="append", default=[], help="JSON file with authored entries for new words")
    ap.add_argument("--check", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    selected = json.loads(SELECTED.read_text(encoding="utf-8"))
    rank_of = {s["trad"]: s["rank"] for s in selected}
    errors: list[str] = []

    entries: dict[str, dict] = {}
    files = sorted(glob.glob(str(CHUNKS / "chunk-*.json")))
    for f in files:
        for e in json.loads(Path(f).read_text(encoding="utf-8")):
            if e["trad"] in entries:
                errors.append(f"{Path(f).name}: duplicate entry for {e['trad']}")
            entries[e["trad"]] = e
    added = []
    for f in args.add:
        for e in json.loads(Path(f).read_text(encoding="utf-8")):
            if e["trad"] in entries:
                errors.append(f"{f}: {e['trad']} already has an entry")
            entries[e["trad"]] = e
            added.append(e["trad"])

    missing = [t for t in rank_of if t not in entries]
    if missing:
        errors.append(f"selected words without an entry: {' '.join(missing)}")
    removed = {t: e for t, e in entries.items() if t not in rank_of}

    moved = 0
    for t, e in entries.items():
        if t in rank_of:
            if e.get("rank") != rank_of[t]:
                moved += 1
            e["rank"] = rank_of[t]
    print(f"{len(rank_of)} selected; {len(added)} new entries; {len(removed)} removed; {moved} rank changes")
    if removed:
        print("removed:", " ".join(sorted(removed, key=lambda t: removed[t].get("rank", 0))))
    if errors:
        for e in errors:
            print("ERROR", e, file=sys.stderr)
        return 1
    if args.check:
        return 0

    keep = sorted((e for t, e in entries.items() if t in rank_of), key=lambda e: e["rank"])
    if removed:
        old = json.loads(REMOVED.read_text(encoding="utf-8")) if REMOVED.exists() else {}
        for t, e in removed.items():
            e = dict(e)
            e.pop("rank", None)
            old[t] = ordered(e)
        REMOVED.write_text(json.dumps(old, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    for f in files:
        Path(f).unlink()
    for i in range(0, len(keep), PER_CHUNK):
        part = [ordered(e) for e in keep[i:i + PER_CHUNK]]
        out = CHUNKS / f"chunk-{i // PER_CHUNK + 1:02d}.json"
        out.write_text(json.dumps(part, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {(len(keep) + PER_CHUNK - 1) // PER_CHUNK} chunk files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
