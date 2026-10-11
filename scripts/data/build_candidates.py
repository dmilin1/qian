"""Build data/candidates.json: ranked candidate words for qian (Taiwan Mandarin, learn-by-ear).

Deterministic and re-runnable. Downloads sources into data/cache/ (gitignored) on first run,
then works offline. Usage (from the project root):

    ./.venv/Scripts/python scripts/data/build_candidates.py [--top 1400] [--offline]

Pipeline
  1. Frequencies: SUBTLEX-CH (Cai & Brysbaert 2010; film/TV subtitles, PoS-tagged combined file)
     and wordfreq 'zh' (multi-source). Both expressed on the Zipf scale (log10 per billion).
  2. Simplified -> Traditional/Taiwan with OpenCC s2twp (phrase-level). Erhua (儿) forms are merged
     into their Taiwan non-erhua form. Entries collapsing to the same Traditional form are merged
     (frequencies summed in linear space).
  3. Blended score = mean of the two Zipf values (dampens subtitle translationese and written-only
     vocabulary alike).
  4. Dictionaries: CC-CEDICT (all readings, compact defs) and MOE 重編國語辭典修訂本 (g0v moedict-data;
     all heteronyms; authority for Taiwan readings).
  5. Flags (nothing is removed here): proper nouns, fragments, non-Chinese, interjections,
     no-dictionary, translationese, subtitle/written skew, mainland-only vocabulary, ambiguous S->T, ...
"""

from __future__ import annotations

import argparse
import collections
import datetime
import gzip
import hashlib
import json
import lzma
import math
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
CACHE = DATA / "cache"

SOURCES = {
    "subtlex": {
        "url": "https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexch/subtlexch131210.zip",
        "path": CACHE / "subtlex" / "subtlexch131210.zip",
        "member": "SUBTLEX_CH_131210_CE.utf8",
    },
    "cedict": {
        "url": "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz",
        "path": CACHE / "cedict" / "cedict_1_0_ts_utf-8_mdbg.txt.gz",
    },
    "moedict": {
        "url": "https://raw.githubusercontent.com/g0v/moedict-data/main/dict-revised.json.xz",
        "path": CACHE / "moedict" / "dict-revised.json.xz",
    },
    "opencc_stchars": {
        "url": "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/STCharacters.txt",
        "path": CACHE / "opencc" / "STCharacters.txt",
    },
}

SUBTLEX_TOTAL_WORDS = 33_546_516  # "Total word count" stated in the SUBTLEX-CH distribution
POOL_SUBTLEX = 12000  # top-N SUBTLEX words considered
POOL_WORDFREQ = 12000  # top-N wordfreq words considered
BLEND_WEIGHT_SUBTLEX = 0.6  # slightly favour the spoken corpus (learning by ear); see data/NOTES.md
ZIPF_FLOOR = 1.0  # a word absent from one source gets this Zipf in that source
SKEW_THRESHOLD = 1.0  # Zipf difference between sources that triggers a skew flag

# ---------------------------------------------------------------------------------------------
# Curated lists (judgement calls; keys are Simplified as they appear in the corpora)
# ---------------------------------------------------------------------------------------------

# Subtitle translationese: frequent in dubbed/translated film subtitles, rare in real Taiwan speech.
TRANSLATIONESE = set(
    """该死 混蛋 上帝 长官 天哪 天呐 天啊 见鬼 伙计 老兄 婊子 狗屎 混账 陛下 阁下 先生们 女士们
    警长 探长 中士 上尉 少校 下士 中尉 上校 甜心 宝贝儿 蠢货 杂种 狗娘养 他妈的 妈的 谢天谢地
    老天 搞什么 天杀 见鬼去 去死 滚开 闭嘴吧 夫人 小姐们 伙计们 兄弟们 圣诞 女王 国王 王子 公主
    大人 主人 骑士 巫师 魔鬼 吸血鬼 僵尸 特工 局长 总统先生 舰长 船长 法官大人 陪审团 联邦调查局
    混球 狗杂种 臭婊子 贱人 王八蛋 笨蛋们""".split()
)

# Mainland-only (or mainland-meaning) vocabulary -> what Taiwan says instead.
# Applied only if OpenCC s2twp has not already converted the word to the Taiwan term.
MAINLAND_ONLY = {
    "土豆": "馬鈴薯 (土豆 = peanut in Taiwan)",
    "质量": "品質 (質量 = mass)",
    "视频": "影片",
    "信息": "訊息/資訊",
    "公交车": "公車",
    "公交": "公車",
    "酸奶": "優格/優酪乳",
    "卫生间": "洗手間/廁所",
    "摩托车": "機車",
    "西红柿": "番茄",
    "宾馆": "飯店/旅館",
    "酒店": "飯店 (酒店 can mean hostess club)",
    "盒饭": "便當",
    "快餐": "速食",
    "空调": "冷氣",
    "打的": "坐計程車",
    "打车": "叫車/坐計程車",
    "咋": "怎麼",
    "啥": "什麼",
    "俺": "我",
    "咱": "我們",
    "咱们": "我們",
    "哥们": "兄弟",
    "哥们儿": "兄弟",
    "水平": "水準",
    "博客": "部落格",
    "网吧": "網咖",
    "地铁": "捷運",
    "菠萝": "鳳梨",
    "红薯": "地瓜",
    "猕猴桃": "奇異果",
    "幼儿园": "幼稚園",
    "初中": "國中",
    "同志": "(同志 = gay in Taiwan)",
    "爱人": "老公/老婆/另一半 (愛人 = lover)",
    "领导": "老闆/主管/長官",
    "服务员": "服務生",
    "塑料": "塑膠",
    "互联网": "網路",
    "冰棍": "冰棒",
    "早上好": "早安",
    "晚上好": "晚安",
    "屏幕": "螢幕",
    "鼠标": "滑鼠",
    "软件": "軟體",
    "出租车": "計程車",
    "自行车": "腳踏車",
    "方便面": "泡麵",
    "短信": "簡訊",
    "激光": "雷射",
    "网上": "網路上",
    "搞定": "弄好/處理好",
    "挺": "很/蠻",
    "倍儿": "很",
    "贼": "(贼 = very is northern slang)",
    "忒": "太",
    "甭": "不用",
    "姥姥": "外婆",
    "姥爷": "外公",
    "小伙子": "年輕人",
    "小伙": "年輕人",
    "饭馆": "餐廳",
}

# OpenCC s2twp phrase conversions that are wrong for everyday Taiwan speech (mostly IT-jargon mappings
# such as 支持->支援, 打开->開啟, 消息->訊息, 对象->物件, 局部->區域性). For these we keep the
# character-level s2tw conversion. Reviewed against every s2twp phrase conversion in the candidate pool.
S2TWP_REJECT = set(
    """支持 项目 发布 发布会 社区 消息 好消息 最新消息 设备 文件 打开 类型 对象 高级 低级 运行 声明 发表声明
    循环 扩展 进程 查看 参数 审核 局部 全局 实例 安全局 分区 窗口 菜单 保存 用户 数据 程序 图库 刷新 屏蔽
    调用 交互 文档 集成 变量 激活 调度 查找 触摸 布尔 函数 比特 连接 图像 添加 优化 性能 组件""".split()
)

# Erhua forms whose Taiwan equivalent is not simply "drop the 儿".
ERHUA_TARGET = {
    "这儿": "这里",
    "那儿": "那里",
    "哪儿": "哪里",
    "这会儿": "这时候",
    "一会儿": "一会",
    "待会儿": "待会",
    "一块儿": "一起",
    "一点儿": "一点",
    "有点儿": "有点",
    "差点儿": "差点",
}
# Words ending in 儿 where 儿 is a real morpheme (not erhua) - never merged.
ERHUA_EXEMPT = set("会儿 女儿 儿 婴儿 孤儿 幼儿 胎儿 宠儿 健儿 混血儿 新生儿 男儿 儿儿 幸运儿".split())

# Characters that MOE files under a different (standard) form than OpenCC s2twp outputs.
MOE_VARIANTS = {"台": "臺", "着": "著", "裏": "裡", "麪": "麵", "綫": "線", "峯": "峰", "啓": "啟", "爲": "為", "眞": "真"}

PROPER_TAGS = {"nr": "person", "nrf": "person", "nrg": "person", "ns": "place", "nt": "org", "nz": "other"}
INTERJ_TAGS = {"e", "o"}  # 叹词 interjection, 拟声词 onomatopoeia
BOUND_TAGS = {"g", "k", "h", "Rg"}  # 语素 morpheme, 后缀 suffix, 前缀 prefix (ICTCLAS/PKU tagset)
VULGAR = set("操 他妈的 妈的 婊子 狗屎 混蛋 王八蛋 狗娘养 贱人 杂种 臭婊子 狗杂种".split())
NUMERALS = "零一二两三四五六七八九十百千万几半"
MEASURES = "个位只件次种条张本天年月号岁点分块元个双对把辆台部间家口句遍回趟场"
NUM_MEASURE_RE = re.compile(f"^[{NUMERALS}]+[{MEASURES}]$")
_HAN = f"{chr(0x4E00)}-{chr(0x9FFF)}"  # CJK Unified Ideographs
_HAN_ALL = f"{chr(0x3400)}-{chr(0x4DBF)}{_HAN}{chr(0xF900)}-{chr(0xFAFF)}{chr(0x20000)}-{chr(0x2FFFF)}"
CJK_RE = re.compile(f"^[{_HAN_ALL}]+$")
HAN_RUN_RE = re.compile(f"[{_HAN}]+")


# ---------------------------------------------------------------------------------------------
# Download / cache
# ---------------------------------------------------------------------------------------------

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path) -> None:
    """requests (certifi CA bundle) first; fall back to the system curl, whose OS certificate store
    accepts www.ugent.be's chain when Python's does not (seen on Windows: missing intermediate)."""
    try:
        import requests

        r = requests.get(url, timeout=300, headers={"User-Agent": "qian-data-build/1.0"})
        r.raise_for_status()
        dest.write_bytes(r.content)
    except Exception as e:  # noqa: BLE001
        print(f"  requests failed ({type(e).__name__}); retrying with curl", file=sys.stderr)
        subprocess.run(["curl", "-fsSL", "--max-time", "600", "-o", str(dest), url], check=True)


def fetch(offline: bool) -> dict:
    meta = {}
    for name, src in SOURCES.items():
        p: Path = src["path"]
        if not p.exists():
            if offline:
                sys.exit(f"missing {p} and --offline given")
            p.parent.mkdir(parents=True, exist_ok=True)
            print(f"downloading {name} <- {src['url']}", file=sys.stderr)
            tmp = p.with_suffix(p.suffix + ".part")
            download(src["url"], tmp)
            tmp.replace(p)
        meta[name] = {
            "url": src["url"],
            "file": p.relative_to(ROOT).as_posix(),
            "sha256": sha256(p),
            "retrieved": datetime.date.fromtimestamp(p.stat().st_mtime).isoformat(),
        }
    return meta


# ---------------------------------------------------------------------------------------------
# Pinyin helpers
# ---------------------------------------------------------------------------------------------

TONE_MARKS = {
    "a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ",
}
MARK_TO_BASE = {m: (b, i + 1) for b, ms in TONE_MARKS.items() for i, m in enumerate(ms)}
MARK_TO_BASE["ề"] = ("ê", 4)


def numbered_syllable_to_marked(syl: str) -> str:
    m = re.fullmatch(r"([A-Za-zü:]+?)([1-5])", syl)
    if not m:
        return syl
    base, tone = m.group(1).replace("u:", "ü").replace("U:", "Ü").replace("v", "ü"), int(m.group(2))
    if base.lower() == "r" and tone == 5:
        return "r"
    if tone == 5:
        return base
    low = base.lower()
    if "a" in low:
        idx = low.index("a")
    elif "e" in low:
        idx = low.index("e")
    elif "ou" in low:
        idx = low.index("o")
    else:
        idx = max(i for i, c in enumerate(low) if c in "aeiouü") if any(c in "aeiouü" for c in low) else -1
        if idx == -1:  # syllabic m/n/ng (e.g. "m2", "ng4"): leave numbered
            return syl
    ch = low[idx]
    marked = TONE_MARKS[ch][tone - 1]
    if base[idx].isupper():
        marked = marked.upper()
    return base[:idx] + marked + base[idx + 1:]


def cedict_pinyin_to_marked(p: str) -> str:
    out = []
    for s in p.split():
        mk = numbered_syllable_to_marked(s)
        if mk == "r" and out:  # erhua: attach like MOE ("diǎnr")
            out[-1] += "r"
        else:
            out.append(mk)
    return " ".join(out)


def marked_to_numbered(p: str) -> str:
    """'xiè xie' -> 'xie4 xie5'; ü -> v. Used only for comparing readings."""
    out = []
    for syl in p.lower().split():
        tone = 5
        base = []
        for c in syl:
            if c in MARK_TO_BASE:
                b, tone = MARK_TO_BASE[c]
                base.append(b)
            else:
                base.append(c)
        s = "".join(base).replace("ü", "v").replace("u:", "v")
        out.append(f"{s}{tone}")
    return " ".join(out)


def norm_reading(numbered: str) -> str:
    """Normalize a numbered reading for comparison: lowercase, ü->v, erhua 'r5' merged, no caps."""
    s = numbered.lower().replace("u:", "v").replace("ü", "v")
    s = re.sub(r"\s+r5\b", "r", s)  # CEDICT 'dian3 r5' -> 'dian3r'
    s = re.sub(r"([a-z]+)r([1-5])", r"\1\2r", s)  # MOE 'dianr3' -> 'dian3r'
    return s


# ---------------------------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------------------------

def load_subtlex() -> dict:
    src = SOURCES["subtlex"]
    with zipfile.ZipFile(src["path"]) as z:
        text = z.read(src["member"]).decode("utf-8-sig")
    rows = {}
    lines = text.splitlines()
    header = lines[0].split("\t")
    col = {h: i for i, h in enumerate(header)}
    for line in lines[1:]:
        if not line.strip():
            continue
        f = line.split("\t")
        w = f[col["Word"]].strip()
        if not w:
            continue
        tags = [t for t in f[col["All.PoS"]].split(".") if t]
        freqs = [int(x) for x in f[col["All.PoS.Freq"]].split(".") if x]
        # ~380 strings occur on more than one row (e.g. 你 1,329,424 and again 你 638): sum them.
        r = rows.setdefault(w, {"count": 0, "cdPct": 0.0, "pos": collections.Counter()})
        r["count"] += int(f[col["WCount"]])
        r["cdPct"] = max(r["cdPct"], float(f[col["W-CD%"]]))
        r["pos"].update(dict(zip(tags, freqs)))
    return rows


def load_cedict() -> tuple[dict, dict]:
    by_trad, by_simp = collections.defaultdict(list), collections.defaultdict(list)
    line_re = re.compile(r"^(\S+) (\S+) \[([^\]]*)\] /(.*)/\s*$")
    with gzip.open(SOURCES["cedict"]["path"], "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            m = line_re.match(line)
            if not m:
                continue
            trad, simp, pin, defs = m.groups()
            e = {"trad": trad, "simp": simp, "pinyin": pin, "defs": [d for d in defs.split("/") if d]}
            by_trad[trad].append(e)
            by_simp[simp].append(e)
    return by_trad, by_simp


def load_moe() -> dict:
    with lzma.open(SOURCES["moedict"]["path"], "rt", encoding="utf-8") as f:
        entries = json.load(f)
    # Learn a bopomofo->pinyin syllable map from heteronyms that have both (used when pinyin is missing).
    votes = collections.defaultdict(collections.Counter)
    for e in entries:
        for h in e.get("heteronyms", []):
            b, p = h.get("bopomofo"), h.get("pinyin")
            if b and p:
                bs, ps = b.split(), p.split()
                if len(bs) == len(ps):
                    for x, y in zip(bs, ps):
                        votes[x][y] += 1
    bpmf_map = {k: c.most_common(1)[0][0] for k, c in votes.items()}
    idx = {}
    for e in entries:
        title = e.get("title")
        if not title or "{" in title:
            continue
        hets = []
        for h in e.get("heteronyms", []):
            p = h.get("pinyin")
            src = "moe"
            if not p and h.get("bopomofo"):
                syls = h["bopomofo"].split()
                if syls and all(s in bpmf_map for s in syls):
                    p, src = " ".join(bpmf_map[s] for s in syls), "bopomofo"
            if not p:
                continue
            defs = h.get("definitions", [])
            kind = None
            if defs:
                m = re.match(r"^\(([一二三四五六七八九十]+)\)之(語音|讀音|又音)", defs[0].get("def", ""))
                if m:
                    kind = f"{m.group(2)}({m.group(1)})"  # e.g. 和 hàn = 語音(一): colloquial reading of #1
            types = sorted({d["type"] for d in defs if d.get("type")})
            r = {"pinyin": re.sub(r"\s+", " ", p).strip()}
            if kind:
                r["kind"] = kind
            if types:
                r["types"] = "".join(types)
            if src != "moe":
                r["src"] = src
            hets.append(r)
        if hets:
            idx[title] = hets
    return idx


def load_st_ambiguity() -> dict:
    amb = {}
    for line in SOURCES["opencc_stchars"]["path"].read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        s, ts = line.split("\t")
        ts = ts.split()
        if len(ts) > 1:
            amb[s] = ts
    return amb


# ---------------------------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------------------------

def zipf_from_count(count: float) -> float:
    if count <= 0:
        return ZIPF_FLOOR
    return max(ZIPF_FLOOR, math.log10(count / SUBTLEX_TOTAL_WORDS * 1e9))


def compact_defs(defs: list[str], limit: int = 6) -> list[str]:
    out = []
    for d in defs:
        d = re.sub(r"(\S+?)\|\S+?\[", r"\1[", d)  # 'CL:個|个[ge4]' -> 'CL:個[ge4]'
        out.append(d)
    return out[:limit]


def cedict_for(trad: str, simps: list[str], by_trad, by_simp) -> tuple[list[dict], bool, bool]:
    """Returns (compact entries, all_proper, any_entry)."""
    ents = list(by_trad.get(trad, []))
    if not ents:
        for s in simps:
            ents += by_simp.get(s, [])
    if not ents:
        return [], False, False
    proper = [e for e in ents if e["pinyin"][:1].isupper()]
    common = [e for e in ents if not e["pinyin"][:1].isupper()]
    all_proper = bool(proper) and not common

    def is_variant_only(e):
        return all(re.match(r"^(old |archaic |Japanese )?variant of|^used in |^see ", d) for d in e["defs"])

    keep = common if common else proper
    if any(not is_variant_only(e) for e in keep):
        keep = [e for e in keep if not is_variant_only(e)]
    # merge entries with same pinyin (CEDICT sometimes splits them)
    merged: dict[str, dict] = {}
    for e in keep:
        pin = cedict_pinyin_to_marked(e["pinyin"])
        if not all_proper:
            pin = pin.lower()
        m = merged.setdefault(pin, {"pinyin": pin, "defs": []})
        if e["trad"] != trad:
            m.setdefault("trad", e["trad"])
        for d in e["defs"]:
            if d not in m["defs"]:
                m["defs"].append(d)
    out = []
    for m in list(merged.values())[:6]:
        m["defs"] = compact_defs(m["defs"])
        out.append(m)
    return out, all_proper, True


def moe_for(trad: str, moe: dict) -> tuple[list[dict], str | None]:
    if trad in moe:
        return moe[trad], None
    alt = "".join(MOE_VARIANTS.get(c, c) for c in trad)
    if alt != trad and alt in moe:
        return moe[alt], alt
    return [], None


def build(top_n: int, offline: bool, weight: float, out_path: Path) -> None:
    import jieba
    import jieba.posseg as pseg
    import opencc
    from wordfreq import top_n_list, zipf_frequency
    from wordfreq.chinese import simplify_chinese

    jieba.setLogLevel(60)
    meta = fetch(offline)
    subtlex = load_subtlex()
    by_trad, by_simp = load_cedict()
    moe = load_moe()
    st_amb = load_st_ambiguity()
    s2twp = opencc.OpenCC("s2twp")
    s2tw = opencc.OpenCC("s2tw")  # character/variant-level only (no phrase vocabulary changes)

    # ---- candidate pool (Simplified keys)
    sub_top = sorted(subtlex.items(), key=lambda kv: (-kv[1]["count"], kv[0]))[:POOL_SUBTLEX]
    pool = {w for w, _ in sub_top}
    pool |= set(top_n_list("zh", POOL_WORDFREQ))

    # ---- per simplified word: frequencies, target Traditional form
    groups: dict[str, dict] = {}
    for simp in sorted(pool):
        srow = subtlex.get(simp)
        sub_count = srow["count"] if srow else 0
        wf_zipf = zipf_frequency(simp, "zh")
        wf_freq = 10 ** wf_zipf if wf_zipf > 0 else 0.0

        target_simp, erhua = simp, False
        if (
            len(simp) > 1
            and simp.endswith("儿")
            and simp not in ERHUA_EXEMPT
            and (
                simp in ERHUA_TARGET
                or any(e["pinyin"].lower().endswith("r5") for e in by_simp.get(simp, []))
            )
        ):
            target_simp, erhua = ERHUA_TARGET.get(simp, simp[:-1]), True
        char_level = s2tw.convert(target_simp)
        trad = char_level if target_simp in S2TWP_REJECT else s2twp.convert(target_simp)
        tw_phrase = trad != char_level

        g = groups.setdefault(trad, {
            "trad": trad, "members": [], "subCount": 0, "wfFreq": 0.0, "wfKeys": set(), "cdPct": 0.0,
            "pos": collections.Counter(), "flags": set(),
        })
        # weight (per million) used only to choose the group's primary simplified form
        g["members"].append((simp, sub_count / SUBTLEX_TOTAL_WORDS * 1e6 + wf_freq / 1e3))
        g["subCount"] += sub_count
        # wordfreq simplifies its input before lookup (後 and 后 return the same number): count each key once
        wf_key = simplify_chinese(simp)
        if wf_key not in g["wfKeys"]:
            g["wfKeys"].add(wf_key)
            g["wfFreq"] += wf_freq
        if srow:
            g["cdPct"] = max(g["cdPct"], srow["cdPct"])
            g["pos"].update(srow["pos"])
        if erhua:
            g["flags"].add("erhuaMerged")
        if tw_phrase:
            g["flags"].add("twPhrase")

    # ---- score, rank
    for g in groups.values():
        g["subZipf"] = zipf_from_count(g["subCount"])
        g["wfZipf"] = max(ZIPF_FLOOR, math.log10(g["wfFreq"])) if g["wfFreq"] > 0 else ZIPF_FLOOR
        g["score"] = weight * g["subZipf"] + (1 - weight) * g["wfZipf"]
        g["members"].sort(key=lambda m: (-m[1], m[0]))
        g["simp"] = g["members"][0][0]
    ranked = sorted(groups.values(), key=lambda g: (-g["score"], g["trad"]))

    # ---- enrich + flag the top slice
    out = []
    for g in ranked:
        if len(out) >= top_n:
            break
        trad, simp = g["trad"], g["simp"]
        simps = [m[0] for m in g["members"]]
        flags = set(g["flags"])

        pos_total = sum(g["pos"].values())
        pos_tags = [t for t, _ in sorted(g["pos"].items(), key=lambda kv: (-kv[1], kv[0]))]
        pos_src = "subtlex"
        if not pos_tags:
            toks = list(pseg.cut(simp))
            pos_tags = [toks[0].flag] if len(toks) == 1 else []
            pos_src = "jieba"

        ced, ced_all_proper, has_ced = cedict_for(trad, simps, by_trad, by_simp)
        moe_r, moe_variant = moe_for(trad, moe)

        # non-Chinese tokens
        if not CJK_RE.match(trad):
            flags.add("nonChinese")
        # proper nouns
        proper_share = collections.Counter()
        if pos_total:
            for t, n in g["pos"].items():
                if t in PROPER_TAGS:
                    proper_share[PROPER_TAGS[t]] += n
        elif pos_tags and pos_tags[0] in PROPER_TAGS:
            proper_share[PROPER_TAGS[pos_tags[0]]] = 1
        denom = pos_total or 1
        mostly_proper_pos = bool(proper_share) and sum(proper_share.values()) / denom >= 0.5
        has_common_sense = has_ced and not ced_all_proper
        # A proper-noun PoS majority alone is not enough when CEDICT also has a common-word sense
        # (毛 hair vs. Mao, 黃 yellow vs. Huang): only flag when the word has no common sense.
        if ced_all_proper or (mostly_proper_pos and not has_common_sense):
            kind = proper_share.most_common(1)[0][0] if proper_share else "cedict"
            flags.add("properNoun:" + kind)
        # interjections / onomatopoeia
        if pos_tags and pos_tags[0] in INTERJ_TAGS:
            flags.add("interjection")
        # single characters that are mostly bound morphemes / affixes or transliteration syllables
        if len(trad) == 1 and ced and pos_tags:
            all_defs = [d for c in ced for d in c["defs"]]
            # 斯, 尼: mostly syllables of foreign names in subtitles (but not particles like 啦/耶)
            if pos_tags[0] not in {"y", "e", "o"} and any(
                "phonetic" in d or "transliteration" in d for d in all_defs
            ):
                flags.add("translitChar")
            # 們, 者, 性, 員: SUBTLEX says mostly a morpheme/affix, and CEDICT has no verb sense
            if pos_tags[0] in BOUND_TAGS and not any(d.startswith("to ") for d in all_defs):
                flags.add("boundMorpheme")
        if any(s in VULGAR for s in simps):
            flags.add("vulgar")
        # dictionary coverage / fragments
        if not has_ced and not moe_r:
            flags.add("noDict")
            if len(trad) > 1:
                flags.add("fragment")
        else:
            if not has_ced:
                flags.add("noCedict")
            if not moe_r:
                flags.add("noMoe")
        if NUM_MEASURE_RE.match(simp) and not has_ced:  # 两个, 三天...; lexicalized 一下/十分 are in CEDICT
            flags.add("numMeasure")
        # register / corpus skew
        if any(s in TRANSLATIONESE for s in simps):
            flags.add("translationese")
        if g["subZipf"] - g["wfZipf"] >= SKEW_THRESHOLD:
            flags.add("subtitleSkew")
        if g["wfZipf"] - g["subZipf"] >= SKEW_THRESHOLD:
            flags.add("writtenSkew")
        # Taiwan vocabulary
        for s in simps:
            alt = MAINLAND_ONLY.get(s)
            if alt and trad not in HAN_RUN_RE.findall(alt.split("(")[0]):
                flags.add(f"mainlandOnly:{alt}")
        # Simplified->Traditional ambiguity (single characters; phrases are handled by OpenCC)
        if len(simp) == 1 and simp in st_amb:
            flags.add("ambiguousS2T:" + "/".join(st_amb[simp]))
        if moe_variant:
            flags.add(f"moeTitle:{moe_variant}")
        # reading disagreement between MOE (Taiwan) and CEDICT (mainland-based)
        if ced and moe_r:
            ced_set = {norm_reading(marked_to_numbered(c["pinyin"])) for c in ced}
            moe_set = {norm_reading(marked_to_numbered(m["pinyin"])) for m in moe_r}
            if not (ced_set & moe_set):
                flags.add("moeDiffers")

        rec = {
            "blendRank": len(out) + 1,
            "trad": trad,
            "simp": simp,
        }
        if len(simps) > 1:
            rec["mergedSimp"] = [s for s in simps if s != simp]
        rec.update({
            "score": round(g["score"], 3),
            "subtlexFreq": round(g["subCount"] / SUBTLEX_TOTAL_WORDS * 1e6, 2),
            "subtlexCD": round(g["cdPct"], 2),
            "wordfreqZipf": round(g["wfZipf"], 2),
            "posTags": pos_tags[:4],
        })
        if pos_src != "subtlex":
            rec["posSrc"] = pos_src
        rec["cedict"] = ced
        rec["moe"] = moe_r
        rec["flags"] = sorted(flags)
        out.append(rec)

    # ---- write
    DATA.mkdir(exist_ok=True)
    body = "[\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in out) + "\n]\n"
    out_path.write_text(body, encoding="utf-8", newline="\n")
    fc = collections.Counter(f.split(":")[0] for r in out for f in r["flags"])
    print(f"wrote {len(out)} candidates to {out_path} (groups considered: {len(groups)})", file=sys.stderr)
    print("flag counts: " + ", ".join(f"{k}={v}" for k, v in sorted(fc.items())), file=sys.stderr)
    if out_path != (DATA / "candidates.json").resolve():
        return  # experimental run: leave data/sources.json alone

    import importlib.metadata as md
    sources = {
        "generatedBy": "scripts/data/build_candidates.py",
        "params": {
            "top": top_n, "poolSubtlex": POOL_SUBTLEX, "poolWordfreq": POOL_WORDFREQ,
            "blendWeightSubtlex": weight, "zipfFloor": ZIPF_FLOOR, "skewThreshold": SKEW_THRESHOLD,
        },
        "packages": {p: md.version(p) for p in ["opencc", "wordfreq", "jieba"]},
        "sources": meta,
    }
    (DATA / "sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--top", type=int, default=1400, help="number of candidates to write (default 1400)")
    ap.add_argument("--offline", action="store_true", help="fail instead of downloading missing sources")
    ap.add_argument("--weight", type=float, default=BLEND_WEIGHT_SUBTLEX,
                    help=f"weight of SUBTLEX-CH in the blended Zipf score (default {BLEND_WEIGHT_SUBTLEX})")
    ap.add_argument("--out", type=Path, default=DATA / "candidates.json",
                    help="output path (default data/candidates.json; other paths skip data/sources.json)")
    args = ap.parse_args()
    build(args.top, args.offline, args.weight, args.out.resolve())


if __name__ == "__main__":
    main()
