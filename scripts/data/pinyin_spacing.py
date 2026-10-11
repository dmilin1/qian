"""Audit and normalize word spacing and capitalization in example-sentence pinyin (data/enriched/chunk-*.json).

Run:  ./.venv/Scripts/python scripts/data/pinyin_spacing.py [--write] [--jieba]

  (default)  print every change the rules would make, as a reviewable before/after list, plus a consistency
             report. Exit status 1 if any change is pending or any inconsistency is found.
  --write    apply the changes to the chunk files (then rerun build_words.py).
  --jieba    also list where the spacing differs from jieba's segmentation. This is informational only: jieba
             joins many phrases that the orthography rules write apart (yī ge, zhè jiā, hěn duō, dǎ diànhuà).

The convention is the Hanyu Pinyin orthography standard, GB/T 16159-2012, with one deliberate deviation (了 is
always its own word). The mechanical rules (particles, numbers, capitals) are enforced by build_words.py; this
script also holds the lexical decisions: which character strings are written as one word and which apart.
Only spaces, apostrophes, hyphens and capital letters ever change. Syllables and tone marks never do, and the
script asserts that.
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_words as B  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CHUNKS = ROOT / "data" / "enriched"

# Written as one word wherever these characters stand as consecutive whole words (lexicalized words, GB 6.1.1;
# one-syllable verb + one-syllable complement, GB 6.1.4.3; verb + aspect 過, GB 6.1.4.1). An X不X question
# (要不要, 用不用) is never joined.
JOIN = {
    "不要", "不用", "真的", "真是", "別的", "沒事", "多久", "回家", "下雨", "洗手", "洗臉", "大部分",
    "走錯", "氣死", "穿反", "睡好", "提過",
}
# Written apart even when they were joined: 不/沒 + verb (GB 6.1.4), 這/那/每 + measure word (GB 6.1.6),
# 只 + modal. 這個/那個/哪個/這些/那些/這樣/這麼/這裡/這邊 stay one word (GB lists them as words).
SPLIT = {
    "每天": 1, "每個": 1, "這次": 1, "這種": 1, "那種": 1, "不是": 1, "只能": 1,
}
# Strings that are legitimately written both ways, depending on the sentence. The consistency report skips them.
CONTEXT_DEPENDENT = {
    "還是": "háishì 'or; still' vs hái shì 'is still' (他還是學生)",
    "還好": "háihǎo 'luckily; OK' vs hái hǎo 'still well' (身體還好嗎)",
    "就是": "jiùshì 'exactly' vs jiù shì 'is precisely' (時間就是金錢)",
    "只要": "zhǐyào 'as long as' vs zhǐ yào 'only want' (我只要一杯)",
    "個人": "gèrén 'personal' vs yī ge rén 'one person'",
    "不見": "bùjiàn 'missing' vs bù jiàn 'not see' (好久不見)",
    "到了": "dào le: 了 is always its own word",
}
PARTICLES = B.STANDALONE_PARTICLES | {"了", "的", "得", "地"}


def load() -> list[tuple[Path, list[dict]]]:
    return [(Path(f), json.loads(Path(f).read_text(encoding="utf-8"))) for f in sorted(glob.glob(str(CHUNKS / "chunk-*.json")))]


class Sentence:
    """Example pinyin as a flat list of syllables (one per Han character) with the boundary after each one:
    "" / "'" / "-" inside a word, or the separator text (" ", ", ", "? ") between words."""

    def __init__(self, trad: str, pinyin: str):
        toks, err = B.example_tokens(pinyin)
        if err:
            raise ValueError(err)
        self.han = B.HAN.findall(trad)
        self.syls = [s for t in toks for s in t["syls"]]
        if len(self.syls) != len(self.han):
            raise ValueError("character/syllable count mismatch")
        self.prefix = pinyin[: toks[0]["start"]]
        self.bnd: list[str] = []
        for i, t in enumerate(toks):
            self.bnd.extend(t["joins"])
            self.bnd.append(pinyin[t["end"]: toks[i + 1]["start"]] if i + 1 < len(toks) else pinyin[t["end"]:])

    def joined(self, k: int) -> bool:
        return self.bnd[k] in ("", "'", "-")

    def words(self) -> list[tuple[int, int]]:
        """(start, end) character spans of the written words."""
        out, s = [], 0
        for k in range(len(self.syls)):
            if not self.joined(k):
                out.append((s, k + 1))
                s = k + 1
        return out

    def set_join(self, k: int, how: str = "") -> None:
        if how == "" and B.parse_syllable(self.syls[k + 1])[0][0] in "aoe":
            how = "'"
        self.bnd[k] = how

    def set_split(self, k: int) -> None:
        if self.joined(k):
            self.bnd[k] = " "

    def render(self) -> str:
        spans = self.words()
        out = [self.prefix]
        sentence_start = True
        for s, e in spans:
            word = "".join(self.han[s:e])
            text = ""
            for k in range(s, e):
                text += self.syls[k].lower()
                if k < e - 1:
                    text += self.bnd[k]
            if sentence_start or B.is_proper(word):
                text = text[0].upper() + text[1:]
            out.append(text + self.bnd[e - 1])
            sentence_start = any(c in ".?!" for c in self.bnd[e - 1])
        return "".join(out)


def normalize(trad: str, pinyin: str) -> str:
    s = Sentence(trad, pinyin)
    han, n = s.han, len(s.han)
    whole = lambda a, b: (a == 0 or not s.joined(a - 1)) and (b == n or not s.joined(b - 1))  # noqa: E731
    # Particles stand alone, except inside the listed lexical words.
    for a, b in s.words():
        word = "".join(han[a:b])
        for k in range(a, b):
            ch, (base, tone, _) = han[k], B.parse_syllable(s.syls[k])
            alone = (ch in B.STANDALONE_PARTICLES and word not in B.PARTICLE_WORDS) or (
                tone == 5 and ((ch == "了" and base == "le" and word not in B.LE_WORDS)
                               or (ch in "的得地" and base == "de" and word not in B.DE_WORDS)))
            if alone and b - a > 1:
                if k > a:
                    s.set_split(k - 1)
                if k < b - 1:
                    s.set_split(k)
    # Lexical joins and splits.
    text = "".join(han)
    for w in JOIN:
        start = text.find(w)
        while start >= 0:
            end = start + len(w)
            a_not_a = w[0] in "不沒" and start > 0 and han[start - 1] == w[1]
            inner_plain = all(s.bnd[k] == " " or s.joined(k) for k in range(start, end - 1))
            if whole(start, end) and inner_plain and not a_not_a:
                for k in range(start, end - 1):
                    if not s.joined(k):
                        s.set_join(k)
            start = text.find(w, start + 1)
    for a, b in s.words():
        cut = SPLIT.get("".join(han[a:b]))
        if cut:
            s.set_split(a + cut - 1)
    # Numbers: 第 + numeral -> hyphen; digit + 百/千/萬/億 -> one word.
    for k in range(n - 1):
        if han[k] == "第" and han[k + 1] in B.NUMERALS and (s.bnd[k] == " " or s.joined(k)):
            s.bnd[k] = "-"
        if han[k] in B.NUMERALS and han[k + 1] in B.BIG_NUMERALS and s.bnd[k] == " ":
            s.set_join(k)
    out = s.render()
    before = [x.lower() for x in B.example_syllables(pinyin)[0]]
    after = [x.lower() for x in B.example_syllables(out)[0]]
    assert before == after, (pinyin, out)
    return out


def consistency(rows: list[tuple[int, str, str]]) -> list[str]:
    """Character strings written as one word in one example and as separate whole words in another."""
    as_word: dict[str, list[str]] = collections.defaultdict(list)
    sentences = []
    for rank, trad, pinyin in rows:
        s = Sentence(trad, pinyin)
        spans = s.words()
        words = ["".join(s.han[a:b]) for a, b in spans]
        sentences.append((rank, words))
        for w in words:
            if len(w) > 1:
                as_word[w].append(f"{rank}")
    out = []
    for target, where in sorted(as_word.items()):
        if target in CONTEXT_DEPENDENT:
            continue
        apart = []
        for rank, words in sentences:
            for i in range(len(words)):
                acc = ""
                for j in range(i, len(words)):
                    acc += words[j]
                    if len(acc) >= len(target):
                        break
                if acc == target and j > i:
                    if target[0] in "不沒" and i > 0 and words[i - 1] == target[1:]:
                        continue  # X不X question
                    apart.append(str(rank))
        if apart:
            out.append(f"{target}: one word in {', '.join(where)}; apart in {', '.join(apart)}")
    return out


def jieba_report(rows: list[tuple[int, str, str]]) -> list[str]:
    import logging

    import jieba

    jieba.setLogLevel(logging.ERROR)
    out = []
    for rank, trad, pinyin in rows:
        s = Sentence(trad, pinyin)
        ours = ["".join(s.han[a:b]) for a, b in s.words()]
        simp = B.to_simp("".join(s.han))
        theirs, i = [], 0
        for w in jieba.cut(simp, HMM=False):
            theirs.append("".join(s.han[i:i + len(w)]))
            i += len(w)
        if ours != theirs:
            out.append(f"{rank:>4}  ours: {' '.join(ours)}\n      jieba: {' '.join(theirs)}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="apply the changes to the chunk files")
    ap.add_argument("--jieba", action="store_true", help="also list differences from jieba's segmentation")
    args = ap.parse_args()

    files = load()
    changes = []
    rows = []
    for path, words in files:
        for w in words:
            ex = w["example"]
            new = normalize(ex["trad"], ex["pinyin"])
            if new != ex["pinyin"]:
                changes.append(f"{w['rank']:>4} {ex['trad']}\n      - {ex['pinyin']}\n      + {new}")
                ex["pinyin"] = new
            rows.append((w["rank"], ex["trad"], ex["pinyin"]))
    print(f"== {len(changes)} example pinyin changes ==")
    for c in changes:
        print(c)
    incons = consistency(rows)
    print(f"== {len(incons)} strings written both as one word and apart (after the changes above) ==")
    for line in incons:
        print("  " + line)
    if args.jieba:
        diffs = jieba_report(rows)
        print(f"== {len(diffs)} examples segmented differently by jieba (informational) ==")
        for d in diffs:
            print(d)
    if args.write and changes:
        for path, words in files:
            path.write_text(json.dumps(words, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {len(changes)} changes; now run scripts/data/build_words.py")
        return 1 if incons else 0
    return 1 if (changes or incons) else 0


if __name__ == "__main__":
    sys.exit(main())
