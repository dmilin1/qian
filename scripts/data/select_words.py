"""Select the final 1000 words: data/candidates.json -> data/selected.json + data/selection-log.md.

Deterministic. All curation decisions are data in this file (DROP, SUBSTITUTE, RENAME, SWAPS ...),
so the reasoning is reviewable and the output can be regenerated. Usage (from the project root):

    ./.venv/Scripts/python scripts/data/select_words.py
    ./.venv/Scripts/python scripts/data/select_words.py --dump-bottom 150   # inspect the pre-swap tail, write nothing

Steps
  1. Walk the candidates in blended-frequency order. Drop entries listed in DROP (proper nouns,
     segmentation junk, sound-only interjections, translationese, vulgar words, mainland-only words
     whose Taiwan equivalent is already in the list, literary/bound single characters, spelling
     variants and reduplications). Replace mainland-only words with the Taiwan word at the same slot
     (SUBSTITUTE), and apply Taiwan character-form fixes (RENAME). Continue past rank 1000 until
     1000 words are kept (backfill).
  2. Sanity sweep: SWAPS add essential everyday words that rank beyond the cutoff (from an extended
     candidate pool, data/cache/candidates-wide.json, generated with build_candidates.py --top 6000)
     and remove an equal number of much less useful words from the bottom of the list.
  2b. Final-audit swaps (AUDIT_IN / AUDIT_OUT): essential Taiwan household words in, abstract news
     words with weak spoken (SUBTLEX) frequency out. See data/AUDIT.md.
  3. Sort by blended frequency (substitutes keep the slot of the word they replace; split-out
     characters such as 隻 sit right after their source; curated everyday words are placed by the
     PLACE_* tables), assign rank 1..1000 and write the output.
"""

from __future__ import annotations

import collections
import json
import subprocess
import sys
from pathlib import Path

import opencc

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_candidates as bc  # noqa: E402  (dictionary loaders; no side effects on import)

ROOT = HERE.parents[1]
DATA = ROOT / "data"
CANDIDATES = DATA / "candidates.json"
WIDE = DATA / "cache" / "candidates-wide.json"
WIDE_TOP = 6000
OUT = DATA / "selected.json"
LOG = DATA / "selection-log.md"
TARGET = 1000

# ---------------------------------------------------------------------------------------------
# Curation decisions
# ---------------------------------------------------------------------------------------------

CATEGORIES = {
    "proper": "Proper nouns",
    "junk": "Segmentation fragments and compositional chunks",
    "numMeasure": "Number + measure combinations",
    "redup": "Reduplicated forms (base verb already in the list)",
    "interj": "Sound-only interjections and hesitation noises",
    "translationese": "Subtitle translationese",
    "vulgar": "Vulgar words",
    "mainland": "Mainland-only words (Taiwan equivalent already in the list)",
    "variant": "Spelling/sound variants and near-duplicates (one form kept)",
    "literary": "Literary/written-only function words (rare in conversation)",
    "bound": "Bound morphemes / transliteration syllables (not used as standalone spoken words)",
}

# trad -> (category, reason)
DROP: dict[str, tuple[str, str]] = {
    # --- proper nouns (keep only 美國, 中國, 日本, plus 台灣 via the sanity sweep)
    "英國": ("proper", "country name; only a handful of the most conversation-relevant place names are kept"),
    "紐約": ("proper", "city name (frequent only because of US films)"),
    "法國": ("proper", "country name"),
    "德國": ("proper", "country name"),
    "歐洲": ("proper", "place name"),
    "上帝": ("translationese", "'God' as an exclamation in dubbed films; Taiwanese say 天啊 / 我的天"),
    # --- segmentation junk / compositional chunks
    "來說": ("junk", "fragment of 對...來說; not a word on its own"),
    "還要": ("junk", "compositional 還 + 要, both in the list"),
    "很快": ("junk", "compositional 很 + 快, both in the list"),
    "任何人": ("junk", "compositional 任何 + 人, both in the list"),
    "第三": ("junk", "ordinal = 第 + 三; 第 and 第一 are kept"),
    "第二": ("junk", "ordinal = 第 + 二; 第 and 第一 are kept"),
    "某個": ("junk", "compositional 某 + 個"),
    "不知": ("literary", "literary 'not know'; spoken form is 不知道"),
    "麼": ("junk", "fragment of 什麼/這麼/那麼 (or a misspelling of 嗎); all real forms are in the list"),
    "是的": ("translationese", "subtitle rendering of English 'Yes.'; in conversation Taiwanese say 對/對啊/是啊/嗯"),
    "親愛": ("translationese", "fragment of 親愛的 'darling/dear', mostly a subtitle rendering of English 'honey'"),
    # --- number + measure
    "一個": ("numMeasure", "compositional 一 + 個 (both kept); the learner already hears it in every example sentence"),
    "倆": ("mainland", "northern colloquial fusion of 兩個; Taiwan says 兩個 (compositional, so no substitute)"),
    # --- reduplications
    "看看": ("redup", "reduplication of 看 (the V-V 'try/a bit' pattern is better taught in examples)"),
    "想想": ("redup", "reduplication of 想"),
    "談談": ("redup", "reduplication of 談"),
    "試試": ("redup", "reduplication of 試"),
    # --- interjections / noises
    "嗯": ("interj", "back-channel noise 'mm'; no lexical content, already known to a conversational speaker, unreliable as TTS"),
    "呃": ("interj", "hesitation noise 'uh'"),
    "嘿": ("interj", "'hey!' sound, mostly a subtitle rendering of English 'Hey'"),
    "嗨": ("interj", "'hi!' loan sound, mostly subtitle 'Hi'"),
    "哇": ("interj", "'wow' sound"),
    "哈": ("interj", "laughter sound"),
    # --- translationese
    "夫人": ("translationese", "'Madam/Mrs.' address in dubbed films"),
    "長官": ("translationese", "'Sir!' in military/police films"),
    "夥計": ("translationese", "'buddy/pal' in dubbed films"),
    "該死": ("translationese", "'Damn it!' in dubbed films"),
    "國王": ("translationese", "'king' (fantasy/period films)"),
    "博士": ("translationese", "mostly the title 'Dr. X' in dubbed films; low conversational value"),
    "聯邦": ("translationese", "'federal' (FBI etc.) in US films"),
    "州": ("translationese", "US 'state' in films"),
    "王": ("translationese", "'king' in films or the surname Wang"),
    # --- vulgar
    "他媽的": ("vulgar", "curse 'damn it / f***ing' (and translationese)"),
    "操": ("vulgar", "vulgar curse (its 'to grasp/drill' senses are rare)"),
    # --- mainland-only, Taiwan equivalent already in the list
    "咱們": ("mainland", "northern 'we (inclusive)'; Taiwan uses 我們 (in the list)"),
    "啥": ("mainland", "northern 'what'; Taiwan uses 什麼 (in the list)"),
    "同志": ("mainland", "'comrade' (PRC usage); in Taiwan 同志 means 'gay', a different word"),
    "呆": ("mainland", "frequency comes from the mainland spelling 呆 for 待 'to stay'; 待 is in the list"),
    "瞧": ("mainland", "northern 'to look'; Taiwan uses 看 (in the list)"),
    # --- variants / near-duplicates
    "她": ("variant", "pronounced tā exactly like 他; merged into 他 (same sound, a by-ear learner cannot tell them apart)"),
    "它": ("variant", "pronounced tā exactly like 他; merged into 他"),
    "她們": ("variant", "pronounced tā men exactly like 他們; merged into 他們"),
    "它們": ("variant", "pronounced tā men exactly like 他們; merged into 他們"),
    "噢": ("variant", "variant spelling of the 'oh / I see' interjection; merged into 喔"),
    "呀": ("variant", "sound variant of 啊 after a vowel; merged into 啊"),
    "其它": ("variant", "spelling variant of 其他 (in the list)"),
    "媽": ("variant", "short form of 媽媽 (in the list); same meaning"),
    "爸": ("variant", "short form of 爸爸 (in the list); same meaning"),
    # --- literary / written-only function words
    "與": ("literary", "formal 'and'; spoken uses 跟/和"),
    "之": ("literary", "classical possessive particle; occurs in speech only inside compounds (之前, 之後, 之間, 之一 are kept)"),
    "以": ("literary", "written 'by means of'; spoken in compounds (可以, 以為, 以前, 以後 are kept)"),
    "於": ("literary", "written 'at/in'; spoken in compounds (終於, 關於, 對於, 由於 are kept)"),
    "其": ("literary", "written 'its/his'; spoken in compounds (其實, 其他, 其中 are kept)"),
    "此": ("literary", "written 'this'; spoken in compounds (因此, 如此 are kept)"),
    "及": ("literary", "written 'and'"),
    "以及": ("literary", "written 'as well as'; spoken uses 跟/還有"),
    "則": ("literary", "written 'then/however'"),
    "至": ("literary", "written 'to/until'; spoken in compounds (至少 kept)"),
    "即": ("literary", "written 'namely/immediately'"),
    "僅": ("literary", "written 'only'; spoken uses 只"),
    "若": ("literary", "written 'if'; spoken uses 如果/要是"),
    "如": ("literary", "written 'as/if'; spoken in compounds (如果, 如何, 如此 are kept)"),
    "仍": ("literary", "written 'still'; 仍然/還 are kept"),
    "曾": ("literary", "written 'once'; 曾經 is kept"),
    "已": ("literary", "written 'already'; 已經 is kept"),
    "未": ("literary", "written 'not yet'; spoken uses 還沒"),
    "無": ("literary", "written 'not have'; spoken uses 沒有 (無法 is kept)"),
    "非": ("literary", "written 'not'; spoken in compounds (非常 is kept)"),
    "據": ("literary", "written 'according to'; 根據 is kept"),
    "自": ("literary", "written 'from/self'; 自己 is kept"),
    "令": ("literary", "written 'to cause'; spoken uses 讓"),
    "將": ("literary", "written future marker 'will'; spoken uses 會/要"),
    "為何": ("literary", "written 'why'; 為什麼 is kept"),
    "是否": ("literary", "written 'whether'; spoken uses 是不是"),
    "因": ("literary", "written 'because'; 因為 is kept"),
    "知": ("literary", "written 'to know'; 知道 is kept"),
    # --- bound morphemes / transliteration syllables
    "時": ("bound", "spoken 'when' is ...的時候 (時候 kept); 時 alone is written"),
    "所": ("bound", "bound (所以, 所有 kept)"),
    "處": ("bound", "bound (到處 kept)"),
    "法": ("bound", "bound (辦法, 方法 kept)"),
    "作": ("bound", "bound zuò/zuō (工作, 作為 kept)"),
    "周": ("bound", "mostly the surname Zhou or mainland 周 'week' (Taiwan writes 週, says 禮拜/星期)"),
    "定": ("bound", "bound (一定, 決定 kept)"),
    "便": ("bound", "bound/literary (方便, 隨便 kept)"),
    "應": ("bound", "bound (應該 kept)"),
    "達": ("bound", "bound/transliteration (到達, 達到)"),
    "日": ("bound", "written 'day/date'; spoken uses 天/號 (生日 etc. are separate)"),
    "者": ("bound", "suffix '-er'"),
    "員": ("bound", "suffix 'member'"),
    "性": ("bound", "suffix '-ness/-ity'"),
    "特": ("bound", "bound (特別 kept) or transliteration"),
    "子": ("bound", "noun suffix"),
    "兒": ("bound", "suffix / bound 'child' (兒子 kept)"),
    "主": ("bound", "bound 'main/owner'"),
    "案": ("bound", "bound 'case' (案子 is the spoken word)"),
    "爾": ("bound", "transliteration syllable"),
    "身": ("bound", "bound (身體, 身上 kept)"),
    "機": ("bound", "bound 'machine' (手機, 飛機 kept)"),
    "邊": ("bound", "bound 'side' (這邊, 那邊 kept)"),
    "恩": ("bound", "mostly a mainland misspelling of 嗯 in subtitles; 恩 'grace' is literary"),
    "式": ("bound", "suffix '-style'"),
    "型": ("bound", "suffix 'type'"),
    "語": ("bound", "bound 'language' (語言 kept)"),
    "師": ("bound", "bound 'teacher/master' (老師 kept)"),
    "局": ("bound", "bound 'bureau' (警察局 etc.)"),
    "市": ("bound", "bound 'city/market'"),
    "阿": ("bound", "name prefix (阿姨, 阿明) or a misspelling of 啊"),
    "象": ("bound", "mostly a misspelling of 像 in subtitles; 'elephant' is 大象"),
    "克": ("bound", "transliteration syllable / 'gram'"),
    "德": ("bound", "transliteration syllable (德國) / literary 'virtue'"),
    "原": ("bound", "bound (原來, 原因 kept)"),
    "國": ("bound", "bound 'country' (國家 kept)"),
    "單": ("bound", "bound (簡單, 名單 kept)"),
    "共": ("bound", "bound (一共, 共同)"),
    "經": ("bound", "bound (已經, 經過 kept)"),
    "感": ("bound", "bound (感覺 kept)"),
    "相": ("bound", "bound (相信 kept)"),
    "清": ("bound", "bound (清楚 kept)"),
    "項": ("bound", "formal measure word for items"),
    "稱": ("bound", "literary 'to call' (稱為)"),
    "閉": ("bound", "bound (閉嘴)"),
    "入": ("bound", "literary 'to enter'; spoken uses 進 (in the list)"),
    "情": ("bound", "bound 'feeling' (感情, 事情, 愛情)"),
    "城": ("bound", "literary 'city/city wall'; spoken uses 城市 (in the list)"),
    "亞": ("bound", "transliteration syllable (亞洲)"),
    "斯": ("bound", "transliteration syllable"),
    "尼": ("bound", "transliteration syllable"),
}

# Mainland-only word -> (Taiwan word, reason). The Taiwan word takes the same slot.
SUBSTITUTE: dict[str, tuple[str, str]] = {
    "挺": ("蠻", "挺 'quite' is northern/mainland; Taiwan says 蠻 (mán, MOE 副詞 '很、甚'), e.g. 蠻好的"),
    "美元": ("美金", "Taiwan calls the US dollar 美金; 美元 is the written/mainland term"),
    "姑娘": ("女生", "姑娘 'girl' is northern; Taiwan says 女生"),
    "領導": ("主管", "領導 'leader/boss' is PRC usage; in a Taiwan workplace it is 主管 (or 老闆, already in the list)"),
    "酒店": ("飯店", "Taiwan 'hotel' is 飯店; 酒店 suggests a hostess club in Taiwan"),
    "哦": ("喔", "Taiwan writes the 'oh / OK' interjection and friendly sentence-final particle as 喔; merges 哦 and 噢"),
}

# Character-form fixes: OpenCC/corpus form -> Taiwan everyday standard. moeFrom = take MOE readings from this title.
RENAME: dict[str, tuple[str, str | None, str]] = {
    "臺": ("台", "臺", "台 is the everyday Taiwan form (MOE's standard is 臺; MOE readings taken from 臺)"),
    "臺灣": ("台灣", "臺灣", "台灣 is the everyday form (MOE standard 臺灣)"),
    "計劃": ("計畫", None, "計畫 is the Taiwan standard spelling (MOE has both)"),
    "報道": ("報導", None, "報導 is the Taiwan spelling; MOE reads it bào dǎo"),
    "宣佈": ("宣布", None, "宣布 is the MOE form (宣佈 is a variant not in MOE)"),
    "身份": ("身分", None, "身分 is the MOE/Taiwan official form (身分證)"),
}

# Notes attached to kept words (merges or kept-despite-flag decisions).
KEEP_NOTES: dict[str, str] = {
    "他": "Also stands for 她 (she) and 它/牠 (it): all are pronounced tā; written distinction only.",
    "他們": "Also stands for 她們 and 它們: all are pronounced tā men.",
    "啊": "Also covers 呀 (ya), the same particle after a vowel.",
    "媽媽": "Short form 媽 (我媽) merged here.",
    "很多": "Kept although not a dictionary headword: 很多 is the normal spoken way to say 'many/a lot' (多 alone is rarely attributive).",
    "們": "Kept although a bound suffix: the plural marker (我們, 你們, 朋友們) is a core grammar item.",
    "美國": "Place name kept: extremely common in conversation.",
    "中國": "Place name kept: extremely common in conversation.",
    "日本": "Place name kept: extremely common in Taiwanese conversation (travel, food, products).",
    "每個": "Kept as a lexicalized quantifier chunk (每個人, 每個月), like 這個/那個.",
    "這次": "Kept as a demonstrative+measure chunk ('this time').",
    "不會": "Also the standard Taiwan reply to 謝謝 ('no problem').",
}

# Sanity-sweep swaps. IN: (trad, reason). OUT: (trad, reason). Same length.
# Words for IN come from the extended pool (beyond the 1400 candidates where needed).
SWAP_IN: list[tuple[str, str]] = [
    ("沒關係", "core politeness phrase 'it's OK / never mind'"),
    ("吃飯", "core daily verb 'to eat a meal'; also the greeting 吃飯了嗎"),
    ("七", "number 7; all numbers 0-10 plus 百/千/萬 are kept"),
    ("八", "number 8"),
    ("九", "number 9"),
    ("十", "number 10"),
    ("百", "hundred"),
    ("千", "thousand"),
    ("零", "zero (phone numbers, prices, years)"),
    ("台灣", "the learner's language community; ranks low only because both corpora are mainland-heavy"),
    ("便宜", "cheap; core shopping word"),
    ("貴", "expensive; core shopping word"),
    ("好吃", "delicious; one of the most frequent words at a Taiwanese table"),
    ("老公", "husband (the everyday Taiwan word)"),
    ("餓", "hungry"),
    ("累", "tired"),
    ("冷", "cold"),
    ("飯", "cooked rice / meal"),
    ("菜", "dish / vegetables"),
    ("你好", "hello"),
    ("晚安", "good night"),
    ("不好意思", "'excuse me / sorry' - the most common Taiwan apology/politeness phrase"),
    ("廁所", "toilet"),
    ("姐姐", "older sister (family word)"),
    ("弟弟", "younger brother (family word)"),
    ("妹妹", "younger sister (family word)"),
    ("耶", "very common Taiwan sentence-final particle (好好吃耶)"),
    ("舒服", "comfortable / feeling well"),
]
# Split-outs: a Traditional character that OpenCC folded into another entry (simplified 只 = 只/隻,
# 面 = 面/麵). These have no frequency of their own; placed directly after the source entry.
SPLIT_IN: list[tuple[str, str, str]] = [
    ("隻", "只", "measure word for animals (一隻狗); simplified 只 merges 只 'only' and 隻, so it had no entry of its own"),
    ("麵", "面", "noodles (Taiwan food talk: 牛肉麵); simplified 面 merges 面 'face/side' and 麵"),
]
# Much less useful words (news / formal / film-genre vocabulary) removed to make room, all from the
# bottom ~130 of the pre-swap list. The script checks each is actually in the pre-swap top 1000 and
# uses exactly as many as there are additions.
SWAP_OUT_ORDER: list[tuple[str, str]] = [
    ("委員會", "news/institutional 'committee'"),
    ("機構", "news/institutional 'organization/institution'"),
    ("部門", "office/institutional 'department'"),
    ("法官", "courtroom-drama 'judge'"),
    ("媒體", "news 'the media'"),
    ("執行", "formal 'to execute/implement'"),
    ("宣布", "formal/news 'to announce'"),
    ("關鍵", "formal 'crux, key point'"),
    ("軍隊", "film-genre 'troops'"),
    ("屍體", "crime-film 'corpse'"),
    ("英雄", "film-genre 'hero'"),
    ("偉大", "formal/film 'great, grand'"),
    ("導致", "written 'to lead to, cause'"),
    ("實現", "formal 'to realize (a goal)'"),
    ("不斷", "written 'unceasingly'"),
    ("作用", "formal 'effect, function'"),
    ("報導", "news 'report'"),
    ("角色", "film/abstract 'role'"),
    ("現實", "abstract 'reality'"),
    ("狀態", "formal 'state, condition' (狀況 is the more spoken word)"),
    ("選手", "sports-news 'athlete'"),
    ("地球", "'planet Earth' (film genre)"),
    ("職業", "formal 'profession' (工作 covers everyday use)"),
    ("年代", "'decade, era'"),
    ("科學", "academic 'science'"),
    ("藝術", "academic 'art'"),
    ("專家", "news 'expert'"),
    ("分析", "formal 'to analyze'"),
]

# Final-audit swaps (see data/AUDIT.md). The blend leans toward written/news words: wordfreq mixes in web, news and
# Wikipedia text, and both corpora are mainland-heavy. Because of that, essential Taiwan household words (下雨, 生氣,
# 便當, 等一下...) were missing, while abstract news words that are rare in speech were in. "Rare in speech" means
# a SUBTLEX-CH rank mostly above 1300, even though the blend put them in the top 1000.
# AUDIT_IN words may come from outside the 6000-word pool; those are taken straight from the dictionaries.
# AUDIT_OUT words may sit anywhere in the list. Both lists must have the same length.
AUDIT_IN: list[tuple[str, str]] = [
    ("這邊", "'here / this side', as common as 這裡 in Taiwan; its pair 那邊 was already in the list"),
    ("等一下", "'wait a sec' / 'in a bit', one of the most frequent Taiwan phrases (SUBTLEX splits it into 等 + 一下)"),
    ("還好", "'it's OK / not bad / luckily', a constant reply in Taiwan speech"),
    ("算了", "'forget it / never mind'"),
    ("不客氣", "'you're welcome', the standard reply to 謝謝"),
    ("沒問題", "'no problem'"),
    ("生氣", "'angry' (SUBTLEX spoken rank 813)"),
    ("生日", "'birthday' (SUBTLEX spoken rank 820)"),
    ("下雨", "'to rain'; no weather word was in the list"),
    ("天氣", "'weather'"),
    ("洗澡", "'to shower / bathe', a daily household verb"),
    ("上班", "'to go to work' (SUBTLEX spoken rank 1290)"),
    ("便當", "'boxed lunch', a Taiwan everyday word missing from mainland corpora"),
    ("機車", "'scooter' (Taiwan's main vehicle); also slang 'annoying'"),
    ("早餐", "'breakfast' (Taiwan says 早餐, not 早飯)"),
    ("晚餐", "'dinner' (SUBTLEX spoken rank 1206)"),
    ("鑰匙", "'key' (SUBTLEX spoken rank 835)"),
    ("洗", "'to wash' (SUBTLEX spoken rank 887)"),
    ("借", "'to borrow / lend' (SUBTLEX spoken rank 956)"),
    ("慢", "'slow'; its opposite 快 was already in the list"),
    ("痛", "'to hurt / painful', used in many examples but missing as a word"),
    ("厲害", "'awesome / formidable', extremely common in Taiwan"),
    ("乾淨", "'clean'"),
    ("好看", "'good-looking / good (show, book)'"),
    ("好玩", "'fun'"),
    ("前面", "'in front / ahead'; its pair 後面 was already in the list"),
    ("旁邊", "'next to / beside'"),
    ("男朋友", "'boyfriend' (SUBTLEX spoken rank 1172)"),
    ("女朋友", "'girlfriend' (SUBTLEX spoken rank 1110)"),
    ("魚", "'fish'; no basic food word besides 飯/菜/麵 was in the list"),
    ("肉", "'meat'"),
    ("茶", "'tea'"),
    ("水果", "'fruit'"),
    ("恭喜", "'congratulations' (SUBTLEX spoken rank 977)"),
    ("道歉", "'to apologize' (SUBTLEX spoken rank 898)"),
    ("見面", "'to meet up' (SUBTLEX spoken rank 917)"),
    ("差不多", "'about the same / almost' (SUBTLEX spoken rank 927)"),
    ("陪", "'to keep someone company' (SUBTLEX spoken rank 984)"),
    ("安靜", "'quiet' (SUBTLEX spoken rank 1013)"),
    ("太太", "'wife / Mrs.', the polite everyday Taiwan word (SUBTLEX spoken rank 711)"),
    ("醒", "'to wake up' (SUBTLEX spoken rank 601)"),
    ("搬", "'to move (house) / carry' (SUBTLEX spoken rank 864)"),
    ("開車", "'to drive'"),
    ("好喝", "'tasty (drinks)', the partner of 好吃"),
]
AUDIT_OUT: list[tuple[str, str]] = [
    ("文化", "abstract/news 'culture'"),
    ("經濟", "news 'economy'"),
    ("國際", "news 'international'"),
    ("管理", "formal 'management'"),
    ("全國", "news 'nationwide'"),
    ("教育", "formal 'education'"),
    ("傳統", "abstract 'tradition'"),
    ("環境", "formal 'environment'"),
    ("內容", "formal 'content'"),
    ("政治", "news 'politics'"),
    ("提出", "formal 'to put forward'"),
    ("建立", "formal 'to establish'"),
    ("由於", "written 'due to' (因為 is the spoken word)"),
    ("地區", "news 'region'"),
    ("基本", "formal 'basic'"),
    ("時代", "abstract 'era'"),
    ("產生", "written 'to produce, give rise to'"),
    ("作品", "formal 'work (of art)'"),
    ("條件", "formal 'conditions, terms'"),
    ("專業", "formal 'professional'"),
    ("發展", "news 'development'"),
    ("人民", "political 'the people'"),
    ("過程", "abstract 'process'"),
    ("價值", "abstract 'value'"),
    ("項目", "formal 'item, project'"),
    ("顯示", "formal 'to display, indicate'"),
    ("參與", "formal 'to participate' (參加 is in the list)"),
    ("人物", "formal 'figure, character'"),
    ("權利", "legal/political 'right'"),
    ("女性", "formal 'female' (女生, 女人 are in the list)"),
    ("成員", "formal 'member'"),
    ("技術", "formal 'technology, technique'"),
    ("包括", "formal 'to include'"),
    ("破壞", "formal/film 'to destroy'"),
    ("造成", "written 'to cause'"),
    ("組織", "news/film 'organization'"),
    ("武器", "film-genre 'weapon'"),
    ("攻擊", "film-genre 'to attack'"),
    ("威脅", "film-genre 'to threaten'"),
    ("某", "literary 'a certain'"),
    ("以來", "written 'since'"),
    ("犯罪", "crime-film 'crime'"),
    ("交易", "film/business 'deal, transaction'"),
    ("命令", "film-genre 'order, command'"),
]

# Placement of curated everyday words (sanity-sweep and audit additions). Corpus frequency badly understates how
# often Taiwanese family speech uses them. Subtitles write numbers as digits, and 好吃, 便宜 and 台灣 fall in the
# mainland corpora's blind spots. At their blended rank they sat at list ranks 975-1000, below 權利 and 監獄. So they
# are placed by judgment instead: PLACE_TIER_A is spread evenly over blend positions 120-560 and PLACE_TIER_B over
# 560-1000, both in the order listed. Numbers sit next to their neighbours (PLACE_AFTER). Every curated word must
# appear exactly once in these tables.
PLACE_TIER_A: list[str] = [
    "不好意思", "沒關係", "這邊", "等一下", "好吃", "累", "還好", "吃飯", "算了", "你好", "生氣",
    "不客氣", "台灣", "沒問題", "餓", "老公", "生日", "下雨", "舒服", "晚安", "便宜", "貴",
]
PLACE_TIER_B: list[str] = [
    "冷", "飯", "天氣", "菜", "廁所", "姐姐", "上班", "洗澡", "弟弟", "妹妹", "耶", "便當", "早餐", "晚餐",
    "鑰匙", "機車", "洗", "借", "慢", "痛", "厲害", "乾淨", "好看", "好玩", "前面", "旁邊", "男朋友",
    "女朋友", "魚", "肉", "茶", "水果", "恭喜", "道歉", "見面", "差不多", "陪", "安靜", "太太", "醒",
    "搬", "開車", "好喝",
]
PLACE_AFTER: dict[str, tuple[str, float]] = {
    "七": ("六", 0.1), "八": ("六", 0.2), "九": ("六", 0.3), "十": ("六", 0.4), "零": ("六", 0.5),
    "百": ("萬", 0.1), "千": ("萬", 0.2),
}

# ---------------------------------------------------------------------------------------------

def load_lines(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_wide() -> list[dict]:
    if not WIDE.exists():
        cmd = [sys.executable, str(HERE / "build_candidates.py"), "--top", str(WIDE_TOP), "--out", str(WIDE)]
        subprocess.run(cmd + ["--offline"], check=False)
        if not WIDE.exists():
            subprocess.run(cmd, check=True)
    return load_lines(WIDE)


def first_pinyin(e: dict) -> str:
    if e.get("cedict"):
        return e["cedict"][0]["pinyin"]
    if e.get("moe"):
        return e["moe"][0]["pinyin"]
    return "?"


def main() -> None:
    cands = load_lines(CANDIDATES)
    wide = ensure_wide()
    assert len(wide) >= len(cands) and all(a == b for a, b in zip(cands, wide)), \
        "candidates-wide.json does not extend candidates.json; delete data/cache/candidates-wide.json and rerun"
    by_trad = {e["trad"]: e for e in wide}
    t2s = opencc.OpenCC("tw2s")

    _dicts: dict = {}

    def dicts():
        if not _dicts:
            _dicts["ced"] = bc.load_cedict()
            _dicts["moe"] = bc.load_moe()
        return _dicts

    def lookup(trad: str) -> tuple[list, list]:
        ced_t, ced_s = dicts()["ced"]
        ced, _, _ = bc.cedict_for(trad, [t2s.convert(trad)], ced_t, ced_s)
        moe_r, _ = bc.moe_for(trad, dicts()["moe"])
        return ced, moe_r

    def pool_or_dict(trad: str) -> dict:
        """Entry for a word: from the extended pool (through a RENAME if needed), else straight from the dictionaries."""
        if trad in by_trad:
            return dict(by_trad[trad])
        for old, (new, _, _) in RENAME.items():
            if new == trad and old in by_trad:
                return dict(by_trad[old])
        ced, moe_r = lookup(trad)
        assert ced or moe_r, f"no dictionary entry for {trad}"
        return {"blendRank": None, "trad": trad, "simp": t2s.convert(trad), "cedict": ced, "moe": moe_r, "flags": []}

    def apply_rename(e: dict) -> dict:
        if e["trad"] in RENAME:
            new, moe_from, why = RENAME[e["trad"]]
            e = dict(e)
            e["renamedFrom"] = e["trad"]
            e["trad"] = new
            if moe_from:
                e["moe"] = dicts()["moe"].get(moe_from, e["moe"])
            else:
                m, _ = bc.moe_for(new, dicts()["moe"])
                if m:
                    e["moe"] = m
                ced, _ = lookup(new)
                # use the new form's CEDICT entry unless it is only a "variant of" pointer
                if ced and not all(all(d.startswith("variant of") for d in c["defs"]) for c in ced):
                    e["cedict"] = ced
            e["note"] = f"Spelled {new} (not {e['renamedFrom']}): {why}."
        return e

    substitute_targets = {v[0] for v in SUBSTITUTE.values()}

    # ---- 1. walk + drop + substitute + backfill
    kept: list[dict] = []
    seen: set[str] = set()
    dropped: list[tuple[dict, str, str]] = []
    substituted: list[tuple[dict, dict, str]] = []
    skipped_dupes: list[tuple[dict, str]] = []
    unused = set(DROP) | set(SUBSTITUTE) | set(RENAME)
    walked = 0
    for e in wide:
        if len(kept) >= TARGET:
            break
        walked = e["blendRank"]
        t = e["trad"]
        unused.discard(t)
        if t in DROP:
            cat, why = DROP[t]
            dropped.append((e, cat, why))
            continue
        if t in SUBSTITUTE:
            new_t, why = SUBSTITUTE[t]
            if new_t in seen:
                dropped.append((e, "mainland", f"mainland-only; Taiwan equivalent {new_t} already in the list"))
                continue
            ne = apply_rename(pool_or_dict(new_t))
            ne["sortKey"] = e["blendRank"]
            ne["note"] = f"Taiwan substitute for {t} (slot of {t}, blend rank {e['blendRank']}): {why}."
            substituted.append((e, ne, why))
            kept.append(ne)
            seen.add(new_t)
            continue
        e = apply_rename(e)
        if e["trad"] in seen:
            skipped_dupes.append((e, "already present (as a substitute or split-out)"))
            continue
        e["sortKey"] = e["blendRank"]
        kept.append(e)
        seen.add(e["trad"])
    assert len(kept) == TARGET
    unused -= {v[0] for v in SUBSTITUTE.values()}
    pre_swap_last = walked

    # ---- 2. sanity-sweep swaps
    swaps_in_done, swaps_natural = [], []
    for t, why in SWAP_IN:
        if t in seen:
            swaps_natural.append((t, why))
            continue
        assert t not in DROP and t not in substitute_targets, t
        ne = apply_rename(pool_or_dict(t))
        assert ne.get("blendRank"), f"{t} has no frequency rank"
        ne["sortKey"] = ne["blendRank"]
        ne["note"] = (f"Sanity-sweep addition (blend rank {ne['blendRank']}): {why}. " + ne.get("note", "")).strip()
        swaps_in_done.append((ne, why))
    for t, src, why in SPLIT_IN:
        assert t not in seen, t
        src_e = next(e for e in kept if e["trad"] == src)
        ced, moe_r = lookup(t)
        ne = {"blendRank": None, "trad": t, "simp": t2s.convert(t), "cedict": ced, "moe": moe_r, "flags": [],
              "sortKey": src_e["sortKey"] + 0.5,
              "note": f"Split out of {src} (blend rank {src_e['blendRank']}; no frequency of its own): {why}."}
        swaps_in_done.append((ne, why))
    n_in = len(swaps_in_done)
    if "--dump-bottom" in sys.argv:
        n = int(sys.argv[sys.argv.index("--dump-bottom") + 1])
        for e in kept[-n:]:
            print(e["blendRank"], e["trad"], first_pinyin(e), "|", (e["cedict"][0]["defs"][0][:50] if e["cedict"] else ""))
        print("swap-ins needed:", n_in, "natural:", [t for t, _ in swaps_natural])
        return
    assert len(SWAP_OUT_ORDER) == n_in, f"need {n_in} swap-outs, have {len(SWAP_OUT_ORDER)}"
    kept_by_trad = {e["trad"]: e for e in kept}
    swaps_out_done = []
    for t, why in SWAP_OUT_ORDER[:n_in]:
        assert t in kept_by_trad, f"swap-out {t} not in the pre-swap list"
        swaps_out_done.append((kept_by_trad[t], why))
    out_set = {e["trad"] for e, _ in swaps_out_done}

    # ---- 2b. final-audit swaps (AUDIT_IN / AUDIT_OUT)
    assert len(AUDIT_IN) == len(AUDIT_OUT), f"AUDIT_IN has {len(AUDIT_IN)}, AUDIT_OUT {len(AUDIT_OUT)}"
    sub_rank = {e["trad"]: i for i, e in enumerate(sorted(wide, key=lambda x: -(x.get("subtlexFreq") or 0)), 1)}
    swapped_in_trads = {ne["trad"] for ne, _ in swaps_in_done}
    audit_in_done, audit_out_done = [], []
    for t, why in AUDIT_IN:
        assert t not in seen and t not in swapped_in_trads and t not in DROP, f"audit addition {t} already present or dropped"
        ne = apply_rename(pool_or_dict(t))
        br = ne.get("blendRank")
        where = f"blend rank {br}, SUBTLEX spoken rank {sub_rank.get(t)}" if br else "not in the 6000-word corpus pool"
        ne["note"] = f"Final-audit addition ({where}): {why}."
        ne["sortKey"] = br or 10**6
        audit_in_done.append((ne, why))
    for t, why in AUDIT_OUT:
        assert t in kept_by_trad and t not in out_set, f"audit swap-out {t} not in the list"
        audit_out_done.append((kept_by_trad[t], why))
    out_set |= {e["trad"] for e, _ in audit_out_done}

    final = ([e for e in kept if e["trad"] not in out_set] + [e for e, _ in swaps_in_done]
             + [e for e, _ in audit_in_done])

    # ---- 2c. placement of curated everyday words (PLACE_TIER_A / PLACE_TIER_B / PLACE_AFTER)
    curated = [t for t, _ in SWAP_IN] + [t for t, _ in AUDIT_IN]
    placed = PLACE_TIER_A + PLACE_TIER_B + list(PLACE_AFTER)
    assert sorted(placed) == sorted(curated), (
        f"placement tables must list every curated word exactly once; "
        f"missing {sorted(set(curated) - set(placed))}, extra {sorted(set(placed) - set(curated))}, "
        f"dupes {sorted(t for t in placed if placed.count(t) > 1)}")
    by_final = {e["trad"]: e for e in final}
    for tier, lo, hi in ((PLACE_TIER_A, 120, 560), (PLACE_TIER_B, 560, 1000)):
        for i, t in enumerate(tier):
            by_final[t]["placedKey"] = round(lo + (hi - lo) * i / len(tier), 2) + 0.25
    for t, (anchor, off) in PLACE_AFTER.items():
        by_final[t]["placedKey"] = by_final[anchor]["sortKey"] + off
    final.sort(key=lambda e: e.get("placedKey", e["sortKey"]))
    assert len(final) == TARGET
    assert len({e["trad"] for e in final}) == TARGET

    # ---- 3. write selected.json
    rows = []
    for i, e in enumerate(final, 1):
        note = e.get("note") or KEEP_NOTES.get(e["trad"])
        if e.get("note") and e["trad"] in KEEP_NOTES:
            note = e["note"] + " " + KEEP_NOTES[e["trad"]]
        r = {"rank": i, "trad": e["trad"], "simp": t2s.convert(e["trad"]), "cedict": e["cedict"], "moe": e["moe"]}
        if note:
            r["selectionNote"] = note
        r["blendRank"] = e.get("blendRank")
        rows.append(r)
    body = "[\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows) + "\n]\n"
    OUT.write_text(body, encoding="utf-8", newline="\n")

    # ---- 4. selection log
    final_trads = {e["trad"] for e in final}
    L = []
    L.append("# Word selection log\n")
    L.append("Generated by `scripts/data/select_words.py` from `data/candidates.json` "
             f"(extended pool: `data/cache/candidates-wide.json`, `build_candidates.py --top {WIDE_TOP}`). "
             "Do not edit by hand; change the decision tables in the script and rerun.\n")
    L.append("## Summary\n")
    L.append(f"- Final list: **{len(final)}** words, `rank` 1..{len(final)} in blended-frequency order, except "
             f"that the {len(curated)} curated everyday words are placed by judgment (see Placement).")
    L.append(f"- Walked the candidates down to blend rank {pre_swap_last} to fill 1000 slots after removals (backfill).")
    L.append(f"- Removed: {len(dropped)}. Substituted (mainland -> Taiwan, same slot): {len(substituted)}. "
             f"Spelling changes: {sum(1 for e in final if e.get('renamedFrom'))}.")
    L.append(f"- Sanity-sweep additions: {n_in} ({len(SPLIT_IN)} of them split-out characters), "
             f"each displacing one low-value word from the bottom of the list.")
    L.append(f"- Final-audit additions: {len(audit_in_done)}, each displacing an abstract/news word that is rare in "
             f"speech (see Final audit).")
    L.append("- Substitutes keep the slot of the word they replace. Split-outs sit right after their source. "
             "Curated everyday words (sweep and audit additions) are placed by judgment.\n")

    L.append("## Substitutions (mainland -> Taiwan, same rank slot)\n")
    L.append("| Slot (blend rank) | Mainland word | Taiwan word | Why |\n|---|---|---|---|")
    for e, ne, why in substituted:
        L.append(f"| {e['blendRank']} | {e['trad']} | {ne['trad']} ({first_pinyin(ne)}) | {why} |")
    L.append("")

    L.append("## Spelling changes (Taiwan character forms)\n")
    for e in final:
        if e.get("renamedFrom"):
            L.append(f"- {e['renamedFrom']} -> **{e['trad']}**: {RENAME[e['renamedFrom']][2]}")
    L.append("")

    L.append("## Removals\n")
    groups = collections.defaultdict(list)
    for e, cat, why in dropped:
        groups[cat].append((e, why))
    for cat, title in CATEGORIES.items():
        if not groups.get(cat):
            continue
        L.append(f"### {title} ({len(groups[cat])})\n")
        L.append("| Blend rank | Word | Pinyin | Reason |\n|---|---|---|---|")
        for e, why in groups[cat]:
            L.append(f"| {e['blendRank']} | {e['trad']} | {first_pinyin(e)} | {why} |")
        L.append("")
    if skipped_dupes:
        L.append("### Duplicates skipped\n")
        for e, why in skipped_dupes:
            L.append(f"- {e['blendRank']} {e['trad']}: {why}")
        L.append("")

    L.append("## Backfill\n")
    back = [e for e in kept if e.get("blendRank") and e["blendRank"] > TARGET and e["trad"] not in out_set
            and e["sortKey"] == e["blendRank"] and not e.get("note", "").startswith("Taiwan substitute")]
    L.append(f"Candidates from beyond blend rank {TARGET} that fill the removed slots ({len(back)}):\n")
    L.append(", ".join(f"{e['trad']} ({e['blendRank']})" for e in back) + "\n")

    L.append("## Sanity sweep\n")
    L.append("Essential everyday words were checked against the list (謝謝, 對不起, 沒關係, 吃飯, 喜歡, 朋友, 今天, "
             "明天, 現在, 東西, 錢, 水, 家, numbers, family, food, shopping, feelings, greetings...). "
             "Those missing were added from the extended pool, each displacing a much less useful word "
             "(news, formal or film-genre vocabulary) from the bottom of the list.\n")
    if swaps_natural:
        L.append("Already present after backfill (no swap needed): "
                 + ", ".join(t for t, _ in swaps_natural) + ".\n")
    L.append("### Added\n")
    L.append("| Word | Pinyin | Blend rank | Why |\n|---|---|---|---|")
    for ne, why in swaps_in_done:
        br = ne["blendRank"] if ne["blendRank"] else "(split)"
        L.append(f"| {ne['trad']} | {first_pinyin(ne)} | {br} | {why} |")
    L.append("")
    L.append("### Displaced\n")
    L.append("| Word | Pinyin | Blend rank | Why it is less useful |\n|---|---|---|---|")
    for e, why in swaps_out_done:
        L.append(f"| {e['trad']} | {first_pinyin(e)} | {e['blendRank']} | {why} |")
    L.append("")

    L.append("## Final audit\n")
    L.append("A native-teacher style audit (data/AUDIT.md) found essential household words still missing, while "
             "abstract news words sat in the list only because of the written-text half of the blend. Their "
             "SUBTLEX-CH (spoken) rank is mostly above 1300. Each addition below displaces one of them. Words "
             "with no blend rank are not in the 6000-word pool, because mainland corpora lack them or segment "
             "them differently, and are taken straight from the dictionaries.\n")
    L.append("### Added\n")
    L.append("| Word | Pinyin | Blend rank | SUBTLEX rank | Why |\n|---|---|---|---|---|")
    for ne, why in audit_in_done:
        L.append(f"| {ne['trad']} | {first_pinyin(ne)} | {ne.get('blendRank') or '-'} | "
                 f"{sub_rank.get(ne['trad'], '-')} | {why} |")
    L.append("")
    L.append("### Displaced\n")
    L.append("| Word | Pinyin | Blend rank | SUBTLEX rank | Why it is less useful |\n|---|---|---|---|---|")
    for e, why in audit_out_done:
        L.append(f"| {e['trad']} | {first_pinyin(e)} | {e['blendRank']} | {sub_rank.get(e['trad'], '-')} | {why} |")
    L.append("")

    L.append("## Placement of curated everyday words\n")
    L.append("Corpus frequency badly understates the sweep and audit additions in Taiwanese family speech. "
             "Subtitles write numbers as digits, and words like 好吃, 便宜 and 台灣 fall in the mainland corpora's "
             "blind spots. At their blended rank they would sit at the very end of the list, after 權利 or 監獄. "
             "So they are placed by judgment: tier A is spread evenly over blend positions 120-560, tier B over "
             "560-1000, and numbers sit next to 六 or 萬. Final ranks:\n")
    final_rank = {e["trad"]: i for i, e in enumerate(final, 1)}
    L.append("- Tier A: " + ", ".join(f"{t} ({final_rank[t]})" for t in PLACE_TIER_A))
    L.append("- Tier B: " + ", ".join(f"{t} ({final_rank[t]})" for t in PLACE_TIER_B))
    L.append("- Next to a neighbour: " + ", ".join(f"{t} ({final_rank[t]}, after {a})" for t, (a, _) in PLACE_AFTER.items()))
    L.append("")

    L.append("## Kept despite a junk flag\n")
    for e in final:
        bad = [f for f in e.get("flags", []) if f.split(":")[0] in
               {"properNoun", "fragment", "noDict", "boundMorpheme", "interjection", "translationese",
                "vulgar", "translitChar", "mainlandOnly", "numMeasure"}]
        if bad:
            L.append(f"- {e['trad']} ({e['blendRank']}; {', '.join(bad)}): "
                     f"{KEEP_NOTES.get(e['trad'], e.get('note', 'kept'))}")
    L.append("")
    L.append("## Not in either corpus list (cannot be ranked)\n")
    L.append("These everyday Taiwan words are missing from the 6000-word extended pool entirely (frequency "
             "too low in mainland-heavy corpora, or segmented differently). The final audit added 便當, 機車, "
             "下雨, 好喝, 等一下, 還好, 算了, 不客氣 and 沒問題 by judgment. Still left out: 捷運, 渴, 冷氣, 夜市, "
             "便利商店, 阿公/阿嬤, 外公, 姊姊, 待會, 對啊, 國語/台語. A curated 'everyday Taiwan' supplement deck "
             "would be the right place for them.\n")

    LOG.write_text("\n".join(L), encoding="utf-8", newline="\n")

    # ---- console summary
    renamed_in = {e["renamedFrom"] for e in final if e.get("renamedFrom")}
    leftover = sorted(unused - final_trads - renamed_in - {e['trad'] for e, _, _ in dropped})
    print(f"wrote {len(rows)} words to {OUT}")
    print(f"dropped {len(dropped)}, substituted {len(substituted)}, swaps {n_in}, walked to blend rank {pre_swap_last}")
    if leftover:
        print("decision entries not reached (beyond the walk):", " ".join(leftover))


if __name__ == "__main__":
    main()
