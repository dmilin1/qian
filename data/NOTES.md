# data/ notes

## Candidate list (`scripts/data/build_candidates.py` -> `data/candidates.json`)

Run: `./.venv/Scripts/python scripts/data/build_candidates.py` (options: `--top N`, `--weight W`, `--offline`, `--out PATH`).
Downloads go to `data/cache/` (gitignored). The script is deterministic: two runs, including one from an empty cache, gave byte-identical output (current sha256 a0fcd99c…). `data/sources.json` records URLs, sha256 hashes, retrieval dates, package versions and parameters.

### Sources and licenses
- **SUBTLEX-CH** (Cai & Brysbaert 2010, *PLoS ONE* 5(6): e10729; 33.5M words of film/TV subtitles). File: `subtlexch131210.zip` -> `SUBTLEX_CH_131210_CE.utf8`, the combined word-frequency + PoS + pinyin + English file (UTF-8). Downloaded from the official Ghent page `https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexch`. The old crr.ugent.be URLs return 404. The data is free for research use, and the authors ask to be cited (citation above). No formal open license is stated. We commit only derived per-word numbers, not the file.
- **wordfreq** 3.1.1 (`zh`), Python package. Code is Apache-2.0; data is CC BY-SA 4.0. Its `zh` list itself blends several sources, including SUBTLEX-CH, Wikipedia, news, books, web text and Twitter, so the two signals are not fully independent.
- **CC-CEDICT** (MDBG export, `cedict_1_0_ts_utf-8_mdbg.txt.gz`): CC BY-SA 4.0. Defs in candidates.json are excerpts, so attribution and share-alike apply to any derived glosses.
- **MOE 重編國語辭典修訂本** via g0v `moedict-data` (`dict-revised.json.xz`, the dict-revised.json named in the task, xz-compressed in the repo): CC BY-ND 3.0 TW, © 中華民國教育部. Per MOE, format conversion is not "modification". To stay clear of ND, candidates.json copies only factual fields (pinyin, POS type, reading kind) and no definition text. The g0v reformatting is CC0.
- **OpenCC** 1.4.2 (Apache-2.0): `s2twp` / `s2tw` configs, plus `STCharacters.txt` from the OpenCC repo for one-to-many S->T characters.

### Method and judgment calls
- **Blend.** Both sources are put on the Zipf scale (log10 per billion words). SUBTLEX Zipf = log10(count / 33,546,516 × 1e9). **score = 0.6·SUBTLEX + 0.4·wordfreq.** I chose 0.6 over the suggested plain mean so the spoken corpus counts more, since the learner works by ear. With 0.5, written/news words such as 經濟, 政治, 企業, 政策 and 委員會 rank about 200–400 places higher, and everyday words such as 睡覺, 高興, 生日 and 禮物 rank lower. Translationese rises a little at 0.6, but it is flagged. With `--weight 0.5` the top-1000 has 36 `writtenSkew` / 13 `subtitleSkew`; with 0.6 it has 27 / 15.
- A word missing from one source gets Zipf 1.0 (the floor) in that source. The pool is the SUBTLEX top 12k ∪ the wordfreq top 12k, which gives about 16k Traditional groups.
- **SUBTLEX duplicate rows.** About 380 strings appear on more than one row. For example, 你 has 1,329,424 on one row and 638 on another. The first draft overwrote such rows, and 你, 了, 這, 個 and 來 nearly dropped out. Rows are now summed.
- **wordfreq de-dup.** wordfreq simplifies its input before lookup, so 後 and 后 return the same number. Within a merged group each simplified key is counted once.
- **S->T.** Conversion uses OpenCC `s2twp` (phrase-level Taiwan vocabulary), **except** for a reviewed reject list (`S2TWP_REJECT`). There `s2tw` is used, which converts characters only. I reviewed every phrase conversion s2twp makes in the pool (about 150). Many are IT-localisation mappings that are wrong in everyday speech, for example 支持→支援, 打开→開啟, 消息→訊息, 对象→物件, 高级→高階, 类型→型別, 局部→區域性, 扩展→擴充套件, 文件→檔案, 菜单→選單, 社区→社群, 项目→專案 and 数据→資料. Accepted conversions include 出租车→計程車, 软件→軟體, 视频→影片, 信息→資訊, 网络→網路, 联系→聯絡, 自行车→腳踏車, 短信→簡訊, 方便面→泡麵 and 激光→雷射. These carry the `twPhrase` flag.
- **Merging.** Entries that end up with the same Traditional form are merged: SUBTLEX counts are summed, and wordfreq frequencies are summed in linear space. `simp` is the original corpus form with the highest frequency, and `mergedSimp` lists the others. Note that `simp` is the *corpus* form: for 影片 it is 视频. For `words.json`, compute simplified from `trad` instead, e.g. OpenCC `tw2s`.
- **Erhua merge (beyond the task's "same Traditional form" rule).** Erhua forms are merged into their Taiwan non-erhua form and flagged `erhuaMerged`. A form counts as erhua if CEDICT's reading ends in `r5`, or it is in `ERHUA_TARGET`. Examples: 这儿→這裡, 哪儿→哪裡, 那儿→那裡, 一点儿→一點, 一块儿→一起, 玩儿→玩, 事儿→事. Exempt: 会儿 (a segmentation fragment of 一会儿, which would otherwise merge into 會), 女儿, 婴儿 and similar. Taiwan speech has little erhua, so this concentrates frequency on the forms the learner will hear.
- **Traditional forms.** OpenCC gives 臺/臺灣, the MOE standard form. Taiwanese everyday writing usually uses 台. Characters are secondary in this app, so I left it. It is worth a decision when building words.json.
- **Readings.** `cedict[].pinyin` is converted from CEDICT's numbered pinyin to tone marks, lowercased, with erhua attached MOE-style ("diǎnr"). Entries that are only proper nouns or only "variant of" are dropped when a common entry exists. Readings that CEDICT splits across entries are merged, and defs are capped at 6 per reading. `CL:個|个[ge4]` is shortened to `CL:個[ge4]`.
- `moe[]` lists every MOE heteronym. `types` holds MOE's POS letters (e.g. 連 conjunction, 助 particle). `kind` marks MOE's `語音(n)` (colloquial reading of heteronym n), `讀音(n)` (literary) and `又音(n)` (alternate). For example, 和 **hàn** is `語音(一)` and 誰 shuí is `讀音`. Pinyin missing in MOE would be rebuilt from bopomofo using a syllable map learned from MOE itself. That fallback never triggers in the top 1400.
- MOE lookup falls back to standard variants (台→臺, 着→著…). MOE has no 哪裡 entry (it uses 那裡 nǎ lǐ, the older form) and no 香港, 警方 or 他媽的 entries. In total, 56 candidates have no MOE reading.

### Flags (nothing removed; the curation step decides)
Likely junk: `properNoun:{person,place,org,other,cedict}`, `noDict`, `fragment` (multi-character, in neither dictionary: 很多, 來說, 還要, 任何人…), `numMeasure`, `nonChinese`, `interjection` (SUBTLEX PoS e/o: 哦 嗯 嗨 嘿 喔), `translationese` (curated list: 上帝, 該死, 長官, 夫人, 國王…), `vulgar` (操, 他媽的), `translitChar` (斯, 尼), `boundMorpheme` (SUBTLEX PoS is mostly morpheme/affix and CEDICT has no verb sense: 們 者 性 員 時…), `mainlandOnly:<Taiwan alternative>` (curated: 挺, 咱們, 領導, 啥, 同志, 酒店…).
Informational: `subtitleSkew` / `writtenSkew` (the Zipf values of the two sources differ by ≥1.0), `twPhrase`, `erhuaMerged`, `ambiguousS2T:a/b` (single character with several Traditional forms: 干→幹/乾, 发→發/髮, 面→面/麵, 只→只/隻; the merged frequency covers all meanings), `noMoe`, `noCedict`, `moeDiffers`.
- **`moeDiffers` (67)** means no MOE reading equals any CEDICT reading. These are the Taiwan-pronunciation cases the pinyin step must handle. Most are the expected neutral-tone differences: 時候 shí hòu, 朋友 péng yǒu, 先生 xiān shēng, 喜歡 xǐ huān, 學生 xué shēng. The rest are real Taiwan readings: 垃圾 lè sè, 星期 xīng qí, 期間 qí jiān, 研究 yán jiù, 危險 wéi xiǎn, 擁有 yǒng yǒu, 企業 qì yè, 攻擊/襲擊 jí, 建築 jiàn zhú, 市場/機場/現場 cháng, 頭髮 tóu fǎ, 突然 tú rán, 一會 yī huǐ. Note 它們: MOE lists 它 as tuō, so this one is likely a MOE quirk. MOE also writes some words with *more* neutral tones than CEDICT (但是 dàn shi, 知道 zhī dao). The pinyin agent should not blindly prefer MOE for neutral tones and should check against how Taiwanese speakers actually talk.
- Result: of 1400 candidates, 55 carry a likely-junk flag and 1345 do not. The 1000th clean word is at blendRank 1037.

### Observations for curation
- **A pure frequency list underweights concrete everyday vocabulary.** 洗澡, 牛奶, 冰箱, 水果, 雞蛋, 感冒, 下雨, 便當, 捷運, 機車 and 公車 all have Zipf ≈ 4.0–4.4 and fall **outside the top 1400**. The same holds for 老公, 好吃, 便宜 and 貴, which rank about 2100–2600. For a spouse/household learner, consider a curated "everyday Taiwan life" supplement, or raise `--top`. Taiwan-specific words are also penalised because both corpora are mainland-heavy.
- **Written/news vocabulary is still present.** Examples: 發展, 社會, 經濟, 政治, 人民, 委員會, 企業, 政策 and 國際. All carry `writtenSkew`.
- **Subtitle-genre words that are not flagged.** Crime and action vocabulary such as 警察, 槍, 殺, 謀殺, 監獄, 屍體, 兇手 and 武器 comes from film subtitles. It is real Mandarin, so it is not flagged, but it is over-represented.
- **Bound-morpheme false positive risk.** The flag relies on SUBTLEX PoS tags, which are noisy. For example, SUBTLEX tags 喝 as 'g', and only the CEDICT verb-sense check stops 喝 being flagged.
- PoS codes in `posTags` are the ICTCLAS/PKU tags from SUBTLEX-CH, ordered by frequency: n noun, v verb, a adjective, d adverb, r pronoun, p preposition, c/cc conjunction, u auxiliary/structural particle, y modal particle, e interjection, o onomatopoeia, m numeral, q measure word, qv/qt verbal/temporal measure word, mq numeral+measure, t time, f locative, s place, b distinguishing word, g/Rg morpheme, k suffix, h prefix, nr/ns/nt/nz proper nouns (person/place/org/other), vn/an/ad verbal noun/adjectival noun/adverbial adjective, l set phrase. `posSrc: "jieba"` marks the few words that have no SUBTLEX row.

## Final selection (`scripts/data/select_words.py` -> `data/selected.json`, `data/selection-log.md`)

Run: `./.venv/Scripts/python scripts/data/select_words.py`. It is deterministic: a rerun, including one from an empty `data/cache/`, gave byte-identical output. Every decision is a table in the script (DROP, SUBSTITUTE, RENAME, KEEP_NOTES, SWAP_IN, SPLIT_IN, SWAP_OUT_ORDER). `selection-log.md` is generated from those tables, so edit the script and rerun rather than editing the log.
- **Output fields:** `rank, trad, simp, cedict, moe, selectionNote?`, plus `blendRank` for traceability (`null` for split-outs). For a substitute, `blendRank` is the Taiwan word's own rank, not the rank of the slot it fills. `simp` is now OpenCC `tw2s(trad)` (影片→影片, 計畫→计划), no longer the corpus form.
- **Extended pool.** The sanity sweep needs words beyond the 1400 candidates (便宜 is at 2577, 台灣 at 4157). The script builds `data/cache/candidates-wide.json` with `build_candidates.py --top 6000 --offline` if it is missing, and checks that it extends `candidates.json` exactly.
- **Result:** 106 removals, backfilled down to blend rank 1107. There are 4 mainland→Taiwan substitutions in the same slot (哦→喔, 美元→美金, 挺→蠻, 姑娘→女生); 領導→主管 and 酒店→飯店 are defined but fall below the walk. There are 28 sanity-sweep swaps: 26 added words and 2 split-out characters. 十 and 妹妹 were reached by the backfill, so they needed no swap.
- **他/她/它 merged into 他, and 他們/她們/它們 into 他們.** They are pronounced identically, and on the audio-first Listen card the learner cannot tell them apart. The gloss for 他 should say "he/she/it (spoken)".
- **Literary and bound single characters dropped** (25 literary, 43 bound/transliteration), for example 與 之 以 於 其 此 及 則 將 已 曾 無 非 and 時 所 法 者 性 子 兒 機 國. Their spoken use is inside compounds that are in the list. This goes beyond the task's explicit categories. It was decided on the "most useful spoken words" goal, and each one is logged.
- Dropped `是的` as subtitle translationese for "Yes.", which Taiwanese say as 對/對啊/是啊. Dropped `嗯 呃 哇 哈 嘿 嗨` as noises. Dropped `一個` as compositional. Dropped reduplications (看看, 想想...), ordinals other than 第一, and the short forms 媽/爸 (媽媽/爸爸 are kept).
- **Kept despite flags:** 們 (plural marker), 很多 (no dictionary headword, but the normal spoken "a lot"), 每個 and 這次 (quantifier/demonstrative chunks), and the place names 美國, 中國, 日本 and 台灣 (台灣 was added by the sweep). 英國, 紐約 and 法國 were dropped.
- **Character forms:** 臺→台 and 臺灣→台灣 use the everyday Taiwan form; for 台, the MOE readings are taken from the 臺 entry, because MOE's 台 entry is tāi/yí. 計劃→計畫 and 身份→身分 use the MOE/Taiwan official forms. 報道→報導 and 宣佈→宣布 are defined, but both words were later displaced. 瞭解 and 秘密 were left as they are (both are common in Taiwan).
- **Split-outs:** 隻 (measure word for animals) and 麵 (noodles) had no entry of their own, because simplified 只 and 面 fold them in. Each is placed right after its source (只 at blend rank 70, 面 at 741; final ranks 69 and 681) and counts as a swap.
- **Placement of sweep additions:** they keep their own blended frequency, so they land at ranks 975–1000 and will be introduced last. The learner already knows most of them and can use "I already know this". If the app should introduce them early, a later step could move them, but that breaks strict frequency order.
- **Displaced words:** news, institutional and film-genre words from the bottom of the list: 委員會, 機構, 部門, 法官, 媒體, 執行, 宣布, 關鍵, 軍隊, 屍體, 英雄, 偉大, 導致, 實現, 不斷, 作用, 報導, 角色, 現實, 狀態, 選手, 地球, 職業, 年代, 科學, 藝術, 專家, 分析.
- **Still missing** (not in the 6000-word pool at all): 便當, 捷運, 機車, 下雨, 好喝, 渴, 冷氣, 夜市, 便利商店, 阿公/阿嬤, 不客氣, 等一下, 還好, 算了. These need a curated supplement if they are wanted.

## Enrichment chunk 14 (ranks 651-700, `data/enriched/chunk-14.json`)
- **Full tone instead of the MOE/CEDICT neutral tone, following Taiwan speech:** 上面 shàng miàn, 家裡 jiā lǐ, 早上 zǎo shàng, 力量 lì liàng. Each note gives the dictionary neutral-tone reading. 力量 and 早上 differ from *both* dictionaries (MOE and CEDICT both say lì liang / zǎo shang), so the verifiers should look at them. Words where MOE lists both readings use the full tone: 學習 xué xí, 運動 yùn dòng.
- 丈夫 is zhàng fū (MOE / Taiwan), not mainland zhàng fu. Its hint and note say that 老公 is the everyday word.
- 喂 is wèi (MOE has only wèi). The note says the mainland phone greeting is wéi and mentions the rising intonation heard in practice.
- 元 is glossed as a written/formal money unit, and its hint points to spoken kuài (塊). 米 is glossed "uncooked rice", and its note says the "meter" sense is mainland usage (Taiwan says 公尺).
- 面 (rank 680) is glossed "side; face; surface", with the measure-word use in the note. 麵 (681) is "noodles". The example for 面 shows "side" (這一面比較乾淨).
- Hints refer to alternative words by pinyin, not characters, because the learner can't read: 剛才 "a time word, not gāng gāng"; 即使 "more formal than jiù suàn"; 同樣 "more formal than yī yàng"; 再見 "standard, not casual bāi bāi"; 元 "spoken is kuài".
- pypinyin misreads 銀行 (yinxing), 乾淨 (qian) and 誰 (shui, where Taiwan says shéi). Any automated check of the example pinyin needs an override for these.

## Enrichment chunk-07 (ranks 301-350)
- **過來 guò lái**: MOE lists only guò lai (neutral), but MOE gives 起來 qǐ lái, 出來 chū lái and 進來 jìn lái with full tones, and Taiwan speech keeps the tone. I chose guò lái for consistency and noted MOE's neutral reading. **下來 xià lái**: MOE lists both xià lái and xià lai, so I took the full tone. The other directional-complement chunks should do the same (回來 is huí lai in MOE).
- **兒子 ér zǐ**: follows MOE (full 3rd tone, unlike 孩子 hái zi and 房子 fáng zi). The note mentions the mainland and casual ér zi.
- **記得 jì de**: follows MOE (neutral). **每個 měi ge**: not in MOE, so I modelled it on MOE 這個 zhè ge. 認識 is rèn shi (MOE) in the 高興 example.
- **場 chǎng**: entered as the measure word (一場電影). The note covers the Taiwan cháng in 市場/機場/現場.
- **女 nǚ**: glossed as the adjective/prefix "female; woman", with the hint "the adjective / prefix" to separate it from 女孩 "girl" (hint "a young girl") and 女生/女人. The 女孩 note says that 女生 is the everyday Taiwan word.
- **當時 dāng shí**: the hint "a specific past moment" separates it from 以前 and 那時候. The note mentions the rare dàng shí.
- **Hint overlaps to check across chunks**: 甚至 "even" (hint "going as far as") vs 連 "even" (hint "even (as in even he knows)"); 變 vs 改變 "to change" (become different / alter something); 結束 vs 完 "to finish"; 不同 "different" (hint "slightly formal") vs 不一樣; 等等 vs 等一下.
- 如此 is literary, but it is kept for 原來如此 "I see", which the example uses.
- Example sentences use full-tone 一 (yī) and 不 (bù) as citation tones. Proper nouns are capitalised in example pinyin (Zhōngguó).

## Enrichment chunk-10 (ranks 451-500)
- Example pinyin uses neutral `ge` for 個 after numerals/demonstratives (一個 yī ge, 半個 bàn ge, 四個 sì ge, 下個月 xià ge yuè, 每個 měi ge, 這個 zhège), matching MOE word entries (一個 yī ge, 半個 bàn ge). The headword 個人 stays gè rén.
- Taiwan readings chosen over CEDICT: 看來 kàn lái, 學生 xué shēng, 身上 shēn shàng, 擁有 yǒng yǒu (MOE). Each has a note that names the mainland variant.
- 除了 and 感到 have no MOE entry. Used chú le (neutral 了, as Taiwan speakers say it) and gǎn dào.
- 道 is treated as a measure word (dishes/questions: 這道菜) because standalone spoken 道 is mostly that. The road/way sense is mentioned in the note.
- 塊 gloss leads with "dollar (spoken)" because in Taiwan speech 塊 is the money unit (一百塊). 信 is glossed "letter (mail); to believe" because both are common in speech (我不信).
- 靠 note mentions 靠！ as a common mild Taiwan swear, so the learner recognises it by ear.
- 區/份/信 MOE side readings (ōu surname; bīn archaic; shēn literary) are mentioned in notes but not used.

## Enrichment chunk-12 (ranks 551-600)
- **現場 xiàn cháng** follows MOE. 機場 and 市場 are also cháng in MOE. Speech in Taiwan varies (chǎng is common), and the note says so. Other chunks containing 場 should be checked for consistency.
- **危險 wéi xiǎn** (MOE). **打算 dǎ suàn**, **剛剛 gāng gāng** and **精神 jīng shén** keep full tones, as MOE and Taiwan speech do. **房子 fáng zi** keeps MOE's neutral tone.
- **台** is glossed as the measure word for machines and vehicles (一台電腦/車), which is its most frequent spoken use. The note mentions the stage/platform sense and "Taiwan".
- **蠻 mán** follows MOE. The note mentions that many Taiwanese say mǎn (滿) for the same "quite".
- **Example pinyin uses MOE neutral tones for common words:** 這個 zhège, 一個 yī ge, 晚上 wǎnshang, 過來 guòlai and 爸爸 bàba. For 知道 it uses zhīdào, because MOE lists both and Taiwan speech uses the full tone. 誰 is shéi (MOE 語音), 喔 is ō and 消息 is xiāoxí.
- **Hints were added for near-synonym pairs**: 久 (time) vs 長; 房子 vs 家; 離 vs 從; 重新 vs 再; 終於 vs 最後; 未來 vs 將來; 害怕 vs 怕; 快樂 vs 開心/高興; 事件 vs 事情. 未來/將來 and 害怕/怕 are close enough that the English→Chinese card may still be ambiguous. They are worth checking in the hint-uniqueness pass.

## Enrichment chunk 09 (ranks 401-450, `data/enriched/chunk-09.json`)
- All 50 word readings equal an MOE reading. Where MOE has a neutral tone that Taiwanese often say with a full tone, MOE is kept and the note mentions the variation: 整個 zhěng ge (also zhěng gè), 晚上 wǎn shang (also wǎn shàng), 漂亮 piào liang (also piào liàng). Full-tone MOE readings are used over CEDICT for 任務 rèn wù and 研究 yán jiù.
- 兄弟: xiōng dì (brothers/bro) chosen over MOE's other reading xiōng di (younger brother); the note mentions it.
- In example pinyin, 個 after 這/一/兩 is written neutral (zhège, yī ge, liǎng ge) to match MOE 這個 zhè ge.
- 兄弟 example uses 姐妹 rather than the MOE form 姊妹: pypinyin only knows 姊 as zǐ, so TTS/QC might misread it, and 姐妹 is also everyday Taiwan writing. The note shows both forms.
- Hints contain no Chinese characters, because the learner can't read them on the Say card (講 hint "colloquial; very common in Taiwan", 感謝 "heartfelt or formal thanks").
- Example for 接 avoids 機場 because of the MOE 場 cháng vs. everyday chǎng question.

## Enrichment chunk 05 (ranks 201-250, `data/enriched/chunk-05.json`)
- **Neutral tones follow MOE when MOE and CEDICT agree:** 明白 míng bai, 回來 huí lai, 意思 yì si, 認識 rèn shi, 媽媽 mā ma. Each note says that many Taiwanese use a full tone (míng bái, huí lái, rèn shì). Where only CEDICT has a neutral tone, I used MOE's full tone: 關係 **guān xì**, not guān xi.
- **Polyphones, reading chosen for the main spoken meaning:** 長 **cháng** "long" (the note gives zhǎng "grow"), 種 **zhǒng** "kind" as a measure word (the note gives zhòng "to plant"), 號 **hào**, 車 **chē**, 些 **xiē**. For 過去 I chose **guò qù** ("to go over; the past", the MOE standalone reading); the note covers the light guò qu used after other verbs (走過去).
- 成為 has no MOE entry. I used chéng **wéi** (為 = "become/act as").
- 計畫 is kept as the Taiwan spelling, and the note mentions mainland 計劃.
- 很多 has pos `phrase` (很 + 多). 任何, 如何 and 怎麼樣 have pos `pron`. 之前 and 之後 have pos `noun` (locative). 第一 has pos `num`. 不能 has pos `aux`.
- Hints were added because a near-synonym is also in the list: 或 (vs 或者 at rank 251: "short form, in statements"), 幫 (vs 幫忙/幫助), 也許 (vs 可能), 明白 (vs 懂/瞭解), 之前/之後 (vs 以前/以後), 女人 (vs 女生: "adult; can sound blunt"), 媽媽 (vs 母親), 過去/回來 (vs 過來/回去), 第一 (vs 先), 長 (vs 久), 老 (vs 舊).
- Example pinyin conventions: 個 as a measure word is written `ge`, following MOE 這個 zhè ge. The structural 得 is `de`. 一下 is written with its citation tone, `yīxià`. Aspect 了 is attached to the verb (`chéngle`), and sentence-final 了 is written separately.

## Enrichment chunk 13 (ranks 601-650, `data/enriched/chunk-13.json`)
- Word pinyin follows MOE exactly, including the neutral tones MOE gives: 麻煩 má fan, 回去 huí qu, 傢伙 jiā huo, 樣子 yàng zi. Taiwan uses full tones where MOE does: 突然 tú rán and 眼睛 yǎn jīng. Where Taiwanese speech commonly differs (má fán, huí qù), the note says so. 回到, 受到 and 秘密 have no MOE entry; for 秘密, MOE's 祕密 gives mì mì.
- Example sentences also use MOE neutral tones for the other words in them: 衣服 yīfu, 漂亮 piàoliang, 鑰匙 yàoshi, 嘴巴 zuǐba. Examples avoid 一個 so that the tone of 個 (gè vs ge) does not need a decision.
- 越: glossed as the 越…越 / 越來越 construction "(the more... the more)", not as "to cross". That construction is nearly all of its spoken use.
- 副: treated as a measure word (pair or set: glasses, gloves, facial expressions), with "vice-" as the second sense. The MOE reading pì (literary) is mentioned only in the note.
- 待: the reading is dāi "to stay" (the common spoken verb); dài (等待, 對待) is in the note.
- 人民, 死亡, 許多 and 錯誤 are marked as formal or news words. Each note gives the everyday alternative (大家/民眾, 死, 很多, 錯).
- Hints were written to separate these words from listed near-synonyms: 開心/快樂/高興, 嚴重/認真, 待/留/住, 受到/收到, 意義/意思, 許多/很多, 錯誤/錯, 回去/回來, 進來/進去, 忘/忘記, 利用/用/使用, 加入/參加.

## Enrichment chunk-01 (ranks 1-50 -> `data/enriched/chunk-01.json`)
- Each entry has one reading, the one for its most common spoken use: 為 **wèi** ("for", prep); wéi appears only in compounds (認為, 成為), which are separate words. 和 **hé**: the note gives MOE's colloquial hàn and says 跟 is more common in speech. 過 **guò** (MOE): the mainland says unstressed guo for the "have ever" particle; the note says so. 個 **gè** follows MOE and CEDICT, and the note says it is usually unstressed in speech.
- I did not follow MOE's neutral tone on 知道 (MOE lists both zhī dao and zhī dào). I used **zhī dào** because Taiwanese speakers keep the 4th tone. 什麼, 我們, 他們, 這個 and 的/了/嗎/吧/著 keep the neutral tone that MOE gives.
- 這 and 那 are glossed "this"/"that", and 這個 "this; this one". Their hints are "short form" and "with a measure word", so the Say cards differ. 沒 and 沒有 have the same gloss, so their hints are "short form" and "full form". The "can" words have these hints: 會 "learned skill; likely to", 能 "able to, circumstances allow", 可以 "allowed to". 要 has "want; going to" and 想 has "would like; think; miss". Later chunks should give 跟/講/送/走/看見/看到/非常 hints that do not clash with these.
- POS labels: 上 is `noun` (a locative/place word, SUBTLEX tag f). 在, 把, 為 and 被 are `prep`. 對 is `adj` ("right/correct"); the note covers the preposition use. 過 is `particle`, because SUBTLEX's top tag is u.
- Example pinyin is checked by a scratch script. It runs a DP match of each example's pinyin against pypinyin heteronyms for every character, allowing neutral tone. It also checks that the punctuation matches. All 50 pass. Taiwan readings are used in the examples too: 誰 shéi, 時候 shíhòu, 多少 duōshǎo, 喜歡 xǐhuān, 朋友 péngyǒu.

## Enrichment chunk 02 (ranks 51-100 -> `data/enriched/chunk-02.json`)
- **但是 = dàn shì, not MOE's dàn shi.** Taiwanese speakers say the full 4th tone. The note mentions the MOE reading. This is the only pinyin in the chunk that is not an MOE reading. 覺得 jué de and 怎麼 zěn me keep MOE's neutral tone, which matches Taiwan speech.
- **時候 = shí hòu** (MOE, Taiwan). The note mentions mainland shí hou.
- **誰 = shéi** (MOE primary); shuí, the reading pronunciation, is in the note. pypinyin defaults to shuí, so a pypinyin-based checker will flag this. It is intentional.
- **多 = duō.** MOE gives duó for the 'how' sense (多好, 多高). The note says so, but most speakers say duō.
- **Polyphone readings chosen:** 得 de (structural particle; dé/děi in the note), 中 zhōng (zhòng in the note), 只 zhǐ (zhī = 隻 in the note), 更 gèng (gēng in the note), 大 dà (dài 大夫 in the note), 可 kě (kè 可汗 in the note), 呢 ne, 聽 tīng.
- **Near-synonym hints (later chunks must keep these English prompts distinct):** 但 "but" / "one syllable"; 但是 "but; however" / "two syllables, a bit firmer". **可是 needs a different hint**, e.g. "softer, very colloquial". 再 "not yet happened" vs 又 "already happened". 事 "an affair, not an object; short form" (事情 needs another hint). 裡 "one syllable, after a place or thing" (裡面 needs another). 後 "one syllable" (以後/之後 need others). 真 "one syllable, before an adjective" (真的 needs another). 可能 "also 'possible'" (也許 needs another). 跟 "everyday spoken; also 'to follow'" (和 should differ). 覺得 "an opinion or feeling" (認為/想 should differ). 走 "on foot, or to leave" (離開/去 should differ). 出 "one syllable" (出去/出來 need others).
- 中 example uses the Taiwan-typical progressive 中 (我還在考慮中), because standalone 中 is otherwise mostly literary. 而 uses 不是…而是…, its main spoken pattern.
- Examples use citation tones: 一 yī, 不 bù, 個 ge (neutral), and 這個 zhège. Sandhi (yí/yì, bú) is left to the spokenAs/merge step.

## Enrichment chunk 06 (ranks 251-300, `data/enriched/chunk-06.json`)
- **Readings where MOE lists two:** 名字 → míng zì (Taiwan everyday; MOE also gives míng zi), 男人 → nán rén (MOE also gives nán ren), 那樣 → nà yàng (MOE's nǎ yàng is the old spelling of 哪樣). Polyphones 幾 jǐ (jī in 幾乎), 內 nèi (archaic nà), 放 fàng (literary fǎng), 啦 la (lā is only onomatopoeia) and 嘛 ma (má in 幹嘛) are explained in the notes.
- **多少 duō shǎo**, not CEDICT's duō shao: Taiwan keeps the full third tone. The note says so.
- **Example-sentence tones follow MOE**, including its neutral tones: 晚上 wǎnshang, 衣服 yīfu, 認識 rènshi, 這個 zhège. 個 is written gè (MOE) and 一 is yī (citation tone).
- **Glosses are based on spoken use:** 名 is glossed as "place in a ranking; counter for people", since 第一名 is the common spoken use and the "name" sense lives in 名字. 根本 is glossed as "(not) at all", 總 as "always; eventually", and 以為 as "to think (mistakenly)".
- **Formal or mainland-leaning words carry a hint and a note pointing to the everyday Taiwan word:** 肯定 → 一定/絕對, 搞 → 弄, 人們 → 人/大家, 父親 → 爸爸, 無法 → 沒辦法, 幫助 → 幫/幫忙. The 條 note says Taiwan counts dogs with 隻, not 條.
- I wrote a checker in scratch (not committed) that confirms each example's pinyin lines up syllable by syllable with its characters, using pypinyin heteronyms plus MOE readings. All 50 entries pass.

## Enrichment chunk-08 (ranks 351-400)
- **Neutral tones follow MOE even where Taiwan speech often uses a full tone.** This matches the sibling chunks (e.g. 晚上 wǎn shang). The common full-tone variant is given in the note for 看見 kàn jian (kàn jiàn), 故事 gù shi (gù shì) and 部分 bù fen (bù fèn; CEDICT marks bù fèn as the Taiwan pronunciation). Flag for review: 部分 bù fèn may be the better Taiwan choice.
- Full tones that MOE gives and that differ from the mainland: 真是 zhēn shì, 裡面 lǐ miàn, 清楚 qīng chǔ, 消息 xiāo xí (Taiwan reads 息 as xí), 對不起 duì bu qǐ (MOE neutral 不).
- 之間 has no MOE entry. It uses zhī jiān with pos "other" (a postposed locative).
- 使 is mainly written or formal. The note points to 讓 as the spoken equivalent, and the example (這件事使他很難過) is deliberately a bit formal.
- 分: one headword covers "to divide/share" plus minute/point/cent. The pos is verb, and the note lists the other meanings and the fèn reading.
- 張 and 間 are glossed as measure words, the main spoken use. 間 is "(measure word for rooms, shops)", and "between" goes in the note.
- Example pinyin uses MOE readings where pypinyin differs: 照片 zhàopiàn (not piān), 訊息/消息 xí.
- Hints were checked against chunks 02-14 as they stood when I finished. Changes made: 為 is now "for; on behalf of" with hint "one syllable, before a person", to set it apart from 為了. 就 has hint "\"then\", links two actions", to set it apart from 馬上. 上 has hint "one syllable; also \"get on\"", to set it apart from 上面. The pairs 說/講, 和/跟, 能/可以/可/能夠 and 都/所有/全 already have distinct hints on both sides.

## Enrichment chunk 04 (ranks 151-200, `data/enriched/chunk-04.json`)
- Word readings follow MOE wherever MOE has an entry, including its full tones: 先生 xiān shēng, 朋友 péng yǒu, 事情 shì qíng, 還是 hái shì. The notes give the mainland neutral-tone forms. 謝謝 keeps MOE's neutral xiè xie; the note says many Taiwanese use two full 4th tones. 哪裡, 為了 and 這種 have no MOE entry, so I used nǎ lǐ (to match MOE 那裡 nà lǐ and chunk-01), wèi le and zhè zhǒng.
- Polyphones, with the reading for the main spoken meaning: 行 **xíng** "OK; capable" (the note gives háng, as in 銀行, and says plain "OK" in Taiwan is usually 可以/好); 正 **zhèng** (zhēng in 正月); 哪 **nǎ** (něi and particle na are in the note); 見 **jiàn** (old xiàn); 比 **bǐ**. The obscure MOE readings of 家/大家 (gū), 錯 (cù) and 那些/那裡 (nǎ, the old "which/where") are mentioned only briefly.
- "one syllable" hints separate single characters from their listed compounds, because the Say card shows only English: 家 (vs 家裡/家庭/家人), 開 (vs 打開), 起 (vs 起來/起床), 回 (vs 回來/回去/回到), 錯 (vs 錯誤/不對). 事情 has the hint "a matter, not an object; full form" (rank 60 事 has "...; short form"). 不要 has "two syllables; also 'not want'" (vs 別). 為了 has "purpose: in order to", so it doesn't clash with 為 "for the sake of".
- 先生 is glossed "Mr.; sir; husband", and its example is 我先生 "my husband", which is the most common use in Taiwan family speech. Hint overlaps that the verifiers should check: 一定 "for sure; be sure to" vs 肯定; 非常 "stronger than plain 'very'" vs 很/十分; 一切 vs 全部/所有; 其他 vs 別的/另外; 向 vs 往 (向 is glossed "towards; to (someone)", with the hint "slightly formal").
- Example pinyin uses MOE neutral tones for embedded words (哥哥 gēge, 謝謝 xièxie, 便宜 piányi, 對不起 duìbuqǐ, 一個 yī ge). It uses the citation 一 yī and 不 bù, and capitalises proper nouns (Měiguó, Rìběn, Táiběi). 睡不著 is written shuìbùzháo (著 zháo). Sentence-final 喔 is written `o` (as chunk-01 does). Chunk-03 writes it `ō`, so the merge step should pick one.
- 殺 example: 我不敢殺魚 (cooking context) avoids crime/film violence. The note mentions the everyday Taiwan 殺價 "to haggle".

## Enrichment chunk-11 (ranks 501-550)
- **倒 → dào** ("to pour; to dump out"). This is the reading in 倒水, 倒垃圾 (a very common Taiwan chore) and the adverb 倒是. The note gives dǎo "to fall over" with 跌倒 **dié** dǎo (MOE/Taiwan reading of 跌). Since one entry covers both readings, the choice could go either way.
- **下去 → xià qu** follows MOE's neutral tone. The note says Taiwanese often say full-tone xià qù, especially for "go down". If other chunks give 起來/出來/回來 full tones, these should be made consistent.
- **衣服 yī fu** and **妻子 qī zi** follow MOE's neutral tone, and both notes mention variants. **小姐 xiǎo jiě** and **比較 bǐ jiào** use the Taiwan full tone, with the mainland form in the note.
- **包括 bāo kuò** follows the MOE word entry. The note says many Taiwanese say bāo guā, which is MOE's main reading of 括 alone (括號 guā hào).
- **約** is glossed as the spoken verb "to make plans (to meet)" before "about" (approximately). CEDICT's yāo reading is not in MOE and is ignored.
- **部** is given pos `measure` (movies, phones, vehicles: 一部電影), with "part" second.
- **從來** is glossed "never (with negative); always", because it is almost always used with 不/沒.
- **Hints chosen to separate near-synonyms elsewhere in the list:**
  - 不管 "casual" vs 無論
  - 因此 "formal" vs 所以
  - 抱歉 "polite, a bit formal" vs 對不起/不好意思
  - 妻子 "formal" vs 老婆
  - 獲得 "formal" vs 得到
  - 簡單 "not complicated" vs 容易 "not difficult"
  - 懂 "get the meaning" vs 明白/瞭解
  - 聽說 "secondhand news" vs 聽到 "with your ears"
  - 目前 "for the time being" vs 現在
  - 睡 "one-syllable verb" vs 睡覺
  - 換 "swap for another" vs 變
  - 記錄 "keep a written record" vs 記
  - The hint pairs only work if the agents writing 無論/所以/對不起/老婆/得到/明白/現在/睡覺/變 use complementary hints.
- 記錄: the note says Taiwan usually writes the noun as 紀錄 (same sound).

## Enrichment chunk-03 (ranks 101-150)
- **MOE neutral tones followed where MOE splits by meaning.** For 告訴 "tell", MOE's reading is gào su (gào sù is the legal "file a complaint"). For 東西 "thing", it is dōng xi (dōng xī is "east and west"). I used the MOE reading and noted that many Taiwanese say gào sù and dōng xī. This should be applied consistently across chunks.
- **地方 is dì fāng, not dì fang.** In MOE, dì fāng is "place, region"; dì fang is an obsolete word for a local constable. So the full tone is both MOE and Taiwan usage.
- **們 is men.** MOE lists men as the 語音 reading and mén as the reading form. Speech always uses men.
- **地 is dì ("ground, floor"), not the particle de.** In speech the adverbial particle de sounds the same as 的, which is already in the list, so an audio card for de would teach nothing. dì is a real spoken word (地上). The note mentions de.
- **喔 is ō (MOE 歎 reading, "oh, I see").** The very Taiwanese sentence-final 喔 (light o, as in 小心喔) is covered in the note. A single neutral-tone syllable also works poorly for isolated TTS and pitch QC.
- **幹 is gàn "to do".** The note warns that 幹！ alone is a strong Taiwan swear word. The example uses 幹嘛 (gànmá). MOE spells this word 幹麼 gàn má, but 幹嘛 is the everyday Taiwan spelling.
- **Polyphone notes cover only readings a learner will meet:** 當 dàng, 地 de, 還 huán, 為 wèi, 打 dá, and 吃 jí in 口吃. Rare MOE-only readings are not mentioned: 並 bàng, 次 zī, 錢 jiǎn, 三 sā/sàn, 幹 hán, 請 qīng/qíng.
- **該 vs 應該:** both mean "should". The glosses differ ("it's time to; should; (one's) turn" vs "should; ought to; probably"). The hints are "one syllable" and "two syllables".
- **個 avoided in examples where possible.** MOE has both ge (light) and gè, and the other chunks may choose differently. It remains only inside 這個/那個 (MOE zhè ge / nà ge).

## Enrichment chunk-15 (ranks 701-750, `data/enriched/chunk-15.json`)
- **Full tone where MOE has a neutral one:** 留下 liú xià (MOE liú xia), following the chunk-07 rule for directional complements. 實在 shí zài: MOE lists both shí zai and shí zài, and I took the full tone. Each note gives the MOE neutral form.
- **Taiwan readings that differ from the mainland/CEDICT:** 意識 yì shì (CEDICT yì shí) and 參與 cān yù. 幾乎 jī hū follows MOE; the note says some speakers say jǐ hū.
- **片** is entered as piàn (measure word for flat things). MOE's piān reading is mentioned in the note as rare in Taiwan.
- **Not in MOE as headwords:** 事實上, 收到, 可愛, 實際上 and 那種. Their readings are made from the parts (事實 shì shí, 實際 shí jì, 上 shàng, 種 zhǒng).
- **Separating near-synonyms:** 事實上 "in fact; as a matter of fact" (hint "formal, stating the real facts") vs 實際上 "in reality; in practice" (hint "how things really are"). Both notes point to the everyday 其實. 最終 has the hint "more formal than zuì hòu" (against 最後). 的確 has the hint "agreeing that something is true" (against 確實, whose hint is "confirming something is true"; the verifiers should check that pair). 參與 has "more formal than cān jiā". 由於 has "formal, not yīn wèi". 正確 has "more formal than duì".
- pypinyin false alarms on the chunk-15 examples: 音樂 (lè), 參與 (yǔ), 的確 (de), 待 (dài; it means dāi, 'to stay', here), 突然 (tū), 意識 (shí). The MOE readings are correct.

## Enrichment chunk 16 (ranks 751-800, `data/enriched/chunk-16.json`)
- All readings are MOE readings except 來到 lái dào, which has no MOE entry. Taiwan full tones are used where MOE gives them: 後面 hòu miàn, 位置 wèi zhì (both differ from CEDICT's neutral tone). **攻擊 gōng jí** and **一會 yī huǐ** follow MOE. Each note names the mainland form (gōng jī; yí huìr).
- 照顧: MOE lists both zhào gu and zhào gù. **zhào gù** is used because Taiwan speech uses it, as with 知道 and 學習. 自然: **zì rán** (MOE also has zì ran for "unforced"). The example avoids the 自然一點 sense.
- 卡: **kǎ** "card" is the main reading. The note says Taiwanese also say kǎ for "stuck" (卡住, 電腦很卡), although MOE has qiǎ for that sense. 假: **jiǎ** "fake". jià (放假, 請假) and 真的假的 are in the note.
- 光 is glossed "light; used up; only". The example uses the light sense. The note covers 花光了 and 光說不做. The hint "brightness, not weight" separates it from 輕.
- 項目: the note says that in Taiwan "project" is usually 專案 or 計畫, and 項目 means item or sports event.
- 口: glossed "mouth; a bite (of food); opening", with the hint "a mouthful, or an opening" to separate it from 嘴 (rank 641, "mouth", no hint). The example uses 吃一口.
- 輛 hint "vehicles only" vs 台 (machines and vehicles). Formality hints separate near-synonyms: 似乎 vs 好像, 仍然 vs 還, 無論 vs 不管, 否則 (vs 不然), 相當 vs 很/蠻, 儘管 vs 雖然, 各位 vs 大家, 汽車 vs 車, 記 vs 記得, 真實 vs 真的/真正, 理由 vs 原因, 顯然 vs 明顯, 瘋 vs 瘋狂.
- Example pinyin follows earlier chunks: 這個 zhège, 名字 míngzì, 故事 gùshi, 東西 dōngxi, 休息 xiūxí, 喜歡 xǐhuān, 個 → ge. 一 and 不 are written in citation form.

## Enrichment chunk 19 (ranks 901-950, `data/enriched/chunk-19.json`)
- 48 of 50 headword readings match an MOE reading. Taiwan full tones are used where MOE has them and CEDICT is neutral: 休息 xiū xí, 聰明 cōng míng and 星期 xīng qí. The notes give the mainland form. 方向 is fāng xiàng (MOE lists both readings). 日子 rì zi and 困難 kùn nan follow MOE's neutral tone, and the notes say many Taiwanese use a full tone.
- **多麼 duō me, not MOE's duó me.** This matches the rank-63 decision for 多, whose note says MOE gives duó for the 'how' sense but most speakers say duō. Verifiers should check this.
- 越來越 has no MOE entry, so it is yuè lái yuè. Its example differs from the one already used for 越 (rank 601).
- **Polyphones:** 藏 is cáng; the note gives zàng. 目的 is mù dì; the note says it is not de. 到處 is chù; the note gives 處理 chǔ. MOE's rare readings 紅 gōng and 票 piāo are mentioned only in the notes.
- 氣 is glossed with its main spoken sense, "to make angry; anger", ahead of "air", because 氣死了 / 把我氣死了 is the common standalone use.
- **Hints separate these from listed near-synonyms:** 類 (vs 種), 樓 (vs 地 "floor"), 收 (vs 收到/接受), 邀請 (vs 請), 感受 (vs 感覺/覺得/感到), 日子 (vs 天/生活), 受傷 (vs 傷/傷害), 通常 (vs 一般/經常), 戴 (vs 穿), 家人 (vs 家/家庭), 條件 (vs 要求, and situation words), 目的 (vs 目標), 一旦 (vs 如果/只要), 多麼 (vs 多/怎麼), 困難 (vs 難), 管理 (vs 管), 免費 (vs 自由), 越來越 (vs 越), 美麗 (vs 美/漂亮), 女生 (vs 女孩/女人/小姐), 可怕 (vs 恐怖/害怕), 腿 (vs 腳), 某 (vs 有些/一些), 經驗 (vs 經歷), 十分 (vs 很/非常), 不對 (vs 錯).
- **Example pinyin conventions from earlier chunks are kept:** neutral `ge` after numerals and demonstratives (一個 yī ge, 某個 mǒu ge, 是個 shì ge, 那個 nàge), 誰 shéi, 認識 rènshi, citation 一 yī and 不 bù, 家裡 jiālǐ (chunk 14), and 地方 dìfāng (MOE lists both readings).
- pypinyin output differs from the example pinyin only at these intended points.

## Enrichment chunk 17 (ranks 801-850, `data/enriched/chunk-17.json`)
- **Readings follow MOE where MOE has an entry**, including its neutral tones. 老婆 is **lǎo po** and 值得 is **zhí de**; each note says many Taiwanese say lǎo pó / zhí dé.
- **血 is xiě**, MOE's main reading and the one Taiwan uses (流血 liú xiě). The note mentions xuè, which is literary in Taiwan and the mainland standard. CEDICT and pypinyin both give xuè, so automated QC will flag 血 and needs to accept xiě.
- 那邊 and 再次 have no MOE entry. I used **nà biān**, the Taiwan full tone (CEDICT has nà bian), and zài cì.
- **數 is shǔ "to count"**: as a standalone word in speech it is nearly always the verb, and "number" is usually 數字. The note gives shù. pypinyin gives shù for 數到, so QC needs to accept shǔ.
- **Glosses and pos follow Taiwan usage**:
  - 超 is an adverb, "super; really (casual)", because Taiwan slang 超好吃 is its dominant spoken use. The note covers the verb sense "to exceed".
  - 影片 is "video", the Taiwan word (mainland 視頻).
  - 專業 is "professional; expertise". In Taiwan a college major is 科系/主修.
  - 文件 is "documents; papers". In Taiwan a computer file is 檔案.
- **聲, 句, 群, 雙 are pos `measure`.** 聲 is glossed with its measure-word use 說一聲 "let someone know", and its hint sets it apart from 聲音.
- **Hints keep near-synonyms apart:**
  - 遇到 vs 見到
  - 阻止 vs 停止 vs 停
  - 女性 vs 女人/女生/女孩
  - 幫忙 vs 幫/幫助
  - 老婆 vs 妻子
  - 那邊 vs 那裡
  - 下面 vs 上面/下
  - 顯示 vs 表示
  - 怪 vs 奇怪
  - 再次 vs 再/又
  - 影片 vs 電影
  - 認真 vs 嚴重
  - 腳 vs 腿
  - 字 vs 詞
  - 忘記 vs 忘
  - 超 vs 很/非常/真
  - 文件 vs 資料
  - 雙 vs 對

  忘/忘記 and 停/停止 mean nearly the same thing, so the English→Chinese card relies on the hint alone.
- **Example 字 uses 唸 niàn**, the Taiwan form, not 念.

## Enrichment chunk 20 (ranks 951-1000, `data/enriched/chunk-20.json`)
- Every word reading matches an MOE reading except **耶**, which is given as neutral **ye**. MOE lists only yē (used for sound loans like 耶誕) and yé (a classical question particle); it has no entry for the modern Taiwan particle in 好好吃耶. Neutral ye follows CEDICT and the treatment of 吧/啦/嘛. The note says it is often said with a high, level pitch. Flagged for audio QC: an isolated TTS clip may come out as yē.
- **Neutral tones follow MOE:** 沒關係 méi guān xi (although 關係 alone is guān xì, rank 240), 舒服 shū fu, 妹妹/姐姐/弟弟 with a light second syllable, and 便宜 pián yi. Each note mentions the full-tone Taiwan variant where it is common. **老公 lǎo gōng** is the MOE reading for "husband". The note mentions lǎo gong (eunuch).
- In example pinyin, **老婆 is written lǎopo** (MOE neutral), to stay consistent with the 東西 dōngxi convention, even though Taiwanese often say lǎo pó. Check this against 老婆's own entry in its chunk.
- **不會** is glossed "won't; can't; no problem" because it is the standard Taiwan reply to 謝謝 (in the note). The example uses the "won't" sense. **就要** is pos adv and is taught through the 就要…了 pattern.
- **Hints separate near-synonyms elsewhere in the list:** 足夠 vs 夠, 更加 vs 更, 恐怖 vs 可怕, 動作 vs 行動/動, 吃飯 vs 吃, 你好 vs 喂, 老公 vs 丈夫/先生, 不好意思 vs 對不起/抱歉, 隨便 vs 任何, 飯 vs 米, 食物.
- 台灣 pinyin is lowercase tái wān, per the rule, and is capitalized only in example pinyin. 姐姐 keeps the 姐 spelling from the selection; the note mentions the common Taiwan written form 姊姊.

## Enrichment chunk 18 (ranks 851-900, `data/enriched/chunk-18.json`)
- Every headword reading matches an MOE reading, except 而是, 哪個 and 男孩, which have no MOE entry. 哪個 **nǎ ge** follows MOE 那個 nǎ ge (MOE's old spelling of 哪個) and 這個 zhè ge. Its note mentions the colloquial něi ge.
- **市場 shì cháng** follows MOE, consistent with 現場/機場 in chunk 12. The note says that many Taiwanese say shì chǎng.
- **差 chà** ("poor; bad; short of"), the MOE reading for 不好/欠缺. CEDICT gives "Taiwan pr. cha1" for this sense, but MOE has chà, and chà is the usual speech. The note covers chā (差別) and chāi (出差).
- **盡 jìn**: the example uses 盡力 jìn lì. The note covers 盡量 jìn liàng vs 儘量 jǐn liàng. pypinyin misreads 盡力 as jǐn lì and 睡覺 as shuì jué, so automated checks need overrides for both.
- **反** is glossed as the adjective "reversed; opposite" (穿反了 "on inside out"), because that is the most common stand-alone spoken use. MOE's fān and fàn readings are only mentioned in the note.
- **身分** keeps the Taiwan/MOE spelling (mainland 身份). The example uses 身分證 "ID card", the most common spoken context.
- **以來** has pos `noun`, consistent with 之前/之後/以前/以後.
- 傷 is glossed "injury; wound" (not "to hurt"), so that it does not collide with 傷害 "to hurt; to harm" (642).
- Example pinyin follows the MOE neutral tones used in earlier chunks: 熱鬧 rènao, 晚上 wǎnshang, 衣服 yīfu, 鏡子 jìngzi, 哪個/這個/那個 -ge, 消息 xiāoxí. 突然 is túrán.

## chunk 10 review (ranks 451-500)
- I applied all 9 reviewer findings to `data/enriched/chunk-10.json`. Two were only partly applied:
  - **生 (461)**: I dropped "life" (that meaning belongs to 生命/生活) but rejected the suggested addition "to get (sick)". It would point English→Chinese cards to 生病. The gloss is now "to give birth; raw".
  - **選 (470)** and **資訊 (472)**: I reworded the suggested hints. The 選 hint is "choose among options; also elections", and its note now contrasts 挑 tiāo. The 資訊 hint drops "also IT" because the gloss already says IT. The note now contrasts 資料 zī liào.
- **看來 (467)**: I removed the note's claim that the mainland says kàn lai. 現代漢語詞典 gives kànlái, and only CEDICT has the neutral tone. The note is now a usage note.
- **Example pinyin word-joining**: 男朋友 → nánpéngyǒu, 市中心 → shìzhōngxīn (lexicalized words; jieba also keeps them as one word). Other chunks write 好朋友 as "hǎo péngyǒu", which is fine as a free phrase, but a final consistency pass may want one convention.
- **Native check**: 選 vs 挑 overlap heavily in everyday Taiwan speech ("你挑一個" / "你選一個"). Check whether the hint is enough to tell them apart.

## chunk 07 review

- Accepted: 場 changed to **cháng**. MOE puts the measure-word sense, "量詞。計算活動的單位", only under cháng. The chǎng reading is the 語音 for the other senses. This matches 市場/機場/現場 cháng in chunks 12 and 18. It replaces the earlier "場 chǎng" bullet above. Also accepted: 過來 changed to **guò lai** (MOE), which matches the sibling headwords 回來 huí lai and 下去 xià qu. The note says many Taiwanese say a full-tone lái. Chunk 12's example (guòlai) is now consistent. The 受不了 example pinyin is now shòubuliǎo (MOE neutral 不). Gloss and hint changes were accepted for 受, 確定, 等等 (adds the Taiwan meaning "in a bit, later"), 要求, 以後, 高興 and 選擇. The 心 example was changed to 我的心好痛。 The 吃完 example pinyin is now chīwán (one-syllable verb + complement joined, as in the pinyin orthography rules).
- Rejected: adding spokenAs to 等等 (déng děng). The merge script computes spokenAs from the tones, and 3+3 sandhi can be derived automatically, so chunk files do not set it.
- Rejected: changing 改變's 不能 to "bùnéng". The pinyin orthography rules write 不 separately before verbs, and the dataset already uses "bù néng" everywhere, including the 不能 headword's own example in chunk 05.
- Native-speaker check: is 一場電影 cháng or chǎng in your wife's everyday speech? Is 你過來 said guò lai or guò lái? Spacing of V+完 is still mixed across chunks (kàn wán, chī wán in chunks 06 and 13; zuòwán, pǎowán elsewhere). The pinyin is display-only, so this only matters for consistency.

## chunk 14 review
- **Accepted:** every other finding. Changes made: 早上 → zǎo shang and 力量 → lì liang, the MOE reading (MOE and CEDICT agree; this matches 晚上 wǎn shang and the "follow MOE when MOE and CEDICT agree" rule), with notes saying many Taiwanese use the full tone. Example pinyin now follows MOE neutral tones: wǎnshang, zǎoshang, dìshang, chuānghu, lìliang. Reduplicated verbs are written with a light second syllable, as MOE writes 試試看 shì shi kàn and 看看 kàn kan: shìshi kàn, cāicai kàn, wènwen, tīngting. New examples for 學習 (我還在學習。), 意見 (我想聽聽你的意見。) and 屬於 (這不屬於我的工作範圍。). The old 屬於 example's dōngxī is gone with it. Gloss, hint, note and English fixes for 面, 早上, 力量, 讀 (念 niàn), 打開, 別的, 神, 明顯, 集, 猜 and 喂.
- **Rejected, partly (finding "上面 / 力量 / 家裡 / 早上"):** 上面 stays **shàng miàn** and 家裡 stays **jiā lǐ**. In both cases only MOE has the neutral tone; CEDICT gives the full tone. MOE's own siblings also use full tones: 下面 xià miàn, 裡面 lǐ miàn, 後面 hòu miàn, 外面 wài miàn, 這裡 zhè lǐ, 裡 lǐ. A neutral 上面 next to 下面 xià miàn (chunk 17) would look inconsistent. Chunks 13 and 19 also already write jiālǐ in their examples. The notes still give MOE's shàng mian / jiā li. Proposed project rule for DECISIONS.md: follow MOE neutral tones unless CEDICT has the full tone *and* MOE's own parallel words do too.
- **Native-speaker check:** 力量 lì liang vs lì liàng and 早上 zǎo shang vs zǎo shàng. Both are switched to MOE for consistency, but the full tone may be the more common Taiwan pronunciation. If the orchestrator decides on full tones project-wide, 晚上 (rank 404) and the wǎnshang / zǎoshang example spellings in other chunks need to change with them.
- **Cross-chunk follow-ups (not edited here):** chunk 06, rank 254, still writes dōngxī in an example; it should be dōngxi. One other chunk writes kànkan, which matches the reduplication convention above.

## chunk 09 review (ranks 401-450)
- I checked the findings against the MOE revised dictionary (`data/cache/moedict`). I accepted 10 of the 11 findings in `data/enriched/chunk-09.json`:
  - **確實 (428)**: new example 他確實很努力。 The old one, 你說的確實沒錯, contained 的確 dí què, which TTS could misread.
  - **兄弟 (448)**: new example 他們兩個是兄弟。, which shows the word itself rather than 兄弟姐妹.
  - **大學 (411)**: note fixed. MOE's tài xué is the ancient academy (太學); the book 《大學》 is dà xué.
  - **弄 (437)**: note now says that addresses are commonly read nòng in speech, although MOE reads 巷弄 as lòng.
  - **對於 (413)**: gloss is now "regarding; with regard to" ("as for" is 至於).
  - **歡迎 (420)**: the example's English now says "welcome".
  - **Hints sharpened** for 講 (vs 說), 漂亮 (vs 美), 保證 (vs plain agreeing) and 學 (vs 學習). Each uses the existing "not <pinyin>" hint style. 答應 is not in the 1000, so the 保證 hint does not name it.
- **Rejected: 感謝 (444), 真的 spacing.** I kept "Zhēn de" for now. Across chunks the usage is split 5/5 between "zhēnde" and "zhēn de", so the merge/consistency pass should pick one convention globally rather than this chunk alone.
- **Native check:** confirm that Taiwanese read 弄 in addresses as nòng (my belief: yes, overwhelmingly). Also check that 漂亮 vs 美 is distinguishable from the hints alone.

## chunk 13 review (ranks 601-650)
- **Accepted:** 告訴 → gàosu in the 直到 example (matches headword 118). 要不要 → yào bù yào. Verb-object and verb-complement joins in non-headword phrases: chīwán, fùqián, kāimén. xǐ liǎn and dǎ qiú stay split so the headword shows. 一般 was re-glossed "ordinary; so-so; general" with the new example 這家店的東西很一般 (dōngxi, MOE neutral tone, not the reviewer's dōngxī), and its note points "usually" to 通常/平常. 按 is now "to press" (hint "with a finger, like a button"). 忘 hint is "one syllable". 受到 is "to be affected by; to receive" (hint "two syllables, before abstract nouns"). 直到 got a hint. 嘴 got the hint "the body part" and the example 他的嘴很甜, which uses bare 嘴. 越 example is now 雨越下越大了. The 黑 hint was dropped and the note mentions MOE literary hè. The 這次 note now says zhèi is also heard in casual speech. 不再 example is now 他不再是小孩子了. The 設計 English was fixed. "Also written 家伙" was removed from 傢伙.
- **Rejected: 回去 → huí qù.** MOE and CEDICT both give huí qu. That matches the chunk-07 review decision, which moved 過來 to guò lai to match 回來 huí lai and 下去 xià qu. The reviewer's claim that 過來 is guò lái is out of date. 出去/過去/進去 have full tones because MOE gives them full tones, so the set follows MOE consistently. The note already says Taiwanese often say huí qù.
- **Rejected, deferred to merge: attaching aspect 了 (wàngle).** The deck mostly writes aspect 了 as a separate word: about 45 examples, against about 8 attached ones in chunks 05, 17, 18 and 19 (chéngle, jùjuéle, mǎile, wàngle, jiùle, dàole). The chunk-01 notes said the convention was to attach it, but that is not what the chunks do. I kept "wàng le" to match the majority. If the orchestrator wants one convention, normalize all chunks in a single pass at merge.
- **Rejected (no chunk change): spokenAs for 一般/不再.** Per the chunk-07 decision, the merge script computes spokenAs. The merge script must apply 一 sandhi (yì before tones 1/2/3, yí before 4) and 不 sandhi (bú before 4), or these hints will be missing.
- **Native check:** does your wife say 我一般七點起床 at all, or always 通常/平常? Is 他的嘴很甜 a good everyday example for 嘴, or would 嘴巴 be heard far more?

## chunk 05 review (ranks 201-250)
- **Accepted, with some rewording**:
  - 意思 note: now says MOE has a light *si* and many Taiwanese say a full-tone yì sī. Both reviewers caught the self-contradiction.
  - Hints: 也許 "soft guess; adverb only, not formal", 明白 "see clearly; it's clear to me", 計畫 "a plan; verb use is formal", 幫 "everyday; do something for someone", 之前/之後 "before/after a point in time".
  - 成: gloss "to become; into (after a verb)". New example 幫我把蘋果切成兩半。 replaces the suggested 請換成中文, which sounded stiff.
  - 成為: hint and note now point to 當 for jobs. New example 我們後來成為好朋友。 This is a very natural Taiwan use and avoids the abstract "better person".
  - 最後: gloss "last; in the end". pos changed adj→adv to match the example. The note contrasts it with 終於.
  - 些: gloss "some (plural measure word)", hint "only after this, that, one". The note mentions the rare suò reading.
  - 認識: gloss "to know; to get to know".
  - 任何: gloss "any", with the new hint "any at all, before a noun".
  - 老: note now covers 舊, the prefix and 老是 "always".
  - 玩: the English translation now has "for fun", and the note mentions the wàn reading (古玩).
  - 車: example changed to 我們開車去吧。 because 坐車 in Taiwan is generic "take a vehicle".
- **Rejected**:
  - **回來 → huí lái**: the finding was based on an outdated chunk 07 state. The chunk 07 review changed 過來 back to MOE guò lai, which matches 回來 huí lai, 回去 huí qu and 下去 xià qu. MOE and CEDICT both give huí lai, and the project rule is to follow MOE neutral tones when MOE and CEDICT agree. 起來/出來/進來 have full lái because MOE gives them full tones.
  - **明白 → míng bái**: the finding misreads chunk 14. Its review switched 早上/力量 *to* MOE neutral tones; 上面 kept its full tone only because CEDICT and MOE's own sibling words have it. 明白/認識/意思 (MOE and CEDICT both neutral) follow that same rule.
- **Cross-chunk follow-ups (not edited)**:
  - The example pinyin for 回來 is inconsistent: chunk 02 (時候) writes huílái, which should be huílai.
  - 或許 (471) still has the hint "a bit formal". It is fine next to 也許's new hint, but "more formal, written-sounding" would be clearer.
- **Native check**: does she say huí lai / guò lai, or full-tone lái, when it is the main verb (你幾點回來？)? The same question applies to míng bai / rèn shi / yì si.

## chunk 08 review
- **Accepted: 部分 → bù fèn** (all three findings). MOE's own headword 大部分 is dà bù fèn, and CEDICT marks "Taiwan pr. bu4fen4". That meets the chunk-14 rule (CEDICT full tone *and* MOE's parallel word full tone). This replaces the "部分 bù fen" flag in the chunk 06–08 enrichment bullet above. The note now names MOE's bù fen as the headword/mainland reading, and the example pinyin is Dà bùfèn. 分 (371) now writes "部分 bù fèn", so the two entries agree.
- **Accepted:** 難 note ('hard to…' is the general pre-verb meaning; 難吃/難看 'unpleasant'), 表現 pos verb with gloss "to perform (well/badly); performance", 到底 English "So are you going or not?", 其中 gloss "among them; of which" + hint + three-kids example.
- **Partly accepted:** 看見 hint is now "catch sight of (not kàn dào)". I kept the pinyin reference, since the point is to steer English→Chinese answers away from 看到. 好像 gloss is now "seems; as if". I dropped the suggested "apparently" because it overlaps with 聽說/顯然.
- No findings rejected outright. Native check: the 看見 and 看到 (chunk 03) examples are both "Have you seen my phone?". That's fine because they are near-synonyms, but one could be varied. Is 部分 ever bù fen in your wife's speech?

## chunk 15 review
- All 11 findings were accepted, some with changes:
  - 留下: the new example is 他留下一封信就走了。, so it no longer repeats 留's sentence. The English is "went away" instead of the suggested "then left", which said "left" twice.
  - 事實上 / 實際上: did not use the "lit. 'as a matter of fact'" hint, because it repeats the gloss. The hints are now "formal; the facts are, contrary to belief" and "formal; as opposed to in theory". Both keep "formal" so they are distinct from 其實. 實際上's gloss now leads with "in practice".
  - 組: added 吧 (我們分成兩組吧。) so the sentence matches "Let's split into two groups."
  - 夢: used the reviewer's stated reasoning, not its suggested fix: 我昨天晚上做了一個很奇怪的夢。 晚上 is wǎnshang, per MOE and the other chunks.
  - 收到: 訊息 is xùn xí (Taiwan reading of 息), matching chunk 08.
- **Native check**: is 有意思 really less common than 有趣 / 好玩 in her speech? The 有趣 note now says it sounds more mainland.

## chunk 06 review
- **Accepted (checked against MOE in `data/cache/moedict`):** 名字 is now **míng zi**. MOE's míng zì is the classical "名與字號". The note says many Taiwanese say míng zì, and chunk-16's 記 example is now míngzi too. 東西 in the 放 example is now dōngxi. 個 in examples is now neutral **ge**: jǐ ge, yī ge, xià ge yuè, which follows MOE 一個 yī ge and 幾個 jǐ ge. This **supersedes the chunk 06 bullet above that says "個 is written gè"**. The 男人 note now says that MOE's nán ren means "husband". 第二 is now dì'èr, matching dìyī. 看完 is now kànwán. Gloss, hint, note and English fixes were made for 搞, 肯定, 結果, 通過 (Taiwan says 透過 for "by means of"), 啦 (啦啦隊 lā lā duì, MOE), 不錯, 機會, 人們 and 幫助.
- **Partly accepted:** 幫助's hint is "formal; also \"be helpful\"" and does not use the suggested "(有幫助)", because showing Chinese in a hint would give the answer away on the English→Chinese card. The 有幫助 pattern is in the note instead. 肯定's hint is "confident claim, mainland-leaning" and does not name 一定, for the same reason. The gloss lost "for sure", which collided with 一定's hint. 結果 keeps pos noun. The note says it mostly works as a clause-initial connector.
- **Rejected: adding spokenAs to 瞭解, 只有 and 不錯.** This follows the chunk 07 decision that the merge step derives spokenAs and chunk files do not set it. **However, no merge script exists yet**, and `scripts/audio/qc.py` and `generate.py` read `spokenAs`. The merge step must compute it for 3+3 (瞭解 liáo jiě, 只有 zhí yǒu), 不 before a 4th tone (不錯 bú cuò) and 一 sandhi.
- **Cross-chunk follow-ups (not edited):** chunk-18 still writes gè after numbers in examples. Ordinals are still mixed: chunk-05 has "dì yī" and "dìyī", chunk-11 has "dì yī míng", and this chunk now has dìyī / dì'èr. The GB/T 16159 form is dì-yī. A final pass should pick one form.
- **Native check:** 名字 míng zi or míng zì in your wife's speech? (I believe full-tone míng zì is very common in Taiwan.) Does 搞 sound natural to her in 你到底在搞什麼？, or would she say 幹嘛 / 在做什麼?

## chunk 11 review (ranks 501-550)
- **Accepted** (in `data/enriched/chunk-11.json`): experiential 過 joined to the verb (zhùguò, kànguò); dìyī míng; bùjiàn le / bùxíng joined to match ranks 166 and 713 (both are MOE headwords with a lexicalized meaning, unlike the free 不 + verb in "bù néng"); 下去 hint "down and away; or continue"; 部 is now taught as the measure word for films and series, and its note says Taiwan prefers 一台車 / 一支手機; new 人類 example 狗是人類最好的朋友。; new 根據 example with 氣象預報; 約 gloss now leaves out "about"; 獲得 gloss is "to obtain; to receive (an award)"; 聽到 hint now marks the result; the 壞 note mentions MOE guài; the 衣服 English says "top".
- **Partly accepted: 從來 (527).** The gloss is "never (with 不/沒)" with hint "never once, up to now". I dropped the suggested "; ever" because it collides with 曾經 (507, "once; at one time; ever"). The note says the affirmative sense is bookish.
- **Reworded: 懂 (524).** The hint is "one syllable; grasp what's said or read". The suggested "comprehend speech or text, one syllable" was close; I shortened it.
- **Rejected: 下去 → xià qù (Option B).** MOE gives only xià qu, and the chunk 07 review already chose Option A (過來 → guò lai). 下來 xià lái is not inconsistent: MOE gives xià lái for the directional sense ("自上而下"), and xià lai only for the "gradually / end of a period" senses. The note still mentions the Taiwan full-tone xià qù.
- **Rejected: adding spokenAs to 有點 / 小姐.** Chunk files never set spokenAs (same decision as chunk 07). **The merge script must derive the 3+3 sandhi forms**: 有點 → yóu diǎn, 小姐 → xiáo jiě.
- **Cross-chunk follow-up (not my chunk):** rank 574 (chunk 12) still writes "tí guò". It should be "tíguò" to match the 過 convention.
- **Native check:** does your wife say 一部車 or 一台車, and 一支手機 or 一部手機? Is 下去 xià qu or xià qù in 這樣下去不行?

## chunk 04 review (ranks 151-200)
- **Accepted:**
  - 卻 example: shuìbùzháo → shuìbuzháo. The neutral bu matches MOE (睡不著 shuì bu zhāo, 受不了 shòu bu liǎo, 對不起 duì bu qǐ) and chunk-07 shòubuliǎo. I kept zháo, which matches MOE 睡著 shuì zháo and everyday Taiwan speech, rather than MOE's zhāo for this compound.
  - Hints: 向 "toward someone; slightly formal" (vs 往), 不過 "mild 'but'; also 'only'" (vs 可是), 正 "one syllable; right then, just about to" (vs 正在), 相信 "believe a person or what they say", 大家 "all of us / you all, as a group" (vs 所有).
  - 一些: new hint "an unspecified amount of something". I did not use the suggested "after a verb", because 一些人… also starts clauses. The note now contrasts it with 有些 and 幾.
  - 一點 note: added "一 is spoken yì here." 當然 English: "Sure, of course!"
- **Rejected:**
  - **spokenAs on 9 entries:** per the chunk-07 decision, the merge script computes spokenAs and chunk files do not set it. No merge script exists yet in scripts/data. It must apply 一 sandhi (yì before tones 1/2/3, yí before 4) and 不 sandhi (bú before 4), plus 3+3, so that it covers 不過, 一直, 哪裡, 不要, 一定, 一下, 一些, 一切 and 一點.
  - **Capitalized proper-noun headwords (美國 Měi guó):** the format rule says headword pinyin is lowercase, so this is a deliberate display convention. Examples still capitalize proper nouns. The orchestrator should record this in DECISIONS.md.
  - **喔 o vs ō (174):** I kept "lái o!". This chunk follows the agreed split: sentence-final 喔 is o, the stand-alone interjection is ō.
- **Cross-chunk follow-ups (not edited):**
  - chunk-12 #562/#565/#597 write sentence-final 喔 as ō, which should be o.
  - chunk-16 #783 jìbùzhù should be jìbuzhù, to match the neutral infix bu.
- **Native check:** for 睡不著, does she say zháo or zhāo? Is 一些 vs 有些 distinguishable from the hints alone?

## chunk 19 review (ranks 901-950)
- **Accepted:**
  - 有時 note: removed "Spoken yóu shí". 時 is tone 2, so no 3-3 sandhi applies. The merge must not derive spokenAs for 有時.
  - Example pinyin: 停不下來 is now tíngbùxiàlái, matching shuìbùzháo/jìbùzhù. 不對 is now bùduì, matching bùcuò in other chunks.
  - Hints sharpened against near-synonyms:
    - 十分 "formal; literally 'ten parts'" (vs 非常)
    - 可怕 "everyday 'scary'; also 'awful'" (vs 恐怖)
    - 類 gloss "category; class; kind" and hint "a category; more formal than zhǒng"
    - 感受 gloss "(one's) feelings; to experience" and hint "...; not gǎn jué"
    - 管理 "formal, two syllables; management" (vs 管)
    - 目的 gloss "purpose" (dropped "aim", which collides with 目標) and hint "what you intend to achieve" (vs 原因)
    - 美麗 "two syllables, a bit literary"
    - 氣 "make someone angry; one syllable" (vs 生氣)
    - 一旦 "if/once it ever happens" (vs the 一…就 pattern)
  - Hint wording: I left out the Chinese characters that the reviewers suggested (e.g. 氣死了), because the user does not read. Hints use pinyin instead.
  - 樓 note: 一樓 = ground floor is not Taiwan-specific; the note now says "(US-style counting)".
  - 基本 example is now 我只會說基本的英文。 The topicalized original 基本的英文我會說 was natural speech, not wrong. Plain word order is simply easier to follow by ear.
  - 到處 example is now 我剛剛到處找你！ so the past sense is clear.
- **Rejected:** none.
- **Cross-chunk follow-up:** one example elsewhere has "tīng bù dǒng" spaced, against the joined potential complements (shuìbùzháo, jìbùzhù, tíngbùxiàlái). Normalize at merge.
- **Native check:** is 我剛剛到處找你 what she would say, or would she add 耶/欸? Does 可怕 vs 恐怖 feel like "everyday scary" vs "horror scary" to her?

## chunk 01 review (ranks 1-50)
- **Accepted** (checked against MOE `data/cache/moedict`). These supersede the 為/就/這個 hint bullets in the chunk-01 and chunk-08 sections above.
  - 個: example is now 我有兩個小孩。 / liǎng ge xiǎohái (neutral ge after numbers; 小孩 is the usual Taiwan word for one's kids).
  - 了: note says 受不了 shòu bu liǎo (MOE).
  - 知道: note now says MOE lists both zhī dao and zhī dào.
  - 把: the note example 一把椅子 is replaced with 一把鑰匙 (Taiwan counts chairs with 張).
  - 就: gloss "then (at once); exactly", hint "as soon as; sooner than expected". This drops "right away" (馬上) and "just" (只) and separates it from 然後.
  - 為: gloss "for (the sake of)", hint "one syllable; for someone's sake", example 我是為你好。 This separates it from 替 "for; on behalf of". I did not put Chinese characters in the hint, because the learner can't read them.
  - 對: gloss "right; correct", hint `everyday "that's right!"` (vs 正確). The "toward" use stays in the note.
  - 他: gloss "he; him; she (in speech)". The note says spoken "it" is usually dropped or said with 這/那.
  - 能: example 我明天不能來。 The note says Taiwan requests use 可以.
  - 是: hint "A is B, not location". The note says a bare 是 for "yes" sounds formal and Taiwan uses 對/嗯. I also dropped "yes" from the gloss (my own extension of the finding), so the "yes" prompt doesn't compete with 對.
  - 好: example changed, but not to the suggested 他是好人. It is now 你的中文很好！, which clearly shows "good", whereas 他人 can be read as "others".
  - 這個: hint "this one (zhè + ge)".
- **Rejected:** 做 "zuò le" → "zuòle". The project majority separates verb+了 (about 45 separate vs 8 joined across chunks), while this chunk joins zhe/guò (zuòzhe, chīguò). The merge step should pick one rule for le/zhe/guo globally rather than this chunk alone.
- **Native check:** 一把椅子 vs 一張椅子 in your wife's speech. Does bare 是 as "yes" sound stiff to her? Is 你明天能來嗎 really less natural than 可以?

## chunk 17 review (ranks 801-850)
- **Accepted:**
  - **失敗 example:** 沒關係 is now méiguānxi, with MOE's neutral 係. This matches headword 沒關係 (rank 976).
  - **Hints:** 下面 has "two syllables; location word (under X)", with gloss "below; underneath; next". 那邊 has "lit. 'that side' (not nà lǐ)". 詞 has "unit of meaning, not one character".
  - **舞:** gloss "a dance; dancing", hint "one syllable; the noun". The hint leaves out tiào wǔ, because the pinyin would give away the answer on the Say card.
  - **病:** gloss "illness; disease", hint "one syllable; the illness itself".
  - **比如:** hint "everyday; often followed by shuō". The hint uses pinyin, not 比如說, because the user can't read characters. The note now mentions 比方說.
  - **幫忙:** the hint and note no longer say "nothing follows it". 幫忙 + verb (幫忙拿一下) is normal. The hint is now "lend a hand; not before a person".
  - **提出:** new example 他提出了一個好問題。, written "yī ge" and "tíchū le" to follow deck conventions.
  - **遇到 / 老婆:** notes now mention 碰到 and 太太. The 老婆 hint is "casual, usually your own wife".
- **Rejected: attaching aspect 了 in 失敗了 ("Shībàile").** This follows the chunk-13 review decision: most of the deck writes aspect 了 as a separate word, and normalization is deferred to one global pass at merge. The attached forms already in this chunk (jùjuéle, mǎile, Dàole) are left for that pass.
- **Not done (outside this chunk):** the reviewer's optional "one syllable" hint for 下 (rank 71, chunk 02). The new 下面 hint already separates the two.
- **Native check:**
  - Does your wife say 幫忙 + person (幫忙他) at all?
  - Is 比方說 more common than 比如說 in her speech?

## chunk 16 review (ranks 751-800)
- The findings' rank numbers 1-6 were mislabeled. They refer to 包 773, 全國 756, 口 765, 一會 798, 交易 763 and 位置 786.
- **Accepted:**
  - **理由 (771)**: the example now writes 不是 as one word, "bùshì". Chunks 02 and 18 already do this, and this was the only split "bù shì".
  - **包 (773)**: in Taiwan, bare 包 for "bag" is rare; people say 包包 or 背包. So the gloss now leads with the verb: "to wrap; bag; pack". pos is now verb (MOE marks 動名), with the hint "wrap up; also a handbag or a pack". The new example is 可以幫我包起來嗎？ The note names 包包 and 背包.
  - **全國 (756)**: Taiwanese say 全台 for weather, so the example is now 這件事全國都知道了。 I avoided the reviewer's 全國第一名 because no chunk has set a spacing for 第一名 yet.
  - **口 (765)**: the gloss is now "a bite; mouth; opening" and pos is measure. The note now says what 口 counts: bites (一口) and family members (一家四口).
  - **一會 (798)**: the example is now 過一會就好了。 Taiwanese would say 休息一下, not 休息一會.
  - **交易 (763)**: the misleading "易 is read yì here" was removed, since 易 has only that reading in this sense. The note now gives 做交易 and 網路交易.
  - **位置 (786)**: the example is now 你可以傳位置給我嗎？, which shows the main "location" sense. For "seat", Taiwanese say 位子.
- **Rejected: 真實 (755) example 故事 gùshi → gùshì.** The 故事 headword (chunk 08, rank 373) is gù shi. MOE lists gù shi first, and CEDICT gives gù shi for "story", so the project rule (follow MOE's neutral tone unless CEDICT and MOE's sibling words have the full tone) keeps the neutral tone. The example has to match the headword. If the orchestrator moves 故事 to gù shì, change the headword and both examples (chunk 08 line 221, chunk 16 rank 755) together.
- **Rejected, no chunk change: spokenAs for 儘管 / 一會.** Under the format rules, spokenAs is computed by the merge script, which does not exist yet in scripts/data. That script must apply third-tone sandhi (儘管 → jín guǎn) and 一 sandhi (一會 → yì huǐ, 一口 → yì kǒu), or these hints will be missing.
- **Native check:** Is 過一會就好了 natural, or would she say 等一下 or 待會? Is bare 包 ever used for a bag? Does she say gù shi or gù shì?

## chunk 20 review (ranks 951-1000)
- The reviewers numbered the second batch of findings 1-10. They map to 就要 960, 八 984, 座 959, 白 973, 吃飯 983, 飯 987, 千 993, 姐姐 975, 晚安 978, 隨便 962.
- **Accepted:**
  - 耶 is now **yē**, in both the headword and the example. MOE has only yē/yé and no neutral reading. The isolated TTS clip will say yē, and the old note already described a high level pitch. The note now says the tone can be lighter in fast speech and mentions classical yé.
  - 座: gloss "(measure: mountains, bridges)". The note points to 棟 for buildings in Taiwan and to 座位 for 'seat'.
  - 就要: hint "can follow a time word, like tomorrow". The note contrasts it with 快要 using 明天就要走了.
  - 白: hint "one syllable; also 'for nothing'", to separate it from 白色.
  - 八: the note now says the 發 pun is Cantonese and not a Mandarin sound match.
  - 吃飯: the greeting is now 吃飽了沒？.
  - 飯: example compounds are 午飯/晚飯, plus a remark that breakfast is 早餐 in Taiwan.
  - English fixes: 千, 姐姐, 晚安, 隨便.
  - Example pinyin compounds: kǒngbùpiàn, Táiwānrén.
- **Rejected:**
  - Splitting 不要 to "Bù yào" in the 食物 example. 不要 'don't' is a lexicalized word in MOE and CEDICT, and the deck joins it more often than not (13 joined, 11 split). Any deck-wide spacing convention should be set once at merge.
  - spokenAs, no chunk change. Per earlier decisions, the merge script computes it. It must output ní hǎo for 你好 (992) and bú huì for 不會 (963). No other headword in this chunk needs one.
- **Native check:**
  - Does she say 好好吃耶 with a high level yē, a rising yé, or a light ye?
  - Would she count a mountain or a temple with 座 in casual speech, or use 個?

## chunk 03 review (ranks 101-150)
- **Accepted:** example pinyin joins 不要 → bùyào (那個, 希望) and 下雨 → xiàyǔ, which matches most chunks. 要不要 stays A-not-A "yào bù yào". 聽不懂 is joined, but written **tīngbudǒng** with neutral bu, not the reviewer's bù. This matches the chunk-04 review convention (MOE 睡不著 shuì bu zhāo, 受不了 shòu bu liǎo, 對不起 duì bu qǐ). 聽不懂 itself has no MOE entry. Hints were sharpened for 這麼/那麼 (gloss no longer has "like this / like that", which belong to 這樣/那樣), 別 ("one syllable", vs 不要), 認為 ("more formal than jué de"), 一樣 and 前. 前 is now "front; ago; before (a time)" with a "one syllable" hint, vs 之前/以前. Its example English is now "He already came back three days ago." (shows 就).
- **Partly accepted:** I kept 認為's gloss as "to think; to believe" and did not reorder it to "believe" first, which would collide with 相信 "to believe; to trust". 幹's hint has no characters now, but the reviewer's 'slangy; as in "what are you up to?"' would duplicate 搞 (rank 252)'s hint, so it is 'casual; mostly in "what are you doing?" or "why?"'. 這麼 hint: "this much, before an adjective". I did not use "so hot" as the hint because Taiwanese often say 好熱 for that.
- **Rejected: 叫 example → míngzì.** The premise is out of date. The chunk-06 review has since switched 名字 to MOE **míng zi** (MOE: míng zi = a person's name; míng zì = classical 名與字號 / name of a thing), and chunks 05, 06 and 16 all write míngzi now. I kept "míngzi".
- **Rejected: 地 example → dìshàng.** MOE 地上 is dì shang, and chunk 14's 地上 example was already changed to dìshang, so both chunks agree. The 前 example's huílai matches the 回來 headword (MOE/CEDICT huí lai).
- **Rejected: 地方 note "misstates MOE".** The reviewer has it backwards. In the MOE revised dictionary, dì fāng covers 區域, 處所 and 某部分 ("place", "part"), and dì fang is only the archaic 地保 "village constable". The full dì fāng stays. I reworded the note to say this explicitly.
- **No chunk change, follow-up for the audio owner (scripts/audio):** 們 (rank 101, neutral men) should get a hand-checked word clip and skip the automatic pitch-contour check. TTS of the lone character is likely to say mén. One option is to record the word clip as 我們 and say so in the note.
- **Native check:** is 認為 (vs 覺得) natural in 我認為這樣比較好, or too stiff for her? Is 地方 dì fāng or dì fang in her speech?

## chunk 18 review (ranks 851-900)
- **Accepted:**
  - **Pinyin in notes:** every Chinese phrase in the chunk's notes now has its pinyin inline, not only the polyphones the reviewer listed (for example 幫 bāng / 為 wèi, 還差一個人 hái chà yī ge rén, 交給 jiāo gěi, 照顧 zhào gù, matching the 780 headword).
  - **照 (894):** gloss "to shine on; to photograph; according to".
  - **丟 (880):** the note now says 丟垃圾 means "throw away trash", and that taking the trash out is 倒垃圾 dào lè sè.
  - **街 (852):** hint "street with shops, not lù". MOE defines 街 as a lively road with shops.
  - **以來 (893):** hint "goes after the time phrase". I used words, not 從…以來, because the user can't read.
  - **Example wording:** 適合 (889) is "This top really suits you." 拜託 (896) is "Please help me out." 男孩 (886) is now 那個小男孩跑得好快。
- **Rejected:**
  - **市場 (879) → shì chǎng:** kept MOE shì cháng. The project already decided this for 現場/機場/市場/場 in chunks 12 and 18 (see the bullets above), and the note mentions chǎng. Word audio has not been generated yet, so I could not listen to the clip. **For the audio agent:** ElevenLabs may say chǎng for 市場/機場/現場/場. Pitch QC should accept tone 2 or 3 on 場, or check the clip. If the orchestrator switches to chǎng, change all four words together.
  - **差不多 → chà bù duō:** MOE (dict-revised) actually reads it chà bu duō, with a neutral 不. Kept.
  - **拼命 → 拚命:** MOE has both entries. 拼命 is pīn mìng ("努力、盡力地去做"), and 拚命 is pàn mìng. 拼命 with pīn mìng is the form people say, so I kept it and added the pinyin.
- **Native check:** Does she say shì cháng or shì chǎng, and chà bu duō or chà bù duō? Is 丟垃圾 ever used for taking the trash out to the truck?

## chunk 02 review (ranks 51-100)
- Note: the findings list gave wrong rank numbers (1-13) for 中, 這裡, 太, 真, 但是, 又, 可能, 更, 可, 點 and 怎麼. I matched them by character.
- **Accepted (checked against MOE):** 回來 in the 時候 example is now huílai (MOE huí lai, the chunk-05 convention). Sentence-final 喔 in the 多 and 大 examples is now ō, matching the chunk-03 headword and MOE (ō/wū/wò only). 大夫 is now dài fu (MOE gives dài fu for "doctor" and dà fū for the official). 沒事 is now written Méishì (one MOE word). The 啊 note now covers liaison: ya after -a/-e/-i/-o/-ü, wa after -u/-ao/-ou (好啊 is heard as hǎo wa), na after -n. 隻 note is now "Different tone from 只 zhǐ". The 可 note no longer says 可 "stands alone" in 可不可以; it explains that 可不可以 is the A-not-A form of 可以.
- **Accepted, reworded into English:** The Say-card hints are for a user who can't read, so I kept them free of characters and did not use the reviewers' "not 可是 / 不過"-style hints. 中: gloss "middle; in; in progress", hint "one syllable, not 'inside'; after a verb: in progress". 這裡: hint "this place, not 'this side'". 太: gloss "too; so (… !)", hint "too much; or 'so …!' with le at the end". 真: hint "literally 'true'; one syllable, before an adjective". 但是: hint "the standard, firmer 'but'; two syllables". 又: gloss "again; both … and" (drops "also", which is 也). 可能: hint "the most common 'maybe'; also 'possible'". 更: hint "one syllable; 'even more', before an adjective". 點: hint "one syllable; 'a bit' after an adjective". 怎麼: hint "how (to do); how come (surprised)".
- **Rejected:** The 中 example change to 餐廳還在營業中嗎. 我還在考慮中 is ordinary Taiwan speech (shops, sales, polite refusals), and it now matches the gloss and hint. The 可 gloss change, which would have dropped "(emphasis)": emphatic 可 (你可要小心喔, 這可不行) is still heard in Taiwan, so I kept it and added an example to the note. I also kept 'so' in the 真 gloss, which the reviewer had marked as optional to drop: 真好/真可愛 'so nice/cute' is its main use.
- **Cross-chunk:** Chunk-04 still writes sentence-final 喔 as `o` (lái o!). It should become ō to match chunks 02, 03 and 12.
- **Native check:** Is sentence-final 喔 (好多喔) really closer to ō than to a light neutral o? Does she say 還在考慮中 or just 還在考慮?

## chunk 12 review (ranks 551-600)
- The findings numbered 1-5 map to 提 574, 喔 (562/565/597), 留 552, 轉 581, and 晚上/過來 (cross-chunk).
- **Accepted:**
  - **提 (574):** the note no longer teaches dī fáng. The MOE 提防 entry is tí fáng (ㄊㄧˊ ㄈㄤˊ). MOE keeps the dī reading only for 投擲 and as a cross-reference. The note now says 提防 is tí fáng in Taiwan and dī fang on the mainland.
  - **Sentence-final 喔 → `o`** in 562, 565 and 597. This follows the agreed split from earlier reviews: the stand-alone interjection is ō, and the sentence-final particle is o.
  - **右轉 → yòuzhuǎn**. It is a lexicalized MOE entry (ㄧㄡˋ ㄓㄨㄢˇ).
  - **留 (552):** the card now leads with the bare-留 sense "keep / save for". The gloss is "to keep; to save (for someone); to stay" and the hint is "one syllable; save for later, or stay on". The example is now 幫我留一個位子。 (wèizi, MOE wèi zi), so it no longer overlaps 留下 (702). This also resolves the 留下來 spacing finding.
  - **Hints added** to separate near-synonyms:
    - 剛剛 vs 剛才 (656): "doubled; the everyday Taiwan word"
    - 往 vs 向 (152): "direction of movement, e.g. go forward". The note also contrasts it with 向.
    - 表演 vs 節目 (490): "live, on stage"
    - 建議 vs 意見 (700): "recommend what to do"
    - 身體 vs 健康 (828): "physical body, also one's health"
    - 害怕 vs 怕 (721): "feeling fear, two syllables"
  - **辦 (558):** the gloss is now "to do (about it); to hold (an event)" and the hint is "as in 'what do we do?', or throw a party". It no longer duplicates 處理 "to handle".
  - **女士 (573):** the example is now 女士優先，你先請。 because a server would say 小姐, not 這位女士. The hint is "formal, as in 'ladies first'". The note points to 小姐 as the way to address a woman.
  - **精神 (596):** the gloss is now "energy; vigor; spirit" (I dropped "mind", which belongs to 心). The hint is "feeling lively and awake", and the note mentions 精神病.
  - **帶來 (598):** the example is now 他帶來了一個好消息。 and the hint is "bring here; bring about (a result)".
- **Rejected:**
  - **寶貝 example guòlai → guòlái.** The project follows MOE 過來 guò lai, as decided in the chunk 07 review. The reviewer's claim that "MOE gives guò lái" is wrong. Our MOE cache lists only guò lai.
  - **Finding 5 (晚上/過來 in chunks 14 and 07), no change.** It is already resolved: chunk 14 has wǎnshang and chunk 07 has guòlai.
  - **Finding 3's "shared sentence with chunk 15", no change.** It is out of date: 留下's example is now 他留下一封信就走了。
- **Native check:**
  - Is 女士優先，你先請 natural for her, or would she say 您先請 or 女生優先?
  - Does she say 蠻 mán or 滿 mǎn?
  - Is 提防 tí fáng in her speech?

## Merge into words.json (`scripts/data/build_words.py` -> `src/data/words.json`, `data/ids.lock.json`)
Run: `./.venv/Scripts/python scripts/data/build_words.py` (`--check` validates without writing; `--quiet` hides the spokenAs review list). Rerunning is idempotent (second run: 1000 ids reused, 0 new, identical output). Exit 1 and every failure printed on any error.
- **Chunk files hold only authored fields** (`rank trad pinyin gloss hint? pos note? example{trad,pinyin,english}`). The script rejects anything else, so `id`, `simp`, `pinyinNumbered`, `tones` and `spokenAs` can only come from the merge.
- **pinyinNumbered writes ü as `v`** (`nv3`, `lv4`), the same as pypinyin TONE3 and `scripts/audio/common.parse_numbered`. Neutral is 5. This keeps ids and the numbered form ASCII.
- **ids.lock.json is keyed `trad|reading`** (reading = pinyinNumbered without spaces), with the id as the value. Existing entries are always reused. If a word's reading is edited, the id follows it: an unclaimed lock entry with the same trad is re-keyed, and the script prints a notice. Lock entries for words removed from the list are never deleted, so a removed word's id is never reused for anything else. A second entry with the same trad gets `~reading`, as types.ts specifies. Tested on a scratch copy with a reading edit, a removed word, an added duplicate-trad entry, and a swap of the two duplicates' order; all ids stayed stable.
- **spokenAs rules** (43 words get one):
  - 3+3: applied only when both syllables are *written* 3rd tone. A 3rd tone before a written neutral syllable whose underlying tone is 3 is skipped and logged. The only case is 姐姐 jiě jie, which has no sandhi anyway (kinship reduplication).
  - 3-3-3 runs: grouping comes from jieba's dictionary ([AB]C -> 2-2-3, A[BC] -> 3-2-3, otherwise skipped). Runs of 4+ are skipped. No headword currently has a 3-3-3 run.
  - 不: bù -> bú only when 不 is written bù and the next syllable's underlying tone is 4. Neutral infix bu (對不起) is untouched.
  - 一: yī -> yí before an underlying 4th tone and yì before 1/2/3. It stays yī word-finally (唯一, 之一), after 第 or a numeral (第一, 十一), and before a counting digit, 月 or 號 (一二三, 一月). 一百/一千/一萬 do change (yì bǎi, yí wàn).
  - A written-neutral next syllable uses pypinyin's default reading for its underlying tone (一個 -> yí ge). No current headword needs this.
  - Results reviewed by hand: 可以 所以 所有 哪裡 也許 瞭解 只有 等等 永遠 處理 總統 影響 擁有 有點 小姐 好好 理解 表演 想法 儘管 阻止 老闆 允許 管理 你好 (3+3); 不過 不要 不錯 不再 不用 不對 不會 (bú); 一起 一直 一些 一點 一般 一會 (yì); 一樣 一定 一下 一切 一旦 (yí). 好好 -> háo hǎo is the Taiwan form (mainland erhua háo hāor is not used).
- **Validation beyond the brief:** headword pinyin must be lowercase with canonical tone-mark placement (hǎo, not haǒ). Example syllables must also carry canonical marks. Example pinyin is split into syllables by a DP over the syllable table, where a vowel-initial syllable inside a word needs an apostrophe (xī'ān). The syllable table matches pypinyin's syllable inventory, minus rare ones (biang, hm, ng, ê...).
- **Non-fatal warnings:** an example syllable that pypinyin doesn't know for its character; a headword reading that matches neither MOE nor CEDICT; a duplicate gloss+hint pair (the Say card prompt; none found); Chinese characters in a hint. Two warnings remain, both intended: 倒's example uses 垃圾 lè sè (the Taiwan reading), and 那邊 is nà biān. MOE has no 那邊 entry, CEDICT gives nà bian, and nà biān matches MOE 這邊 zhè biān and Taiwan speech.
- **Content fixes made by the merge step:** hints with Chinese characters, which the learner can't read on the Say card, were rewritten in pinyin. 另 (284): "before 一 + measure word" -> "before yī + measure word". 受 (328): "endure; as in 受不了" -> "endure; as in shòu bu liǎo".
- **Output format:** `JSON.stringify` style with indent 2, and each `tones` array kept on one line (589 KB raw, far smaller gzipped). The key order follows the Word interface. `npx tsc -p tsconfig.app.json --noEmit` is clean with the real file.

## Say-card prompt disambiguation pass (all 1000 words)
Tool: `./.venv/Scripts/python scripts/data/prompt_groups.py [--senses-only] [--grep KEY] [--min N]`. It groups words whose glosses share a whole sense (`sense:` keys: each `;` piece, with parentheses and a leading to/a/the stripped, so "to know (a fact)" becomes "know") or a content word (`word:` keys, e.g. "want", "time"). It prints every group with gloss, [hint] and pos, then exits 1 on an identical gloss+hint. There were 262 sense groups and 518 groups in total. I reviewed every sense group and every word group with 12 or fewer members by hand. For the four large word groups (time, go, measure, word), I checked only the members that actually compete.
- **New rules in build_words.py (errors, not warnings):** (1) No two words may have an identical gloss + hint. The comparison ignores case, whitespace and trailing `.!?…`. Before this it was only a warning. (2) A hint must not contain the word's own pinyin, matched as a whole syllable sequence or written joined, because that gives the answer away. I checked both rules on the pre-pass data: they caught 這個 "(zhè + ge)", 受 "as in shòu bu liǎo" and 學 "not xué xí", plus a fabricated duplicate.
- **Approach:** For true near-synonyms, the main tool is the **syllable count** ("one syllable" / "two syllables"). It is objective and fits a learner who works by ear. Register (formal / everyday / casual) comes second. As a last resort the hint says "not <other word's pinyin>", which is the convention earlier reviews already used. Hints stay free of characters. I left groups alone when the existing hints already pointed to one word (e.g. know: 知道 a fact / 認識 a person; see: 看到 / 看見 / 見到; think; understand; happy; sorry; husband/wife; stop; change).
- **Groups changed (67 words; 66 hints and 1 gloss):**
  - **this/that:** 這 "one syllable" and 這個 "two syllables; this one, with a measure word" (the old hint "(zhè + ge)" leaked the answer). 那 "one syllable; also 'well then'". 那個 "two syllables; that one".
  - **want:** 要 "firm 'want'; also 'going to'" vs 想 "softer 'would like'; also think, miss".
  - **can / able to:** 能 "one syllable; able to, circumstances allow" vs 能夠 "two syllables; capable of, formal". 可 "one syllable; mostly in set phrases".
  - **but:** 但是 "…; not kě shì" and 可是 "…; not dàn shì". These two are interchangeable in speech, so naming the other one is the only reliable separator.
  - **so / therefore / like this:** 所以 "as a result; the everyday word". 因此 "formal 'therefore', not suǒ yǐ". 如此 "formal 'like this / so much'".
  - **really / indeed:** 真的 "two syllables; 'for real?'". 確實 "confirming a fact; also 'reliable'" vs 的確 "agreeing: 'it's true that…'; not què shí". The old hints were "confirming something is true" vs "agreeing that something is true", which is effectively the same thing.
  - **all / whole:** 全 "one syllable, before a noun (the whole family)" vs 整個 "two syllables; the whole (day, person)". The old hints were "whole, before a noun" vs "the whole + noun", which is identical in meaning. 全部 "all of it; can stand alone".
  - **become:** 成 "one syllable; after a verb: turn X into Y" vs 變成 "two syllables; turn into something else". Both used to say "change into". 變 "one syllable; …". 成為 "become (a role or status), a bit formal".
  - **how about it:** 怎麼樣 "three syllables, the full everyday form" vs 怎樣 "two syllables; also a defiant 'so what?'". The defiant use is Taiwan usage.
  - **or:** 或 "one syllable, in statements" vs 或者 "two syllables, in statements".
  - **thing / matter:** 事 "one syllable; …" vs 事情 "two syllables; …". The old hints said "short form" / "full form", which is opaque to someone who can't read.
  - **not have:** 沒有 "two syllables (full form)" vs 沒 "one syllable (short form)".
  - **every / each:** 每 "one syllable; …" vs 每個 "two syllables; each one (each person)". 每個 had no hint before.
  - **some:** 有些 "some, not all; also 'rather'" vs 有的 "contrasting 'some …, others …'" (the old hints were near-identical).
  - **many:** 多 "one syllable" vs 很多 "two syllables; 'very many', before a noun". Neither had a hint before.
  - **other / another:** 另 "one syllable; before yī + measure word" vs 另外 "two syllables; besides, also".
  - **after:** 之後 "after an event; not 'in the future'" (vs 以後).
  - **always:** 總 "one syllable; also 'sooner or later'" (vs 總是).
  - **receive:** 收 "one syllable; take in, or put away" (vs 收到).
  - **see/meet:** 見 "one syllable; as in 'see you tomorrow'" (vs 見到).
  - **One-syllable verbs and adjectives competing with a compound** (they had no hint before): 吃 "one syllable; eat something" (vs 吃飯). 進 "one syllable" (vs 進入/進去/進來). 夠 "one syllable, everyday" (vs 足夠). 下 "one syllable" (vs 下面).
  - **learn:** 學 "everyday one-syllable word" (the old hint "not xué xí" leaked xué) vs 學習 "two syllables, more formal".
  - **maybe:** 或許 "a bit formal; not yě xǔ" (vs 也許).
  - **explain:** 解釋 "explain why; give reasons" vs 說明 "lay out the details, e.g. instructions". Both are "to explain; explanation", and 解釋 had no hint.
  - **Smaller groups:**
    - discuss: 討論 "talk it over together" vs 談.
    - suggestion: 意見 "your view; also a complaint" vs 建議.
    - proof: 證據 "evidence, e.g. in a case" vs 證明.
    - exactly: 就是 "two syllables; 'exactly!'" vs 就.
    - father: 爸爸 "everyday word" vs 父親 "formal".
    - kind: 種 "everyday 'kind of'" vs 類.
    - girl: 女孩 "a young girl; a bit written" vs 女生.
    - way: 方式 "manner or style (e.g. way of paying)" vs 方法.
    - endure: 受 "endure; as in 'can't stand it'". The old hint leaked shòu.
  - **Measure words:**
    - 張: the gloss is now "(measure word: paper, tickets, photos, tables)" instead of "flat things". 片's hint is "slices, leaves; thin flat pieces". Both used to say "flat things".
    - 台 "machines; Taiwan's everyday word for cars too" vs 輛 "vehicles only; more formal than tái". Both covered cars.
    - 雙 "things in twos: shoes, chopsticks" vs 副.
- **Kept on purpose:** Gloss overlap with clearly different hints, such as the "so" group (真/太/這麼/那麼/原來), "only" (只/只是/只有/唯一/才/光) and "time" (時候 a point in time / 時間 amount of time / 次 occurrence). Cross-reference hints like "not kàn dào" and "more formal than jué de" name a *different* word, so the new leak rule allows them. 打開 "not plain kāi" and 尋找 "everyday is zhǎo" each show one of the word's syllables. I accepted that because the hint is still needed to tell the compound from the single syllable.

## Final audit (`data/AUDIT.md`; `select_words.py` AUDIT_* / PLACE_* tables; new `scripts/data/rechunk.py`)
- **Content needed only small fixes.** Every headword was compared with MOE, and every example syllable with MOE and pypinyin. Headword-in-example consistency, polyphones and mainland vocabulary were checked across all 1000 entries. I also deep-read 103 sampled entries and all 129 single-character entries that have several MOE readings. The fixes:
  - Sentence-final 喔 in the 多 and 大 examples: ō → o (the agreed split; the chunk-02 review had gone the other way).
  - 記 example jìbùzhù → jìbuzhù, and 做到 note zuò bù dào → zuò bu dào. Potential-complement 不 is neutral everywhere.
  - 好吃 got the hint "for food" to separate it from 好喝.
- **List judgment call: 44 swaps.** Abstract/news words that were in the list only because of the written half of the blend were swapped for household words that were missing. Each swapped-out word has a SUBTLEX-CH spoken rank of about 1300 or worse. Examples: 經濟 2613, 文化 2956, 國際 2305. Most added words rank better than that (生氣 813, 鑰匙 835, 生日 820), or are absent from mainland corpora (便當, 機車, 等一下, 還好, 算了, 不客氣, 沒問題, 下雨, 好喝). Also removed: 7 crime/film-genre words (武器, 攻擊, 威脅, 犯罪, 交易, 命令, 組織). 槍, 監獄, 警察 and 殺 were kept because they are very common in TV speech. 社會 was kept for 出社會 and 社會新聞.
- **Judgment call: placement by tiers.** The 72 curated everyday words (28 from the sanity sweep plus the 44 audit additions) are no longer placed by blended rank. That rank had put 七, 你好, 好吃, 台灣 and 便宜 at 975–1000. They are now spread in hand-ordered tiers: A over blend positions 120–560 (final ranks 115–524) and B over 560–1000 (ranks 541–931). Numbers sit next to 六 or 萬. The learner can still mark known words with "I already know this".
- New entries follow MOE: 便當 biàn dāng (MOE lists both readings), 鑰匙 yào shi, 不客氣 bù kè qì, 差不多 chà bu duō, 厲害 lì hài, 乾淨 gān jìng, 太太 tài tai. 女朋友 nǚ péng yǒu has no MOE entry and matches 男朋友, so `build_words` prints one more intended warning.
- `rechunk.py` re-ranks the authored entries from `selected.json` and archives dropped entries in `data/enriched-removed.json`. It rewrites 20 chunks of 50. **Ranks quoted in the sections above are pre-audit ranks**; ids are unchanged (`ids.lock.json` now has 1044 entries, 44 of them reserved for the removed words).
- **For the audio owner:** 44 new word ids need clips, and the 44 removed ids need none. Audio had not been generated when this audit ran (the manifest was empty).
