"""Test set for the model bake-off: tricky high-frequency words (polyphones, neutral tones, sandhi,
Taiwan readings) with expected Taiwan-standard pinyin and a short example sentence for context."""

# (trad, pinyinNumbered, example sentence containing the word)
WORDS = [
    ("是", "shi4", "他是我的朋友。"),
    ("好", "hao3", "今天天氣很好。"),
    ("來", "lai2", "你什麼時候來？"),
    ("去", "qu4", "我們去吃飯吧。"),
    ("他", "ta1", "他是我哥哥。"),
    ("不", "bu4", "我不知道。"),
    ("一", "yi1", "我有一個問題。"),  # context deliberately puts 一 in sandhi position (yí)
    ("了", "le5", "我吃飽了。"),
    ("的", "de5", "這是我的書。"),
    ("嗎", "ma5", "你好嗎？"),
    ("還", "hai2", "你還好嗎？"),
    ("行", "xing2", "這樣行不行？"),
    ("得", "de5", "他跑得很快。"),
    ("都", "dou1", "我們都是朋友。"),
    ("長", "chang2", "她的頭髮很長。"),
    ("要", "yao4", "你要喝咖啡嗎？"),
    ("會", "hui4", "你會說中文嗎？"),
    ("想", "xiang3", "我想回家。"),
    ("對", "dui4", "你說得對。"),
    ("東西", "dong1 xi5", "我去買東西。"),
    ("知道", "zhi1 dao4", "你知道他住哪裡嗎？"),
    ("認識", "ren4 shi4", "很高興認識你。"),
    ("你好", "ni3 hao3", "你好，我叫小明。"),
    ("朋友", "peng2 you3", "他是我的好朋友。"),
    ("垃圾", "le4 se4", "垃圾要拿出去丟。"),
]

SENTENCES = [
    "你知道他住哪裡嗎？",
    "很高興認識你。",
    "垃圾要拿出去丟。",
    "我們明天早上一起去買東西，好不好？",
]
