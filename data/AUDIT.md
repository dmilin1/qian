# Final data audit: `src/data/words.json`

This audit reviews the word list the way a skeptical Taiwan Mandarin teacher would, for a learner who works by ear. It was done after the 20 enrichment chunks and their reviews were merged.

## Bottom line

- **The per-word content was already in very good shape.** Readings, tones, glosses, notes and examples survived every automated and manual check below. Only small consistency fixes were needed.
- **The real problem was the word list itself.** The frequency blend leans toward written and news text, and both corpora are mainland-heavy. So the list held 經濟, 國際, 全國, 地區, 產生, 權利 and similar words, while essential household words were missing entirely: 下雨, 天氣, 生氣, 生日, 等一下, 還好, 算了, 不客氣, 便當, 機車, 洗澡, 上班, 早餐, 鑰匙, 慢, 痛, 魚, 肉, 茶, 男朋友, 這邊 and others. The order was also off. The core everyday words added earlier (七/八/九, 你好, 好吃, 累, 餓, 便宜, 台灣...) sat at ranks 975–1000, after 權利 and 監獄.
- **Fixed:** 44 news/abstract words were swapped for 44 everyday Taiwan words, and the 72 curated everyday words were moved to sensible positions. Word ids are unchanged for every word that stayed in the list; the 44 new words got new ids, and the ids of removed words stay reserved in `data/ids.lock.json`.

## What I checked

1. **All 1000 entries, quickly:** traditional characters, pinyin, gloss, hint and part of speech. I looked for wrong readings or tones, mainland-only vocabulary and wrong glosses.
2. **Every headword reading against MOE** (`dict-revised`, the 重編國語辭典修訂本, via `data/cache/moedict`) by script:
   - 994 of 1000 readings match an MOE reading exactly, or the word has no MOE headword.
   - The 6 deliberate differences are all documented in the entry notes: 但是 dàn shì, 台 tái (MOE files the measure word under 臺), 上面 shàng miàn, 家裡 jiā lǐ, 留下 liú xià and 多麼 duō me.
   - The words with no MOE headword are compounds like 看到, 為了, 很多 and 女朋友, and their readings are built from MOE parts.
3. **Every example sentence, syllable by syllable:**
   - Multi-character words were matched against MOE.
   - Single characters were checked against pypinyin's context reading, ignoring neutral-versus-full tone differences.
   - All 57 differences are correct Taiwan readings: 誰 shéi, 為 wéi in 認為/成為/以為/作為/行為, 覺 jiào in 睡覺, 場 cháng, 期 qí in 星期, 髮 fǎ, 危 wéi, 息 xí, 擊 jí, 擁 yǒng, 樂 yuè in 音樂, 銀行 háng, 的確 dí, 乾 gān, 幾乎 jī, 待 dāi, 一會 huǐ and 垃圾 lè sè.
4. **Consistency:**
   - Each headword's pinyin inside its own example equals the headword pinyin. The only difference is 個 gè, written ge after a number, which is intended.
   - Each multi-character headword is read the same way wherever it appears in other examples. The only variant is 關係 guān xì vs 沒關係 méi guān xi, which follows MOE.
   - Checked across chunks: the potential-complement 不 (V-bu-V), sentence-final 喔, and duplicate example sentences.
5. **Deep check of 103 sampled entries** (every rank ≡ 3 mod 8), including note, example, English and spokenAs.
6. **Deep check of all 129 single-character entries with more than one MOE reading:** I checked that the chosen reading is the spoken one, and that the note names the other readings correctly (和, 還, 行, 得, 了, 長, 重, 覺, 為, 都, 地, 著, 場, 倒, 數, 差, 血, 卡, 弄...).
7. **Mainland vocabulary scan** of the examples and notes (視頻, 出租, 地鐵, 質量, 信息, 網絡, 軟件, 挺, 啥, 咱, erhua 這兒/哪兒/一會兒, 早飯, 外賣, 菠蘿, 土豆...). The only hits are notes that name the mainland word as a contrast.
8. **Rank order and coverage:**
   - I compared each listed word's spoken rank (SUBTLEX-CH only) with its blended rank.
   - I checked a list of about 300 essential everyday words: food, family, weather, body, transport, feelings, politeness, places and time.
   - I re-ran `scripts/data/prompt_groups.py` for the Say-card prompts and checked that every group with a new word is distinguishable. `build_words.py` passes with no errors. It still prints 4 intended warnings: 垃圾 lè sè, and 那邊 nà biān and 女朋友 nǚ péng yǒu (full tones, matching 這邊 and 男朋友).

## What I fixed

### Word list (`scripts/data/select_words.py` → `data/selected.json`, `data/selection-log.md`)

**Added (44):**
- Phrases: 這邊, 等一下, 還好, 算了, 不客氣, 沒問題
- Feelings, weather and occasions: 生氣, 生日, 下雨, 天氣
- Daily routine and things: 洗澡, 上班, 便當, 機車, 早餐, 晚餐, 鑰匙
- Verbs: 洗, 借
- Describing words: 慢, 痛, 厲害, 乾淨, 好看, 好玩
- Places: 前面, 旁邊
- People: 男朋友, 女朋友
- Food and drink: 魚, 肉, 茶, 水果
- More: 恭喜, 道歉, 見面, 差不多, 陪, 安靜, 太太, 醒, 搬, 開車, 好喝

Most of them have a SUBTLEX spoken rank between 600 and 1300, which beats much of the existing list. Nine are not in the corpus pool at all, because mainland subtitles lack them or split them into parts: 下雨, 便當, 機車, 等一下, 還好, 算了, 不客氣, 沒問題, 好喝.

**Removed (44)**, all abstract, news or film-genre words, most with a SUBTLEX spoken rank above 1300:
- News and society: 文化, 經濟, 國際, 全國, 政治, 地區, 人民, 發展, 傳統, 環境, 教育, 時代, 權利
- Formal or abstract: 管理, 內容, 提出, 建立, 由於, 基本, 產生, 作品, 條件, 專業, 過程, 價值, 項目, 顯示, 參與, 人物, 女性, 成員, 技術, 包括, 造成, 某, 以來
- Crime and film genre: 組織, 武器, 攻擊, 威脅, 犯罪, 交易, 命令, 破壞

Their authored entries are saved in `data/enriched-removed.json` in case any is wanted back.

**Placement.** The 72 curated everyday words are the 28 earlier sweep additions plus these 44. Their corpus frequency badly understates Taiwanese family speech: subtitles write numbers as digits, and 好吃, 便宜 and 台灣 fall in the mainland corpora's blind spots. They are now placed by judgment, through explicit tables in the script:

- **Tier A, ranks 115–524:** 不好意思, 沒關係, 這邊, 等一下, 好吃, 累, 還好, 吃飯, 算了, 你好, 生氣, 不客氣, 台灣, 沒問題, 餓, 老公, 生日, 下雨, 舒服, 晚安, 便宜, 貴
- **Tier B, ranks 541–931:** everything else
- **Numbers:** 七–十 and 零 follow 六 (791–796), and 百/千 follow 萬 (325–326).

Every other word keeps its blended-frequency order. This changed 886 ranks. Ids did not change, because they are keyed by characters and reading.

### Entries (`data/enriched/chunk-*.json`, re-chunked by `scripts/data/rechunk.py`)

- Wrote full entries for the 44 new words: gloss, hint, part of speech, note with inline pinyin, and a natural example sentence. Readings follow MOE: 便當 biàn dāng, 鑰匙 yào shi, 不客氣 bù kè qì, 差不多 chà bu duō, 厲害 lì hài, 乾淨 gān jìng and 太太 tài tai.
- Say-card prompts kept distinct from their neighbours:
  - 等一下 "three syllables; also 'later today'", not 等等.
  - 還好 "it's OK; so-so; luckily", not 不錯 "not bad".
  - 沒問題 "agreeing to a request", not 不會.
  - 太太 "polite everyday word; also a title", not 老婆 or 妻子.
  - 好吃 gets the hint "for food", against 好喝 "for something you drink".
- **Consistency fixes:**
  - Sentence-final 喔 in the 多 and 大 examples was ō and is now light **o**, the agreed split used by every other example and by the 喔 note.
  - The 記 example jìbùzhù is now **jìbuzhù**, and the 做到 note zuò bù dào is now **zuò bu dào**. Potential-complement 不 is neutral everywhere else (聽不懂, 睡不著, 受不了).
- New examples were written so they do not duplicate existing sentences. Some older duplicates are left as they were, because two words sharing one sentence is harmless (for example 件/衣服 and 明天).
- `scripts/data/rechunk.py` is new. It re-ranks the authored entries from `selected.json`, adds new entries with `--add` and archives dropped ones. It rewrites the chunks as 20 files of 50, so chunk-NN holds ranks (NN-1)·50+1 … NN·50 again. **Rank numbers quoted in older `data/NOTES.md` sections refer to the order before this audit.**

## For a native speaker (the learner's wife) to double-check

The data follows the MOE dictionary, Taiwan's official standard. Everyday Taiwan speech, especially among younger people, often differs from it. She should listen for these.

**Neutral or light tone vs full tone.** MOE writes a light second syllable, but many Taiwanese say a full tone:
- 告訴 gào su (119), 認識 rèn shi (255), 明白 míng bai (227), 意思 yì si (253), 名字 míng zi (295)
- 回來 huí lai (244), 回去 huí qu (675), 過來 guò lai (320), 下去 xià qu (532)
- 早上 zǎo shang (733), 晚上 wǎn shang (421), 力量 lì liang (707)
- 漂亮 piào liang (435), 衣服 yī fu (569), 麻煩 má fan (667), 舒服 shū fu (467), 困難 kùn nan (969)
- 東西 dōng xi (130), 鑰匙 yào shi (685), 太太 tài tai (904), 差不多 chà bu duō (876)

Which does she actually say?

**Full tone chosen against MOE's light tone:** 上面 shàng miàn (705), 家裡 jiā lǐ (730), 但是 dàn shì (88), 留下 liú xià (739) and 那邊 nà biān (861). Also 兒子 ér zǐ (333), where MOE itself has the full tone. Does she say ér zi?

**Taiwan standard readings that differ from the mainland.** Younger speakers sometimes use the mainland form:
- 危險 wéi xiǎn (599), 突然 tú rán (669), 擁有 yǒng yǒu (509), 頭髮 tóu fǎ (985), 幾乎 jī hū (763)
- 星期 xīng qí (941), 垃圾 lè sè (in the 倒 example, 562), 血 xiě (841), 消息 xiāo xí (408), 休息 xiū xí (943)
- 場 cháng (343), 市場 shì cháng (911), 現場 xiàn cháng (580): many Taiwanese say chǎng.
- 誰 shéi (87) vs shuí; 多麼 duō me (968), where MOE has duó me.

**Choices of the colloquial form:**
- 和 hé (14): PLAN.md mentions the colloquial hàn. The data uses hé and explains hàn in the note. Does she say hàn?
- 蠻 mán (623) or 滿 mǎn?
- 一會 yī huǐ (835): would she ever say it, or always 一下 or 等一下?

**Particles:**
- Sentence-final 喔 is written as a light o (好多喔). Is that right, or is it closer to ō?
- 耶 yē (646): high level, rising yé, or light ye?
- The stand-alone 喔 ō (132): "oh, I see".

**New words from this audit**, worth a quick listen once audio exists:
- 機車 (692): the note mentions the slang "annoying".
- 便當 biàn dāng (655): or biàn dang?
- 不客氣 (334): is it bù kè qì, or with a light qi? Does she find it stiff next to 不會?
- 還好 (235): "it's OK / luckily".
- 肉 (823): the note says plain 肉 usually means pork, and that many Taiwanese avoid beef. Is that fair?
- 太太 (904) vs 老婆 (860): which does she use for "my wife"?

**Naturalness questions carried over from the chunk reviews** (details in `data/NOTES.md`):
- 我認為這樣比較好: too stiff?
- 女士優先，你先請 (女士, 600)
- 提防 tí fáng (提, 601)
- 一部車 or 一台車 (部 570, 台 587)
- 你過來 guò lai or guò lái?
- 睡不著 zháo or zhāo?
- 他的嘴很甜, or 嘴巴?
- 一把椅子 or 一張椅子?
- 丟垃圾 vs 倒垃圾
- 選 vs 挑
- 有意思 vs 有趣 vs 好玩

**Word list:** Do any of the 44 removed words matter to her (`data/selection-log.md`, "Final audit")? Are other household words still missing that she uses daily? Candidates left out: 捷運, 渴, 冷氣, 夜市, 便利商店, 阿公/阿嬤, 外公/外婆, 爺爺/奶奶, 下班, 中午, 雞, 蛋, 湯, 帥, 計程車, 公車.
