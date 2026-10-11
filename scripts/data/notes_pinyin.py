"""Give every run of Chinese characters in a word note its tone-marked pinyin ("我有去 wǒ yǒu qù").

Run:  ./.venv/Scripts/python scripts/data/notes_pinyin.py [--write] [--all]

  (default)  print every run that lacks pinyin, with the reading that would be inserted and where it came from
  --write    apply REWRITES and the insertions to data/enriched/chunk-*.json
  --all      also print runs that already have pinyin (for auditing)

The learner cannot read characters, so a note like "say 我很累, not 我是累" is useless without pinyin. A run
"has pinyin" when it is followed by a space and one syllable per character, each a known reading of its character
(the same test as build_words.py's note rule, `note_pinyin_errors`).

Draft readings, in order of trust (data/NOTES.md, "Notes pinyin"):
  1. CONTEXT[(rank, run)]  hand-reviewed reading for this run in this note (polyphones, Taiwan readings, 一/不).
  2. a segmentation of the run into deck headwords (src/data/words.json readings, MOE-checked) and MOE
     multi-character entries (data/cache/moe.pkl), fewest pieces first;
  3. single characters: deck headword, else MOE's first reading, else pypinyin.
Every proposal was reviewed by hand; the ones the draft got wrong are in CONTEXT. Readings are citation tones
(yī, bù; no sandhi), neutral tones as in MOE, syllables separated by spaces.

REWRITES holds hand edits that replace a character label which adds nothing for a non-reader with pinyin +
English, or that reshape a note so the pinyin reads naturally. They are applied before the insertions, and the
script is idempotent: once a note is done, it is left alone.
"""
from __future__ import annotations

import argparse
import glob
import json
import pickle
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_words as bw  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CHUNKS = ROOT / "data" / "enriched"
MOE_PKL = ROOT / "data" / "cache" / "moe.pkl"
WORDS = ROOT / "src" / "data" / "words.json"

# Hand edits, applied verbatim before insertion: rank -> [(old, new), ...]. `old` must not occur more than once;
# when it no longer occurs the edit has been applied and is skipped. Three kinds:
#  * "X is <reading> here" sentences, which would read "X x is x here" once X gets its pinyin: reworded to talk
#    about the syllable ("The first syllable is hái, not huán");
#  * labels that add nothing for a non-reader (erhua spellings, simplified forms, "ya (呀)"): dropped or replaced
#    with pinyin + English;
#  * pinyin that was already there but not right after the run (跟…生氣 gēn … shēng qì, "(yī jiā diàn, a shop)").
REWRITES: dict[int, list[tuple[str, str]]] = {
    14: [("Other readings: hè (附和), huó (和麵), huò, hú (winning in mahjong).",
          "Other readings: hè in 附和 fù hè 'to echo', huò in 和麵 huò miàn 'to knead dough' (MOE; the mainland "
          "says huó), and hú (winning in mahjong).")],
    51: [("it sounds like ya (呀), after -u/-ao/-ou like wa (哇), so", "it sounds like ya, after -u/-ao/-ou like wa, so"),
         ("and after -n like na (哪);", "and after -n like na;")],
    52: [("Sounds the same as 的 and 地.", "Sounds the same as the de in 我的 wǒ de 'my' and 慢慢地 màn màn de 'slowly'."),
         # Second review: a bare 地 with a toneless de after it was read as 地 dì by the app's note annotator.
         ("Sounds the same as 的 de and 地 de.", "Sounds the same as the de in 我的 wǒ de 'my' and 慢慢地 màn màn de 'slowly'.")],
    60: [("the mainland erhua 事兒.", "the mainland erhua form shìr.")],
    76: [("not mainland erhua 一點兒.", "not mainland erhua yī diǎnr.")],
    77: [("the mainland erhua 這兒 zhèr.", "the mainland erhua zhèr.")],
    97: [("Here 為 is wèi 'for'; in 因為 it is also wèi, but in 成為 'to become' and 以為 'to think (wrongly)' it is wéi.",
          "Here the first syllable is wèi 'for'; 因為 yīn wèi has the same wèi, but 成為 chéng wéi 'to become' and "
          "以為 yǐ wéi 'to think (wrongly)' have wéi.")],
    118: [("還 is hái here; it is huán in 還錢 'pay back money'.",
           "The first syllable is hái; the same character is huán in 還錢 huán qián 'pay back money'.")],
    127: [("為 is wéi here (as in 以為 'mistakenly think') but wèi in 為什麼 'why'.",
           "The second syllable is wéi (as in 以為 yǐ wéi 'mistakenly think'), not the wèi of 為什麼 wèi shén me 'why'.")],
    128: [("(一、二、三; 十二)", "(yī, èr, sān; shí èr 'twelve')")],
    151: [("In Taiwan, 口吃 'to stutter' is read kǒu jí.", "In Taiwan, 口吃 kǒu jí 'to stutter' has jí, not chī.")],
    157: [("一家店 (yī jiā diàn, a shop)", "一家店 yī jiā diàn 'a shop'")],
    171: [("where the mainland often says 哪兒.", "where the mainland often says nǎr.")],
    175: [("為 here is wèi (for), not wéi (to be).", "The first syllable is wèi 'for', not wéi 'to be'.")],
    193: [("as in 銀行 (yín háng, bank).", "as in 銀行 yín háng 'bank'.")],
    198: [("相 here is xiāng (mutual), not xiàng (photo, appearance).",
           "The first syllable is xiāng 'mutual'; the same character read xiàng means 'photo, appearance'.")],
    199: [("where the mainland says 一點兒.", "where the mainland says yī diǎnr.")],
    202: [("where the mainland often says 那兒,", "where the mainland often says nàr,")],
    207: [("為 here is wéi, not wèi.", "The second syllable is wéi, not wèi.")],
    212: [("長得很漂亮 zhǎng de 'looks pretty'", "長得很漂亮 zhǎng de hěn piào liang 'looks pretty'")],
    213: [("mainland China writes 計劃 (计划).", "mainland China writes 計劃."),
          # Second review: once both spellings had pinyin the note read "jì huà ... jì huà ... the same".
          ("Taiwan's standard spelling is 計畫 jì huà; mainland China writes 計劃 jì huà. The pronunciation is the same.",
           "A plan, and also the verb 'to plan': 我有一個計畫 wǒ yǒu yī ge jì huà 'I have a plan', 我們計畫明年去日本 "
           "wǒ men jì huà míng nián qù rì běn 'we plan to go to Japan next year'. (Taiwan and the mainland write it "
           "differently, but it sounds the same.)")],
    223: [("重 is zhòng here ('heavy, important'); it is chóng in 重新 chóng xīn 'again'.",
           "The first syllable is zhòng ('heavy, important'); the same character is chóng in 重新 chóng xīn 'again'.")],
    235: [("還 is hái here, not huán.", "The first syllable is hái, not huán.")],
    251: [("Taiwan says 玩, not mainland 玩兒; instruments use 彈 and ball sports 打.",
           "Taiwan says 玩 wán, not mainland wánr; instruments use 彈 tán and ball sports 打 dǎ.")],
    273: [("算了，不用了 suàn le, bù yòng le", "算了 suàn le, 不用了 bù yòng le")],
    312: [("跟…生氣 gēn … shēng qì", "跟 gēn … 生氣 shēng qì")],
    320: [("MOE reads guò lai (neutral 來), like", "MOE reads guò lai (neutral lai), like")],
    323: [("為 is wéi here, not wèi 'for'.", "The second syllable is wéi, not wèi 'for'.")],
    341: [("興 is xìng here; its other reading xīng is in 興奮 xīng fèn 'excited'.",
           "The second syllable is xìng; the same character is xīng in 興奮 xīng fèn 'excited'.")],
    345: [("要 is read yāo here, not yào.", "The first syllable is yāo here, not the yào of 'to want'.")],
    355: [("得 is neutral de here (other readings dé, děi).",
           "The second syllable is a neutral de (the same character is also dé and děi).")],
    359: [("個 is light (ge), sometimes full gè.", "The second syllable is light (ge), sometimes full gè.")],
    366: [("MOE gives a neutral-tone 見 (kàn jian);", "MOE gives a neutral second syllable (kàn jian);")],
    389: [("MOE gives a neutral-tone 事 (gù shi) for 'story';", "MOE gives a neutral second syllable (gù shi) for 'story';")],
    408: [("Taiwan reads 息 as xí (mainland xiāo xi).", "Taiwan reads the second syllable as xí (mainland xiāo xi).")],
    409: [("兒 here is a full syllable ér, not erhua.", "The second syllable is a full ér, not an erhua -r.")],
    417: [("調 here is diào; its other reading tiáo", "The first syllable is diào; the same character read tiáo")],
    418: [("行 here is xíng; it is háng in 銀行 yín háng (bank).",
           "The first syllable is xíng; the same character is háng in 銀行 yín háng (bank).")],
    420: [("MOE gives a neutral-tone 個 (zhěng ge);", "MOE gives a neutral second syllable (zhěng ge);")],
    435: [("MOE gives a neutral-tone 亮 (piào liang);", "MOE gives a neutral second syllable (piào liang);")],
    509: [("Taiwan (MOE) reads 擁 as yǒng;", "Taiwan (MOE) reads the first syllable as yǒng;")],
    576: [("你在忙什麼？ (nǐ zài máng shén me?)", "你在忙什麼 nǐ zài máng shén me?")],
    580: [("MOE (Taiwan standard) reads 場 here as cháng;", "MOE (Taiwan standard) reads the second syllable as cháng;")],
    596: [("Both characters are polyphones: 行 is xíng here (háng in 銀行), and 為 is wéi here (wèi means 'for').",
           "Both characters have other readings: the first is háng in 銀行 yín háng 'bank', and the second is wèi "
           "'for' in 為什麼 wèi shén me 'why'."),
          # Second review: the first version read "xíng is háng", as if two sounds were the same.
          ("Both syllables are polyphones: xíng is háng in 銀行 yín háng 'bank', and wéi is wèi 'for' in 為什麼 "
           "wèi shén me 'why'.",
           "Both characters have other readings: the first is háng in 銀行 yín háng 'bank', and the second is wèi "
           "'for' in 為什麼 wèi shén me 'why'.")],
    601: [("In Taiwan 提防 'to be on guard against' is also tí fáng", "In Taiwan 提防 tí fáng 'to be on guard against' also has tí")],
    603: [("is 跟某人結婚 (gēn … jié hūn);", "is 跟 gēn + person + 結婚 jié hūn;")],
    609: [("重 is chóng here ('again'), not zhòng 'heavy'.", "The first syllable is chóng ('again'), not zhòng 'heavy'.")],
    327: [("X以後 = 'after X'", "X 以後 yǐ hòu = 'after X'")],
    630: [("越A越B", "越 yuè A 越 yuè B")],
    655: [("便 is biàn here, not pián as in 便宜.", "The first syllable is biàn, not the pián of 便宜 pián yi 'cheap'.")],
    684: [("行 is read háng here (a business or trade). As 'to walk / OK' it is xíng.",
           "The second syllable is háng (a business or trade); as 'to walk / OK' the same character is xíng.")],
    709: [("跟…借 gēn … jiè", "跟 gēn … 借 jiè")],
    750: [("乾 here is gān 'dry', not qián.", "The first syllable is gān 'dry', not qián.")],
    763: [("MOE reads 幾 as jī here;", "MOE reads the first syllable as jī;")],
    767: [("Taiwan (MOE) reads 識 as shì here;", "Taiwan (MOE) reads the second syllable as shì;")],
    772: [("興 is xìng here (mood, interest).", "The first syllable is xìng (mood, interest).")],
    782: [("的 is dí here, not the particle de;", "The first syllable is dí, not the particle de;")],
    835: [("the mainland says yí huìr (一會兒).", "the mainland says yí huìr.")],
    837: [("+ 到 'arrive', read lái dào.", "+ 到 'arrive'.")],
    859: [("跟…道歉 gēn … dào qiàn", "跟 gēn … 道歉 dào qiàn")],
    861: [("nà bian or 那兒.", "nà bian or nàr.")],
    905: [("the pattern 不是 A，而是 B (bù shì A, ér shì B)", "the pattern 不是 bù shì A, 而是 ér shì B")],
    911: [("MOE reads 場 as cháng here;", "MOE reads the second syllable as cháng;")],
    935: [("(西藏 Xī zàng)", "(西藏 xī zàng)")],
    962: [("的 is read dì here (as in 目的地 'destination'), not the particle de.",
           "The second syllable is dì (as in 目的地 mù dì dì 'destination'), not the particle de.")],
    978: [("處 is chù 'place' here; in 處理 'to handle' it is chǔ.",
           "The second syllable is chù 'place'; in 處理 chǔ lǐ 'to handle' it is chǔ.")],
    # Second review (after insertion; `old` is the text with pinyin): sentences the first pass missed, where a
    # citation reading now sits next to a claim about a different or light reading ("jué is jiào here", "the 不
    # bù lightly"), and notes that were only about spelling.
    36: [("The 'which' question word is written 哪 nǎ.", "The 'which' question word is the third-tone 哪 nǎ.")],
    98: [("覺 jué is read jiào in 睡覺 shuì jiào 'to sleep'.",
          "The character for jué is read jiào in 睡覺 shuì jiào 'to sleep'.")],
    134: [("MOE gives a light last syllable here, though 關係 guān xì alone is guān xì;",
           "MOE gives a light last syllable here (méi guān xi), though 關係 guān xì on its own has a full fourth tone;")],
    170: [("還 hái here is hái, not huán;", "The first syllable is hái, not huán;")],
    179: [("After another verb it shows coming out or becoming clear, usually with a light tone:",
           "After another verb it shows coming out or becoming clear (MOE keeps the full chū lái; in fast speech it "
           "is often said lightly):")],
    353: [("The official spelling is 臺灣 tái wān; 台灣 tái wān is the everyday form.",
           "Official documents write it another way, but it sounds the same.")],
    357: [("Often 談一談 tán yī tán / 談談 tán tán 'have a talk';",
           "Often 談一談 tán yī tán or 談談 tán tán 'have a talk' (in tán yī tán the middle yī is said lightly);")],
    378: [("髮 fǎ (hair, as in 頭髮 tóu fǎ) is a different character.",
           "Don't confuse it with fǎ 'hair' (頭髮 tóu fǎ), a different word with a third tone.")],
    529: [("曾 céng is read zēng in 曾祖父 zēng zǔ fù 'great-grandfather'.",
           "The character for céng is read zēng in 曾祖父 zēng zǔ fù 'great-grandfather'.")],
    578: [("好好想一想 hǎo hǎo xiǎng yī xiǎng 'think it over carefully'.",
           "好好想一想 hǎo hǎo xiǎng yī xiǎng 'think it over carefully' (the middle yī is said lightly).")],
    678: [("The MOE standard form is written 祕密 mì mì, but 秘密 mì mì is very common in Taiwan. The pronunciation is "
           "the same.",
           "保守秘密 bǎo shǒu mì mì 'keep a secret'. Also an adjective: 秘密任務 mì mì rèn wù 'a secret mission'. "
           "(The dictionary spells it a little differently; the sound is the same.)")],
    739: [("MOE lists liú xia with a light 下 xià, but the full tone is common",
           "MOE lists liú xia with a light second syllable, but the full tone (liú xià) is common")],
    800: [("Taiwan writes 想像 xiǎng xiàng; the mainland usually writes 想象 xiǎng xiàng. Same pronunciation.",
           "想像力 xiǎng xiàng lì is 'imagination'; 你想像一下 nǐ xiǎng xiàng yī xià 'just imagine'. (Taiwan and "
           "the mainland write it differently, but it sounds the same.)")],
    876: [("MOE reads the 不 bù lightly (chà bu duō);", "MOE reads the middle syllable lightly (chà bu duō);")],
    891: [("Taiwan writes 身分 shēn fèn (MOE); the mainland writes 身份 shēn fèn. 身分證 shēn fèn zhèng is the "
           "national ID card.",
           "身分證 shēn fèn zhèng is the national ID card; 表明身分 biǎo míng shēn fèn 'say who you are'. (Taiwan "
           "and the mainland write it differently, but it sounds the same.)")],
    910: [("個 gè is light here, like 這個 zhè ge.", "The second syllable is light (ge), like 這個 zhè ge.")],
    934: [("覺 jué is jiào here ('a sleep'); in 覺得 jué de it is jué.",
           "The second syllable is jiào ('a sleep'); the same character is jué in 覺得 jué de 'to feel'.")],
}

# Hand-reviewed readings where the draft is wrong in context: (rank, run) -> pinyin.
CONTEXT: dict[tuple[int, str], str] = {
    (3, "嗯"): "en",                       # MOE ˙ㄣ
    (31, "它們"): "tā men",                 # MOE's 它 entry lists tuō first
    (49, "過年"): "guò nián",               # MOE lists guò nian and guò nián; the full tone is usual
    (58, "去年"): "qù nián",                # like 今年 jīn nián, 明年 míng nián (DECISIONS: neutral-tone rule)
    (66, "不是"): "bù shì",                 # citation tones, as the deck's 不是 elsewhere
    (83, "你可要小心喔"): "nǐ kě yào xiǎo xīn o",  # sentence-final 喔 is a light o
    (122, "看起來"): "kàn qǐ lái",          # MOE lists kān first (literary)
    (132, "小心喔"): "xiǎo xīn o",
    (132, "好喔"): "hǎo o",
    (136, "慢慢地"): "màn màn de",          # adverbial 地 de
    (149, "一打"): "yī dá",                 # 'a dozen'
    (181, "買不起"): "mǎi bu qǐ",           # potential complement: neutral bu
    (189, "卻睡不著"): "què shuì bu zháo",   # as the 卻 example (shuìbuzháo)
    (237, "找不到"): "zhǎo bu dào",
    (238, "老朋友"): "lǎo péng yǒu",        # the deck's 朋友 péng yǒu
    (242, "走過去"): "zǒu guò qu",          # the note says the second syllable is light here
    (291, "每天都"): "měi tiān dōu",         # not MOE 天都 tiān dū (the capital)
    (443, "走不動"): "zǒu bu dòng",
    (443, "拿不動"): "ná bu dòng",
    (468, "兄弟姊妹"): "xiōng dì jiě mèi",   # Taiwan speech; MOE 姊妹 lists the reading-pronunciation zǐ mèi
    (468, "兄弟姐妹"): "xiōng dì jiě mèi",
    (546, "看不懂"): "kàn bu dǒng",
    (574, "聽得到"): "tīng de dào",          # not 得到 dé dào
    (574, "聽不到"): "tīng bu dào",
    (594, "姊姊"): "jiě jie",               # 'with the same pronunciation' as 姐姐
    (654, "每天都"): "měi tiān dōu",
    (753, "你好討厭喔"): "nǐ hǎo tǎo yàn o",
    (757, "我怕來不及"): "wǒ pà lái bu jí",
}

def load_deck() -> dict[str, str]:
    words = json.loads(WORDS.read_text(encoding="utf-8"))
    for w in words:
        bw.register_headword_readings(w["trad"], [bw.parse_syllable(s)[0] for s in w["pinyin"].split(" ")])
        syls, err = bw.example_syllables(w["example"]["pinyin"])
        han = bw.HAN.findall(w["example"]["trad"])
        if not err and len(syls) == len(han):
            bw.register_headword_readings("".join(han), [bw.parse_syllable(s)[0] for s in syls])
    return {w["trad"]: w["pinyin"] for w in sorted(words, key=lambda w: w["rank"])}


_MOE = None


def moe() -> dict:
    global _MOE
    if _MOE is None:
        _MOE = pickle.loads(MOE_PKL.read_bytes())
    return _MOE


def clean(p: str, n: int) -> str | None:
    """MOE pinyin -> space-separated tone-marked syllables, or None if it does not give n valid syllables."""
    p = unicodedata.normalize("NFC", p)
    p = re.sub(r"[（(].*?[)）]", " ", p)
    syls = [s for s in re.split(r"[\s\-]+", p.strip()) if s]
    if len(syls) != n:
        return None
    for s in syls:
        base, tone, marks = bw.parse_syllable(s)
        if base not in bw.SYLLABLES or marks > 1:
            return None
    return " ".join(s.lower() for s in syls)


def moe_readings(word: str) -> list[str]:
    out = []
    for p, _ in moe().get(word, []) or moe().get(word.replace("台", "臺"), []):
        c = clean(p, len(word))
        if c and c not in out:
            out.append(c)
    return out


def pypinyin_reading(run: str) -> str:
    from pypinyin import Style, pinyin

    return " ".join(x[0] for x in pinyin(run, style=Style.TONE, neutral_tone_with_five=False))


def draft(run: str, deck: dict[str, str]) -> tuple[str, list[str]]:
    """Best-guess reading of a run and a description of the pieces ("deck:我的", "moe:好吃", "char:菜")."""
    n = len(run)
    best: list[tuple[int, int, list] | None] = [None] * (n + 1)
    best[0] = (0, 0, [])
    for i in range(n):
        if best[i] is None:
            continue
        pieces, singles, path = best[i]
        for j in range(i + 1, n + 1):
            w = run[i:j]
            cand = None
            if w in deck:
                cand = (deck[w], f"deck:{w}")
            elif len(w) > 1 and moe_readings(w):
                rs = moe_readings(w)
                cand = (rs[0], f"moe:{w}" + ("" if len(rs) == 1 else f"(of {'/'.join(rs)})"))
            elif len(w) == 1:
                rs = moe_readings(w)
                dflt = pypinyin_reading(w)
                if rs:
                    pick = dflt if dflt in rs else rs[0]
                    cand = (pick, f"char:{w}" + ("" if len(rs) == 1 else f"(of {'/'.join(rs)})"))
                else:
                    cand = (dflt, f"pyp:{w}")
            if cand is None:
                continue
            score = (pieces + 1, singles + (len(w) == 1))
            if best[j] is None or score < best[j][:2]:
                best[j] = (score[0], score[1], path + [cand])
    path = best[n][2]
    syls = " ".join(p for p, _ in path).split(" ")
    # The measure word 個 after a numeral or demonstrative is neutral, as in the examples (yī ge, zhè ge).
    for i, ch in enumerate(run):
        if ch == "個" and i > 0 and syls[i] == "gè":
            syls[i] = "ge"
    return " ".join(syls), [d for _, d in path]


def known_readings(ch: str) -> set[str]:
    """Toneless readings (ü as v) of a character: pypinyin heteronyms plus MOE."""
    from pypinyin import Style, pinyin

    s = set()
    for v in {ch, bw.to_simp(ch)}:
        for r in pinyin(v, style=Style.NORMAL, heteronym=True)[0]:
            s.add(r.replace("ü", "v"))
    for p in moe_readings(ch):
        s.add(bw.parse_syllable(p)[0])
    return s


PAREN_PINYIN = re.compile(r"(" + bw.NOTE_HAN_RUN.pattern + r") \(([^()]+)\)")
# Full-width punctuation in notes -> ASCII (once every run carries pinyin, '，' between two pinyin strings reads
# oddly). '…' and '→' stay.
FULL_WIDTH = {"，": ", ", "、": ", ", "？": "? ", "！": "! ", "。": ". ", "；": "; ", "：": ": "}
FW_CLASS = "".join(FULL_WIDTH) + "…"


def unparen(note: str) -> str:
    """'我們 (wǒ men) 'we'' -> '我們 wǒ men 'we'': pinyin in parentheses right after a run loses the parentheses,
    so every run is followed by its pinyin the same way."""
    def fix(m: re.Match) -> str:
        cand = f"{m.group(1)} {m.group(2)}"
        inner = bw.NOTE_HAN_RUN.match(cand)
        if bw.pinyin_after(cand, inner) == m.group(2):
            return cand
        return m.group(0)

    return PAREN_PINYIN.sub(fix, note)


def punct_after_run(note: str) -> str:
    """'吃飽了沒？ chī bǎo le méi 'have…'' -> '吃飽了沒 chī bǎo le méi? 'have…'': punctuation between a run and its
    pinyin moves after the pinyin (and is dropped if the pinyin already ends with it: '你是指… nǐ shì zhǐ…')."""
    out, pos = [], 0
    for m in bw.NOTE_HAN_RUN.finditer(note):
        if m.start() < pos:
            continue
        pm = re.match(rf"([{FW_CLASS}]) ", note[m.end():])
        if not pm:
            continue
        cand = note[:m.end()] + note[m.end() + pm.end() - 1:]  # drop the punctuation, keep the space
        inner = bw.NOTE_HAN_RUN.match(cand, m.start())
        py = bw.pinyin_after(cand, inner)
        if py is None:
            continue
        p = pm.group(1)
        ascii_p = FULL_WIDTH.get(p, p).strip()
        tail_start = m.end() + pm.end() + len(py)
        tail = note[tail_start:]
        moved = "" if tail.startswith((p, ascii_p)) else ascii_p
        out.append(note[pos:m.end()] + " " + py + moved)
        pos = tail_start
    out.append(note[pos:])
    return "".join(out)


def ascii_punct(note: str) -> str:
    for fw, a in FULL_WIDTH.items():
        note = note.replace(fw, a)
    note = re.sub(r" {2,}", " ", note)
    note = re.sub(r"([?!,.]) \)", r"\1)", note)  # '(… ma?)', not '(… ma? )'
    return note.strip()


def runs_lacking(note: str) -> list[re.Match]:
    return [m for m in bw.NOTE_HAN_RUN.finditer(note) if bw.pinyin_after(note, m) is None]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--diff", action="store_true", help="print every changed note before/after")
    args = ap.parse_args()
    deck = load_deck()
    changed = inserted = 0
    problems = 0
    for f in sorted(glob.glob(str(CHUNKS / "chunk-*.json"))):
        path = Path(f)
        data = json.loads(path.read_text(encoding="utf-8"))
        dirty = False
        for w in data:
            note = w.get("note")
            if not note:
                continue
            rank = w["rank"]
            new = note
            for old, rep in REWRITES.get(rank, []):
                if new.count(old) == 1:
                    new = new.replace(old, rep)
                elif new.count(old) > 1:
                    print(f"!! rank {rank}: rewrite source occurs more than once: {old!r}")
                    problems += 1
                # not found: already applied (the replacement may since have gained pinyin)
            new = punct_after_run(unparen(new))
            out, last = [], 0
            for m in bw.NOTE_HAN_RUN.finditer(new):
                run = m.group(0)
                have = bw.pinyin_after(new, m)
                if have is not None:
                    if args.all:
                        print(f"   {rank:>4} {w['trad']}  {run} = {have}  [present]")
                    continue
                if (rank, run) in CONTEXT:
                    py, src = CONTEXT[(rank, run)], "HAND"
                else:
                    py, pieces = draft(run, deck)
                    src = " ".join(pieces)
                pyp = pypinyin_reading(run)
                flag = "" if src == "HAND" or py == pyp else f"  (pypinyin: {pyp})"
                nxt = re.match(r" ([^\W\d_]+)", new[m.end():])
                if nxt and bw.parse_syllable(nxt.group(1))[0] in known_readings(run[0]):
                    flag += "  PARTIAL-PINYIN-FOLLOWS"
                    problems += 1
                if not args.diff:
                    ctx = new[max(0, m.start() - 30):m.end() + 30]
                    print(f"{rank:>4} {w['trad']}  {run} -> {py}   [{src}]{flag}\n        ...{ctx}...")
                sep = " " if re.match(r"[^\W_]", new[m.end():m.end() + 1]) else ""
                out.append(new[last:m.end()] + " " + py + sep)
                last = m.end()
                inserted += 1
            out.append(new[last:])
            new = ascii_punct("".join(out))
            if new != note:
                changed += 1
                if args.diff:
                    print(f"{rank:>4} {w['trad']}\n  - {note}\n  + {new}")
                if args.write:
                    w["note"] = new
                    dirty = True
            for m in runs_lacking(new):
                print(f"!! rank {rank}: {m.group(0)} still lacks pinyin: {new}")
                problems += 1
        if dirty:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    verb = "changed" if args.write else "would change"
    print(f"{changed} notes {verb}; {inserted} pinyin insertions; {problems} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
