"""Merge data/enriched/chunk-*.json into src/data/words.json (the app's Word[] contract, src/data/types.ts).

Run:  ./.venv/Scripts/python scripts/data/build_words.py [--check] [--quiet]

  --check   validate and print everything, but do not write words.json or ids.lock.json
  --quiet   do not print the spokenAs review list

What it does
  * id: "w" + lowercase hex code points of trad joined by "-" (你好 -> w4f60-597d). If two entries share a
    trad, the later one (by rank) gets "~" + pinyinNumbered without spaces. Ids are pinned forever in
    data/ids.lock.json ("trad|reading" -> id). Existing ids are always reused; if a word's reading is edited
    its id follows it; ids of removed words stay reserved in the lock and are never handed out again.
  * simp / example.simp: OpenCC tw2s.
  * pinyinNumbered ("ni3 hao3", neutral = 5, ü = v) and tones, from the tone-marked pinyin. Every syllable is
    checked against a table of valid Mandarin syllables and against the canonical tone-mark position.
  * spokenAs: derived by rule (3rd-tone sandhi, 不 and 一 tone changes), only when it differs from pinyin.
  * Validation of the whole dataset. Exit status 1 and every failure printed if anything is wrong. This includes
    the Say-card prompt rules: no two words with an identical gloss + hint, and no hint containing the word's own
    pinyin. (Overlapping-but-not-identical prompts are reviewed with scripts/data/prompt_groups.py.)
    It also includes the mechanical example-pinyin orthography rules (GB/T 16159 spacing: particles such as le,
    ma, ne, ba, de are separate words; dì-yī; yībǎi; capitals only at sentence starts and on proper nouns) and
    text style (single quotes, no period at the end of a hint). Lexical spacing decisions (which strings are
    one word) are audited and normalized by scripts/data/pinyin_spacing.py.
Warnings (printed, non-fatal) flag things worth a human look: example syllables that pypinyin does not know
for that character, headword readings that match neither MOE nor CEDICT.
"""
from __future__ import annotations

import argparse
import glob
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHUNKS = ROOT / "data" / "enriched"
SELECTED = ROOT / "data" / "selected.json"
LOCK = ROOT / "data" / "ids.lock.json"
OUT = ROOT / "src" / "data" / "words.json"

# ---------------------------------------------------------------------------------------------------------
# Valid Mandarin syllables (toneless, ü written v). Standard Hanyu Pinyin table plus the handful of
# interjection/colloquial syllables that occur in dictionaries (o, yo, lo, dia, den, nen, shei, zhei...).
SYLLABLES = set(
    """
    a ai an ang ao e ei en eng er o ou
    yi ya yao ye you yan yin yang ying yong yu yue yuan yun yo
    wu wa wo wai wei wan wen wang weng
    ba bo bai bei bao ban ben bang beng bi biao bie bian bin bing bu
    pa po pai pei pao pou pan pen pang peng pi piao pie pian pin ping pu
    ma mo me mai mei mao mou man men mang meng mi miao mie miu mian min ming mu
    fa fo fei fou fan fen fang feng fu
    da de dai dei dao dou dan den dang deng dong di dia diao die diu dian ding du duo dui duan dun
    ta te tai tei tao tou tan tang teng tong ti tiao tie tian ting tu tuo tui tuan tun
    na ne nai nei nao nou nan nen nang neng nong ni niao nie niu nian nin niang ning nu nuo nuan nun nv nve
    la le lo lai lei lao lou lan lang leng long li lia liao lie liu lian lin liang ling lu luo luan lun lv lve
    ga ge gai gei gao gou gan gen gang geng gong gu gua guo guai gui guan gun guang
    ka ke kai kei kao kou kan ken kang keng kong ku kua kuo kuai kui kuan kun kuang
    ha he hai hei hao hou han hen hang heng hong hu hua huo huai hui huan hun huang
    ji jia jiao jie jiu jian jin jiang jing jiong ju jue juan jun
    qi qia qiao qie qiu qian qin qiang qing qiong qu que quan qun
    xi xia xiao xie xiu xian xin xiang xing xiong xu xue xuan xun
    zha zhe zhi zhai zhei zhao zhou zhan zhen zhang zheng zhong zhu zhua zhuo zhuai zhui zhuan zhun zhuang
    cha che chi chai chao chou chan chen chang cheng chong chu chua chuo chuai chui chuan chun chuang
    sha she shi shai shei shao shou shan shen shang sheng shu shua shuo shuai shui shuan shun shuang
    re ri rao rou ran ren rang reng rong ru rua ruo rui ruan run
    za ze zi zai zei zao zou zan zen zang zeng zong zu zuo zui zuan zun
    ca ce ci cai cao cou can cen cang ceng cong cu cuo cui cuan cun
    sa se si sai sao sou san sen sang seng song su suo sui suan sun
    """.split()
)

TONE_MARKS = {
    "ā": ("a", 1), "á": ("a", 2), "ǎ": ("a", 3), "à": ("a", 4),
    "ē": ("e", 1), "é": ("e", 2), "ě": ("e", 3), "è": ("e", 4),
    "ī": ("i", 1), "í": ("i", 2), "ǐ": ("i", 3), "ì": ("i", 4),
    "ō": ("o", 1), "ó": ("o", 2), "ǒ": ("o", 3), "ò": ("o", 4),
    "ū": ("u", 1), "ú": ("u", 2), "ǔ": ("u", 3), "ù": ("u", 4),
    "ǖ": ("v", 1), "ǘ": ("v", 2), "ǚ": ("v", 3), "ǜ": ("v", 4),
}
MARK_OF = {(b, t): m for m, (b, t) in TONE_MARKS.items()}
PUNCT_PINYIN = ".,?!;:\"“”‘’()…—"
HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
LATIN_OR_DIGIT = re.compile(r"[A-Za-z0-9０-９Ａ-Ｚａ-ｚ]")


def parse_syllable(syl: str) -> tuple[str, int, int]:
    """'hǎo' -> ('hao', 3, number_of_tone_marks). Toneless base uses v for ü; neutral = 5."""
    base, tone, marks = [], 5, 0
    for ch in unicodedata.normalize("NFC", syl.lower()):
        if ch in TONE_MARKS:
            b, t = TONE_MARKS[ch]
            base.append(b)
            tone, marks = t, marks + 1
        elif ch == "ü":
            base.append("v")
        else:
            base.append(ch)
    return "".join(base), tone, marks


def mark(base: str, tone: int) -> str:
    """('hao', 3) -> 'hǎo'; ('nv', 4) -> 'nǜ'; tone 5 -> no mark. Standard placement: a/e first, then the o
    of ou, otherwise the last vowel."""
    if tone == 5:
        return base.replace("v", "ü")
    if "a" in base:
        i = base.index("a")
    elif "e" in base:
        i = base.index("e")
    elif "ou" in base:
        i = base.index("o")
    else:
        i = max(base.rfind(v) for v in "iouv")
    if i < 0:
        raise ValueError(base)
    s = base[:i] + MARK_OF[(base[i], tone)] + base[i + 1:]
    return s.replace("v", "ü")


def segment(chunk: str) -> list[list[str]]:
    """All ways to split one apostrophe-free pinyin chunk (e.g. 'péngyǒu') into valid syllables, each with at
    most one tone mark. A vowel-initial syllable (a/o/e) may only start the chunk: inside a word it would need
    an apostrophe (xī'ān), so that constraint makes the split essentially unique."""
    low = unicodedata.normalize("NFC", chunk.lower())
    n = len(low)
    memo: dict[int, list[list[str]]] = {}

    def go(i: int) -> list[list[str]]:
        if i == n:
            return [[]]
        if i in memo:
            return memo[i]
        res = []
        for j in range(i + 1, min(n, i + 6) + 1):
            piece = low[i:j]
            base, _, marks = parse_syllable(piece)
            if marks > 1 or base not in SYLLABLES:
                continue
            if i > 0 and base[0] in "aoe":
                continue
            for rest in go(j):
                res.append([chunk[i:j]] + rest)
        memo[i] = res
        return res

    return go(0)


# A pinyin word in an example sentence: letters (tone marks included), with ' (xī'ān) or - (dì-yī) inside.
PY_TOKEN = re.compile(r"[^\W\d_]+(?:['\-][^\W\d_]+)*")


def example_tokens(pinyin: str) -> tuple[list[dict] | None, str | None]:
    """Split a sentence's pinyin into its written words. Returns (tokens, error). Each token is
    {"text", "start", "end", "syls": [syllable, ...], "joins": [joiner between consecutive syllables: "", "'" or "-"]}.
    Anything between words must be spaces or PUNCT_PINYIN."""
    tokens: list[dict] = []
    pos = 0
    for m in PY_TOKEN.finditer(pinyin):
        gap = pinyin[pos:m.start()]
        if any(c not in PUNCT_PINYIN and not c.isspace() for c in gap):
            return None, f"unexpected text {gap!r} between pinyin words"
        pos = m.end()
        syls: list[str] = []
        joins: list[str] = []
        pending = ""
        for k, piece in enumerate(re.split(r"(['\-])", m.group(0))):
            if k % 2:
                pending = piece
                continue
            segs = segment(piece)
            if not segs:
                return None, f"cannot split {piece!r} into valid syllables"
            if len({len(s) for s in segs}) > 1:
                return None, f"ambiguous syllable split of {piece!r}: {segs}"
            for j, s in enumerate(segs[0]):
                if syls:
                    joins.append(pending if j == 0 else "")
                syls.append(s)
        tokens.append({"text": m.group(0), "start": m.start(), "end": m.end(), "syls": syls, "joins": joins})
    gap = pinyin[pos:]
    if any(c not in PUNCT_PINYIN and not c.isspace() for c in gap):
        return None, f"unexpected text {gap!r} after the last pinyin word"
    return tokens, None


def example_syllables(pinyin: str) -> tuple[list[str] | None, str | None]:
    """Split a sentence's pinyin into syllables. Returns (syllables, error)."""
    toks, err = example_tokens(pinyin)
    if err:
        return None, err
    return [s for t in toks for s in t["syls"]], None


# ---------------------------------------------------------------------------------------------------------
# Example-pinyin orthography: word spacing per GB/T 16159 (see data/NOTES.md, "Polish"). Only the mechanical
# rules are enforced here. Which strings count as one word (zhège, bùyào, huíjiā vs měi tiān, bù huì, dǎ qiú)
# is a lexical decision recorded in scripts/data/pinyin_spacing.py, which audits and normalizes it.

NUMERALS = set("零一二三四五六七八九十兩")
BIG_NUMERALS = set("百千萬億")
# Sentence particles are always their own word, except inside these lexical words.
STANDALONE_PARTICLES = set("嗎呢吧啊啦喔耶呀嘛哦")
PARTICLE_WORDS = {"幹嘛"}
# 了 read le is its own word (aspect and sentence-final alike), except inside these words.
LE_WORDS = {"為了", "除了", "算了", "罷了", "受不了", "不得了"}
# 的 / 得 / 地 read de are their own word, except inside these words.
DE_WORDS = {"真的", "別的", "有的", "是的", "似的", "覺得", "記得", "值得", "懂得", "曉得", "顯得", "免得", "捨得", "使得"}
# Proper nouns: always capitalised. A name in PROPER_PREFIXES also capitalises a word it starts (台灣人 Táiwānrén).
PROPER_NOUNS = {"母親節", "王"}
PROPER_PREFIXES = {"台灣", "台北", "日本", "美國", "中國", "中文", "英文"}


def is_proper(word: str) -> bool:
    return word in PROPER_NOUNS or any(word.startswith(p) for p in PROPER_PREFIXES)


def sentence_starts(pinyin: str, toks: list[dict]) -> list[bool]:
    """Whether each token starts a sentence: the first one, and any after . ? ! in the gap before it."""
    out = []
    prev_end = 0
    for i, t in enumerate(toks):
        gap = pinyin[prev_end:t["start"]]
        out.append(i == 0 or any(c in ".?!" for c in gap))
        prev_end = t["end"]
    return out


def orthography_errors(han: list[str], pinyin: str, toks: list[dict]) -> list[str]:
    """Mechanical spacing/capitalisation rules for one example. han: its Han characters (as many as syllables)."""
    errs: list[str] = []
    words: list[str] = []
    i = 0
    for t in toks:
        words.append("".join(han[i:i + len(t["syls"])]))
        i += len(t["syls"])
    starts = sentence_starts(pinyin, toks)
    for t, w, start in zip(toks, words, starts):
        text = t["text"]
        bases = [parse_syllable(s)[0] if parse_syllable(s)[1] == 5 else None for s in t["syls"]]  # neutral only
        # Capitalisation: sentence starts and proper nouns, nothing else; only the first letter of a word.
        if any(c.isupper() for c in text[1:]):
            errs.append(f"capital letter inside the word {text!r}")
        if start and not text[0].isupper():
            errs.append(f"sentence must start with a capital: {text!r}")
        if is_proper(w) and not text[0].isupper():
            errs.append(f"proper noun {w} must be capitalised: {text!r}")
        if text[0].isupper() and not start and not is_proper(w):
            errs.append(f"{text!r} ({w}) is capitalised mid-sentence; add it to PROPER_NOUNS if it is a name")
        if len(w) > 1:
            for j, ch in enumerate(w):
                if ch in STANDALONE_PARTICLES and w not in PARTICLE_WORDS:
                    errs.append(f"particle {ch} must be written as its own word: {text!r} ({w})")
                elif ch == "了" and bases[j] == "le" and w not in LE_WORDS:
                    errs.append(f"了 le must be written as its own word: {text!r} ({w})")
                elif ch in "的得地" and bases[j] == "de" and w not in DE_WORDS:
                    errs.append(f"{ch} de must be written as its own word: {text!r} ({w})")
        if w == "們":
            errs.append("們 men must be joined to the word before it")
        # Joiners inside the word.
        for j, jn in enumerate(t["joins"]):
            nxt = t["syls"][j + 1]
            if jn == "'" and nxt[0].lower() not in "aoeāáǎàēéěèōóǒò":
                errs.append(f"apostrophe before a syllable that does not start with a/o/e: {text!r}")
            if jn == "-" and w[j] != "第":
                errs.append(f"hyphen is only used after 第 (dì-yī): {text!r}")
    # Numbers (GB/T 16159 6.1.5): 第 + numeral takes a hyphen; a digit + 百/千/萬/億 is written together.
    flat = "".join(words)
    bnd: list[str | None] = []  # joiner between flat[k] and flat[k+1]; None = separate words
    for t in toks:
        bnd.extend(t["joins"])
        bnd.append(None)
    for k in range(len(flat) - 1):
        if flat[k] == "第" and flat[k + 1] in NUMERALS and bnd[k] != "-":
            errs.append(f"write 第 + numeral with a hyphen (dì-yī): {flat[k:k + 2]}")
        if flat[k] in NUMERALS and flat[k + 1] in BIG_NUMERALS and bnd[k] != "":
            errs.append(f"write a digit + {flat[k + 1]} as one word (yībǎi, sānwàn): {flat[k:k + 2]}")
    return errs


# ---------------------------------------------------------------------------------------------------------
# spokenAs

NUMERAL_DIGITS = set("零一二三四五六七八九十兩")
_DEFAULT_TONE_CACHE: dict[str, int] = {}


def default_tone(ch: str) -> int:
    """Underlying (citation) tone of a character written with a neutral tone, from pypinyin's default reading."""
    if ch not in _DEFAULT_TONE_CACHE:
        from pypinyin import Style, pinyin

        r = pinyin(ch, style=Style.TONE3, neutral_tone_with_five=True)[0][0]
        _DEFAULT_TONE_CACHE[ch] = int(r[-1]) if r and r[-1].isdigit() else 5
    return _DEFAULT_TONE_CACHE[ch]


_JIEBA = None


def is_word(s: str) -> bool:
    """Whether s (Traditional) is a dictionary word, for grouping 3-syllable all-3rd-tone words."""
    global _JIEBA
    if _JIEBA is None:
        import logging

        import jieba

        jieba.setLogLevel(logging.ERROR)
        jieba.initialize()
        _JIEBA = jieba
    return any(_JIEBA.dt.FREQ.get(v, 0) > 0 for v in {s, to_simp(s)})


def compute_spoken(trad: str, bases: list[str], tones: list[int], log: list[str]) -> list[int]:
    """Tones as spoken. log receives a line for every rule decision worth reviewing."""
    n = len(tones)
    spoken = list(tones)

    def underlying(i: int) -> int:
        if tones[i] != 5:
            return tones[i]
        t = default_tone(trad[i])
        log.append(f"{trad}: next syllable {trad[i]} is written neutral; using its underlying tone {t}")
        return t

    for i, ch in enumerate(trad):
        if ch == "不" and bases[i] == "bu" and tones[i] == 4 and i + 1 < n:
            if underlying(i + 1) == 4:
                spoken[i] = 2
        elif ch == "一" and bases[i] == "yi" and tones[i] == 1:
            if i + 1 >= n:
                continue  # word-final: 統一, 唯一, 萬一
            if i > 0 and (trad[i - 1] == "第" or trad[i - 1] in NUMERAL_DIGITS):
                log.append(f"{trad}: 一 stays yī (ordinal / number compound)")
                continue
            if trad[i + 1] in NUMERAL_DIGITS or trad[i + 1] in "月號":
                log.append(f"{trad}: 一 stays yī (counting digit / date)")
                continue
            t = underlying(i + 1)
            if t == 4:
                spoken[i] = 2
            elif t in (1, 2, 3):
                spoken[i] = 4
            else:
                log.append(f"{trad}: 一 before an underlying neutral tone; left as yī (unsure)")

    # 3rd-tone sandhi on runs of written 3rd tones.
    i = 0
    while i < n:
        if tones[i] != 3:
            i += 1
            continue
        j = i
        while j < n and tones[j] == 3:
            j += 1
        run = j - i
        if run == 2:
            spoken[i] = 2
        elif run == 3:
            left, right = trad[i:i + 2], trad[i + 1:i + 3]
            lw, rw = is_word(left), is_word(right)
            if lw and not rw:  # [AB]C: both A and B rise (展覽館 zhán lán guǎn)
                spoken[i] = spoken[i + 1] = 2
                log.append(f"{trad}: 3-3-3 grouped [{left}]{trad[i + 2]} -> 2-2-3")
            elif rw and not lw:  # A[BC]: only B rises (小老虎 xiǎo láo hǔ)
                spoken[i + 1] = 2
                log.append(f"{trad}: 3-3-3 grouped {trad[i]}[{right}] -> 3-2-3")
            else:
                log.append(f"{trad}: 3-3-3 grouping unclear ({left}:{lw}, {right}:{rw}); 3rd-tone sandhi skipped")
        elif run > 3:
            log.append(f"{trad}: run of {run} third tones; 3rd-tone sandhi skipped")
        if j < n and tones[j] == 5 and tones[j - 1] == 3 and default_tone(trad[j]) == 3:
            log.append(f"{trad}: 3rd tone before neutral {trad[j]} (underlying 3); sandhi depends on the word, skipped")
        i = j
    return spoken


# ---------------------------------------------------------------------------------------------------------

_CC = None


def to_simp(s: str) -> str:
    global _CC
    if _CC is None:
        import opencc

        _CC = opencc.OpenCC("tw2s")
    return _CC.convert(s)


def code_id(trad: str) -> str:
    return "w" + "-".join(format(ord(c), "x") for c in trad)


def assign_ids(words: list[dict], lock: dict[str, str], notices: list[str]) -> dict[str, str]:
    """words: in rank order, each with trad and reading. Mutates lock. Returns key->id for this run."""
    claimed: set[str] = set()
    for w in words:
        w["_key"] = f"{w['trad']}|{w['_reading']}"
        if w["_key"] in lock and lock[w["_key"]] not in claimed:
            w["id"] = lock[w["_key"]]
            claimed.add(w["id"])
    # Reading edited since the id was pinned: the id follows the word (same trad, unclaimed lock entry).
    for w in words:
        if w.get("id"):
            continue
        for k, v in list(lock.items()):
            if k.split("|", 1)[0] == w["trad"] and v not in claimed:
                if any(o["_key"] == k for o in words):
                    continue
                notices.append(f"reading of {w['trad']} changed ({k} -> {w['_key']}); keeping id {v}")
                del lock[k]
                lock[w["_key"]] = v
                w["id"] = v
                claimed.add(v)
                break
    reserved = set(lock.values())
    for w in words:
        if w.get("id"):
            continue
        cand = code_id(w["trad"])
        if cand in reserved or cand in claimed:
            cand = f"{cand}~{w['_reading']}"
        if cand in reserved or cand in claimed:
            raise SystemExit(f"cannot assign a unique id to {w['_key']}")
        notices.append(f"new id {cand} for {w['_key']}")
        w["id"] = cand
        lock[w["_key"]] = cand
        claimed.add(cand)
        reserved.add(cand)
    return lock


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="validate only; do not write outputs")
    ap.add_argument("--quiet", action="store_true", help="do not print the spokenAs review list")
    args = ap.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    raw: list[tuple[str, dict]] = []
    for f in sorted(glob.glob(str(CHUNKS / "chunk-*.json"))):
        data = json.loads(Path(f).read_text(encoding="utf-8"))
        if not isinstance(data, list):
            errors.append(f"{Path(f).name}: top level is not a list")
            continue
        raw += [(Path(f).name, w) for w in data]
    if not raw:
        print("no chunk files found", file=sys.stderr)
        return 1

    selected = {}
    if SELECTED.exists():
        selected = {s["rank"]: s for s in json.loads(SELECTED.read_text(encoding="utf-8"))}

    REQUIRED = ["rank", "trad", "pinyin", "gloss", "pos", "example"]
    ALLOWED = set(REQUIRED) | {"hint", "note"}
    EX_REQUIRED = ["trad", "pinyin", "english"]

    entries = []
    for src, w in raw:
        where = f"{src} rank {w.get('rank')} {w.get('trad', '?')}"
        bad = False
        for k in REQUIRED:
            if k not in w:
                errors.append(f"{where}: missing field {k}")
                bad = True
        for k in w:
            if k not in ALLOWED:
                errors.append(f"{where}: unexpected field {k} (spokenAs/ids/simp are computed by this script)")
        for k, v in w.items():
            if k == "example":
                continue
            if k == "rank":
                if not isinstance(v, int) or isinstance(v, bool):
                    errors.append(f"{where}: rank is not an integer")
                    bad = True
            elif not isinstance(v, str) or not v.strip():
                errors.append(f"{where}: field {k} is empty or not a string")
                bad = True
            elif v != v.strip():
                errors.append(f"{where}: field {k} has leading/trailing whitespace")
        ex = w.get("example")
        if not isinstance(ex, dict):
            errors.append(f"{where}: example missing or not an object")
            bad = True
        else:
            for k in EX_REQUIRED:
                if not isinstance(ex.get(k), str) or not ex[k].strip():
                    errors.append(f"{where}: example.{k} missing or empty")
                    bad = True
            for k in ex:
                if k not in EX_REQUIRED:
                    errors.append(f"{where}: unexpected example field {k}")
        if bad:
            continue
        entries.append((src, where, w))

    # Ranks 1..N contiguous and unique (checked over every chunk entry, even ones with other errors).
    raw_ranks = [w.get("rank") for _, w in raw if isinstance(w.get("rank"), int)]
    if sorted(raw_ranks) != list(range(1, len(raw) + 1)):
        seen, dup = set(), set()
        for r in raw_ranks:
            (dup if r in seen else seen).add(r)
        missing = sorted(set(range(1, len(raw) + 1)) - seen)
        extra = sorted(r for r in seen if not 1 <= r <= len(raw))
        errors.append(f"ranks are not 1..{len(raw)}: duplicates {sorted(dup)}, missing {missing}, out of range {extra}")
    entries.sort(key=lambda e: e[2]["rank"])

    words = []
    review: list[str] = []
    for src, where, w in entries:
        trad = w["trad"]
        if not all(HAN.fullmatch(c) for c in trad):
            errors.append(f"{where}: trad contains non-Han characters")
            continue
        if selected and selected.get(w["rank"], {}).get("trad") != trad:
            warnings.append(f"{where}: selected.json has {selected.get(w['rank'], {}).get('trad')} at this rank")
        # Headword pinyin: lowercase, one space-separated syllable per character.
        syls = w["pinyin"].split(" ")
        if w["pinyin"] != w["pinyin"].lower():
            errors.append(f"{where}: headword pinyin {w['pinyin']!r} has capitals")
        if len(syls) != len(trad):
            errors.append(f"{where}: {len(syls)} pinyin syllables for {len(trad)} characters ({w['pinyin']!r})")
            continue
        bases, tones, ok = [], [], True
        for s in syls:
            base, tone, marks = parse_syllable(s)
            if base not in SYLLABLES:
                errors.append(f"{where}: invalid syllable {s!r}")
                ok = False
            elif marks > 1:
                errors.append(f"{where}: more than one tone mark in {s!r}")
                ok = False
            elif mark(base, tone) != unicodedata.normalize("NFC", s):
                errors.append(f"{where}: tone mark misplaced in {s!r} (expected {mark(base, tone)!r})")
                ok = False
            bases.append(base)
            tones.append(tone)
        if not ok:
            continue
        reading = " ".join(f"{b}{t}" for b, t in zip(bases, tones))

        # Soft check: headword reading against MOE / CEDICT.
        sel = selected.get(w["rank"])
        if sel and sel.get("trad") == trad:
            dict_readings = {r["pinyin"] for r in sel.get("cedict", []) + sel.get("moe", [])}
            if dict_readings and w["pinyin"] not in dict_readings:
                tl = lambda p: " ".join(parse_syllable(x)[0] for x in p.split())  # noqa: E731
                kind = "toneless reading also differs" if tl(w["pinyin"]) not in {tl(r) for r in dict_readings} else "tones differ"
                warnings.append(f"{where}: pinyin {w['pinyin']!r} not in MOE/CEDICT {sorted(dict_readings)} ({kind})")

        # spokenAs
        log: list[str] = []
        sp = compute_spoken(trad, bases, tones, log)
        spoken_as = None
        if sp != tones:
            spoken_as = " ".join(mark(b, t) for b, t in zip(bases, sp))
            review.append(f"{w['rank']:>4} {trad}  {w['pinyin']}  ->  {spoken_as}")
        for line in log:
            review.append(f"     note: {line}")

        # Example
        ex = w["example"]
        if LATIN_OR_DIGIT.search(ex["trad"]):
            errors.append(f"{where}: example.trad contains Latin letters or digits: {ex['trad']!r}")
        han = HAN.findall(ex["trad"])
        ex_toks, err = example_tokens(ex["pinyin"])
        ex_syls = [s for t in ex_toks for s in t["syls"]] if ex_toks is not None else None
        if err:
            errors.append(f"{where}: example.pinyin {ex['pinyin']!r}: {err}")
        elif len(ex_syls) != len(han):
            errors.append(
                f"{where}: example has {len(han)} characters but {len(ex_syls)} pinyin syllables: "
                f"{ex['trad']!r} / {ex['pinyin']!r}"
            )
        else:
            for e in orthography_errors(han, ex["pinyin"], ex_toks):
                errors.append(f"{where}: example.pinyin {ex['pinyin']!r}: {e}")
            for s in ex_syls:
                base, tone, _ = parse_syllable(s)
                if mark(base, tone) != unicodedata.normalize("NFC", s.lower()):
                    errors.append(f"{where}: example tone mark misplaced in {s!r} (expected {mark(base, tone)!r})")
            # Soft check: each syllable is a known reading of its character (pypinyin, any heteronym).
            from pypinyin import Style, pinyin as pp

            for ch, s in zip(han, ex_syls):
                known = set()
                for v in {ch, to_simp(ch)}:
                    for r in pp(v, style=Style.NORMAL, heteronym=True)[0]:
                        known.add(r.replace("ü", "v"))
                if parse_syllable(s)[0] not in known:
                    warnings.append(f"{where}: example syllable {s!r} for {ch} not a pypinyin reading {sorted(known)}")

        if len(w["gloss"]) > 60:
            errors.append(f"{where}: gloss longer than 60 characters ({len(w['gloss'])})")
        if HAN.search(w.get("hint", "")):
            warnings.append(f"{where}: hint contains Chinese characters (the learner can't read them)")
        # Text style (data/NOTES.md, "Polish"): quoted English uses single quotes; hints are short fragments.
        for k in ("gloss", "hint", "note"):
            if '"' in w.get(k, ""):
                errors.append(f"{where}: {k} uses double quotes; quote English with single quotes ('my')")
        if w.get("hint", "").endswith("."):
            errors.append(f"{where}: hint ends with a period (hints are fragments: {w['hint']!r})")

        out = {
            "id": None,
            "rank": w["rank"],
            "trad": trad,
            "simp": to_simp(trad),
            "pinyin": w["pinyin"],
            "pinyinNumbered": reading,
            "tones": tones,
        }
        if spoken_as:
            out["spokenAs"] = spoken_as
        out["gloss"] = w["gloss"]
        if "hint" in w:
            out["hint"] = w["hint"]
        out["pos"] = w["pos"]
        if "note" in w:
            out["note"] = w["note"]
        out["example"] = {
            "trad": ex["trad"],
            "simp": to_simp(ex["trad"]),
            "pinyin": ex["pinyin"],
            "english": ex["english"],
        }
        out["_reading"] = reading.replace(" ", "")
        words.append(out)

    # Say card (English -> Chinese) prompt checks. The learner sees only gloss + hint (+ pos), so:
    #  * two words may never share an identical gloss + hint prompt (compared case-, space- and
    #    trailing-punctuation-insensitively). Near-duplicates are reviewed with scripts/data/prompt_groups.py.
    #  * a hint must not contain the word's own pinyin (it would give the answer away).
    def norm_prompt(s: str) -> str:
        return re.sub(r"\s+", " ", unicodedata.normalize("NFC", s)).strip().strip(".!?…").strip().lower()

    prompts: dict[tuple[str, str], list[str]] = {}
    for o in words:
        key = (norm_prompt(o["gloss"]), norm_prompt(o.get("hint", "")))
        prompts.setdefault(key, []).append(f"{o['rank']} {o['trad']}")
    for (g, h), who in prompts.items():
        if len(who) > 1:
            errors.append(f"identical Say-card prompt (gloss {g!r} / hint {h!r}): {', '.join(who)}")
    for o in words:
        hint = o.get("hint")
        if not hint:
            continue
        own = [unicodedata.normalize("NFC", s.lower()) for s in o["pinyin"].split(" ")]
        toks = re.findall(r"[^\W\d_]+", unicodedata.normalize("NFC", hint.lower()))
        joined = "".join(own)
        leak = joined in toks or any(toks[i:i + len(own)] == own for i in range(len(toks) - len(own) + 1))
        if leak:
            errors.append(f"rank {o['rank']} {o['trad']}: hint {hint!r} contains the word's own pinyin {o['pinyin']!r}")

    # Ids
    lock: dict[str, str] = {}
    if LOCK.exists():
        lock = json.loads(LOCK.read_text(encoding="utf-8"))
    notices: list[str] = []
    if words and len(words) == len(raw):
        assign_ids(words, lock, notices)
        ids = [o["id"] for o in words]
        if len(set(ids)) != len(ids):
            errors.append("duplicate ids")
        for o in words:
            if not re.fullmatch(r"w[0-9a-f]+(-[0-9a-f]+)*(~[a-z0-9]+)?", o["id"]):
                errors.append(f"rank {o['rank']} {o['trad']}: malformed id {o['id']!r}")

    if not args.quiet:
        print(f"== spokenAs ({sum(1 for o in words if 'spokenAs' in o)} words) and sandhi notes ==")
        for line in review:
            print(line)
    new_ids = [n for n in notices if n.startswith("new id")]
    other = [n for n in notices if not n.startswith("new id")]
    if all(o.get("id") for o in words):
        print(f"== ids: {len(words) - len(new_ids)} reused from data/ids.lock.json, {len(new_ids)} new ==")
    else:
        print("== ids: not assigned (fix the errors below first) ==")
    for n in other:
        print("  " + n)
    if warnings:
        print(f"== {len(warnings)} warnings (non-fatal) ==")
        for wmsg in warnings:
            print("  WARN " + wmsg)
    if errors:
        print(f"== {len(errors)} ERRORS ==")
        for e in errors:
            print("  ERROR " + e)
        print("words.json NOT written")
        return 1

    for o in words:
        o.pop("_reading", None)
        o.pop("_key", None)
    if args.check:
        print(f"OK: {len(words)} words validated (--check: nothing written)")
        return 0
    text = json.dumps(words, ensure_ascii=False, indent=2)
    # One line per tones array: shorter file, readable diffs.
    text = re.sub(
        r'"tones": \[\s*([0-9,\s]+?)\s*\]',
        lambda m: '"tones": [' + ", ".join(t.strip() for t in m.group(1).split(",")) + "]",
        text,
    )
    OUT.write_text(text + "\n", encoding="utf-8")
    LOCK.write_text(json.dumps(dict(sorted(lock.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"OK: wrote {len(words)} words to {OUT} and {len(lock)} ids to {LOCK}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
