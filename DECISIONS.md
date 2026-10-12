# Decisions

Every significant call made while building qian, in one place. Each section is short and links to the file with the full reasoning:

| Topic | Details in |
|---|---|
| Word sources, selection, enrichment, conventions | [`data/NOTES.md`](data/NOTES.md), [`data/selection-log.md`](data/selection-log.md) (generated) |
| Final data audit and the native-speaker question list | [`data/AUDIT.md`](data/AUDIT.md) |
| Voice, TTS model, QC, credits | [`scripts/audio/NOTES.md`](scripts/audio/NOTES.md) |
| App: scheduler, store, UI, PWA, deploy, tests | [`docs/app-notes.md`](docs/app-notes.md) |
| What a native speaker should check | [`NATIVE-CHECK.md`](NATIVE-CHECK.md) |

## 1. Word list

**Sources and blending** ([`data/NOTES.md`](data/NOTES.md), "Candidate list")
- Frequencies come from SUBTLEX-CH (film/TV subtitles, i.e. speech) and `wordfreq` (`zh`, mostly written text), both on the Zipf scale.
- **score = 0.6 × SUBTLEX + 0.4 × wordfreq.** Speech counts more because the learner works by ear. At 0.5, news words such as 經濟 and 政治 rose 200–400 places.
- Simplified → Traditional with OpenCC `s2twp` (Taiwan phrases: 計程車, 腳踏車, 軟體). About 150 phrase conversions were reviewed by hand; IT-localisation ones (支持→支援, 消息→訊息, 文件→檔案…) are rejected and converted character by character instead.
- Forms that collapse to the same Traditional word are merged and their counts summed. Erhua forms merge into the Taiwan form (这儿→這裡, 一点儿→一點).
- Readings come from CC-CEDICT and the MOE dictionary (g0v `moedict-data`). Only factual reading fields are taken from MOE (it is CC BY-ND).

**Selection rules** ([selection-log.md](data/selection-log.md), tables in `scripts/data/select_words.py`)
- 106 removals: proper nouns (except 美國, 中國, 日本, 台灣), segmentation fragments, noises (嗯, 呃, 哇…), subtitle translationese (是的, 上帝…), vulgar words, reduplications, 25 literary function words (與, 之, 以, 於…) and 43 bound morphemes (們 is kept).
- 4 mainland → Taiwan substitutions in the same slot: 哦→喔, 美元→美金, 挺→蠻, 姑娘→女生. Spellings 台 (not 臺), 計畫, 身分.
- 他/她/它 are one word, 他 ("he; she (in speech)"), because they sound identical. Likewise 他們.
- 隻 and 麵 are split out of 只 and 面.

**Judgment-based swaps and reordering** ([`data/AUDIT.md`](data/AUDIT.md); [`data/selection-log.md`](data/selection-log.md), "Final audit" and "Placement")
- The pure frequency list was missing household words (下雨, 便當, 機車, 等一下, 還好, 鑰匙, 魚, 肉…) and contained news vocabulary. **72 everyday words were added**: 28 in a first sanity sweep and 44 in the final audit. The audit's 44 replaced 44 abstract, news and crime-genre words (經濟, 文化, 國際, 武器…) whose spoken rank is mostly beyond 1300.
- The 72 curated words are **placed by judgment** rather than by corpus rank (which put 你好, 好吃, 七 and 台灣 at 975–1000): tier A at ranks 115–524, tier B at 541–931, numbers right after 六 and 萬. Everything else keeps blended-frequency order.
- **How to revert** (ids never change, so study progress survives either change):
  - *Order only:* remove step "2c" in `scripts/data/select_words.py` (the `placedKey` assignments), then run `select_words.py` → `scripts/data/rechunk.py` → `scripts/data/build_words.py`. The audio does not change.
  - *A swap:* delete the pair from `AUDIT_IN` / `AUDIT_OUT` and the word from the `PLACE_TIER_*` tables. Put the removed word's authored entry (kept in `data/enriched-removed.json`) into a JSON list, pass it to `rechunk.py --add <file>`, then run `build_words.py` and `scripts/audio/generate.py` to record the returning word (about 1 credit).

## 2. Readings, pinyin and examples

- **Authority: the MOE Revised Dictionary (重編國語辭典修訂本)**, Taiwan's standard, cross-checked with CC-CEDICT. 994 of 1000 headwords match MOE exactly. The 6 deliberate differences are documented in their notes ([`data/AUDIT.md`](data/AUDIT.md), "What I checked").
- **Taiwan readings**: 垃圾 lè sè, 星期 xīng qí, 危險 wéi xiǎn, 頭髮 tóu fǎ, 場 cháng, 誰 shéi, 休息 xiū xí, and others.
- **和 is hé.** PLAN suggested the colloquial hàn. The data teaches hé and the note explains hàn ([NATIVE-CHECK](NATIVE-CHECK.md) asks which one she says).
- **Neutral tones follow MOE** (告訴 gào su, 早上 zǎo shang, 東西 dōng xi), **unless CEDICT has a full tone and MOE's own parallel words do too**. So 上面 shàng miàn (like 下面), 家裡 jiā lǐ, 那邊 nà biān (like 這邊). This rule is a proposal for a native speaker to confirm ([`data/NOTES.md`](data/NOTES.md), "chunk 14 review").
- **Sandhi**: pinyin shows dictionary tones. A "spoken as" hint is generated for 43 words (3+3, 不 bú, 一 yí/yì; [`data/NOTES.md`](data/NOTES.md), "Merge into words.json").
- **Say-card hints** must make every English prompt unique and must never contain the answer's own pinyin; `build_words.py` treats both as errors. Hints also contain no characters (the learner can't read them); this is a build warning, and none remain.
- **Example sentences**: short, everyday Taiwan Mandarin using common words, checked syllable by syllable against MOE.
  - Spacing follows GB/T 16159 (words joined, phrases apart), except that **了 is always a separate `le`**.
  - Sentence-final 喔 is a light **o**; stand-alone 喔 "oh, I see" is **ō**.
  - Potential-complement 不 is neutral (tīngbudǒng, shuìbuzháo).
  - Capitals only at sentence start and on proper nouns.
  - Details: [`data/NOTES.md`](data/NOTES.md), "Polish".
- **Every Chinese run in a note is followed by its pinyin** in the data itself (`scripts/data/notes_pinyin.py`, checked by `build_words.py`, then reviewed by two agents). With *Show characters* off, notes show only the pinyin. The render-time annotator (`components/noteAnnotate.ts`) remains as a safety net and currently adds nothing. 姊姊 / 兄弟姊妹 use jiě (everyday Taiwan speech), whereas MOE's 姊妹 entry gives zǐ mèi.

## 3. Audio

- **One voice: ElevenLabs "Anna Su"** (`9lHjugDhwqoxA5MhX0az`, Taiwan Mandarin), chosen by the user after a bake-off. There are no male or alternating voices and no voice setting. Each word has a word clip and an example-sentence clip: 2000 clips in total.
- **Model: `eleven_v4`.** It passed QC on 20 of 25 test words, against 14 for `multilingual_v2` and `flash_v2_5`. It was also the only model that read 垃圾 lèsè, 還 hái, 長 cháng and 想 xiǎng correctly.
  - **Fallbacks**: the last retry uses `eleven_flash_v2_5`. A few stubborn words got extra attempts on `eleven_v3` and `multilingual_v2`.
  - **Installed clips**: words: 859 v4, 122 flash, 12 v3, 7 multilingual_v2. Sentences: 997 v4, 3 flash.
  - **Reason for the fallbacks**: v4 says some isolated tone-1 syllables (他, 一, 喝, 西…) as a falling tone on every seed.
- **Request settings**: no `previous_text`/`next_text` context, because it made every model worse. Speed 0.9 for words and 0.95 for sentences; stability 0.75; `language_code: zh`; seeds are deterministic.
- **Encoding**: PCM is encoded locally to **mono 48 kbps MP3**. Clips are trimmed and loudness-normalised. That gives 16.05 MB for all 2000 clips.
- **Versioned filenames**: each file is named `<id>-<hash8>.mp3`, with the hash taken from the MP3 bytes, so a replaced clip gets a new URL and no cache keeps serving the old one. Replace clips only through `scripts/audio/generate.py`.
- **QC on every clip**:
  - speech-to-text with Whisper large-v3, plus a pitch-contour check of the expected tones for words;
  - failures are regenerated, and the best attempt is kept.
  - **Result:** 1953 pass, 46 suspect, 1 fail. All 47 flagged clips were reviewed: 35 are likely false alarms and **12 need a human listen** ([NATIVE-CHECK](NATIVE-CHECK.md), [`scripts/audio/flags.json`](scripts/audio/flags.json)).
- **Same-sound text for polyphones** ([`scripts/audio/overrides.json`](scripts/audio/overrides.json)). The TTS is sent a homophone, and QC still checks against the real word:
  - 和 hé → 河
  - 隻 zhī → 知
  - 教 jiāo → 交
  - 待 dāi → 呆
  - 數 shǔ → 鼠
  - 字 zì → 自
  - 沒 méi → 梅

  These clips should be spot-checked.
- **Credits** (Starter plan, 40,000 a month): **1,240 used in total**, confirmed on the subscription endpoint at release: 105 for the bake-off and tests, then 1,135 for the full run, retries and extra attempts. Single words cost about 0 credits and sentences about 1 credit each.
- **Fallback in the app**: if a clip is missing or fails to load, the browser's zh-TW voice reads the text. `scripts/check-audio.mjs` blocks a deploy with less than 99% clip coverage or a missing file.

## 4. Scheduler

Full rationale: [`docs/app-notes.md`](docs/app-notes.md), "Judgment calls" (first section), "Simulation results", "Review fixes (core)" and "Final review fixes".

- **FSRS-6** (ts-fsrs, default weights), learning steps 1m/10m, relearning 10m, target retention 90%. Fuzz is deterministic, so replaying the log always gives the same states. The day boundary is **4am local**, not UTC midnight.
- **Two cards per word**, Listen and Say. The Say card unlocks once the Listen card has graduated, and only **on a later study day**, so it is never answered from short-term memory (like Anki's "bury siblings").
- **No daily quota.** The next card is sampled from due cards, weighted by (1 − recall)². A new word enters only when both gates are open:
  - the **working set** (words in learning, or with stability under *Stable after*) is below **30 words**;
  - due reviews are at or below the **backlog limit of 10**.

  When the set is full, Say cards of words already in it can still start. Introduction follows the rank order.
- **"I already know this"** grades both cards Easy, so the word comes back in about a week.
- **Defaults 30 / 5 days / 10** were chosen by the user from a 60-day simulation (idealised learner; real intake will be lower):

  | Words in progress / stable after | Session | New words a day (days 30–59) | Accuracy |
  |---|---|---|---|
  | 15 / 7 (PLAN's original) | stop when caught up | 1.1 | 86% |
  | 15 / 7 | endless, 150 cards/day | 3.0 | 97% |
  | **30 / 5 (defaults)** | **stop when caught up** | **3.2** (245 words in 60 days) | 86% |
  | **30 / 5 (defaults)** | **endless, 150 cards/day** | **5.2** (400 words in 60 days) | 94% |

  After a 5-day break, the gate held new words back until the backlog was cleared. There was no catch-up flood, and the gate was never violated.
- Other rules:
  - never the same card twice in a row, and never a word's other card within 3 cards;
  - learning cards are shown early only when nothing else is available, and at most 60 s early;
  - "practice ahead" runs only once all due work is done.

## 5. Your data

- **Event-sourced.** The source of truth is an append-only log in IndexedDB of `review`, `known`, `suspend`, `flag` and `note` events (`{id, kind, wordId, ts, deviceId, …}`). Card states are rebuilt by replaying the log. Settings are stored in `localStorage` (`qian.settings`).
- **Backup file**: `qian-backup-YYYY-MM-DD.json` = `{app: "qian", schemaVersion, exportedAt, deviceId, settings, events}`.
  - **Merge** (the default) takes the union of both logs by event id. Repeating it is safe, and it is how two devices sync.
  - **Replace** adopts the file's log and settings, with an id-based warning about what would be lost.
- **Your notes** (added 2026-10-12) are `note` events: the latest one per word wins on replay, and empty text clears it. They merge between devices like everything else. An edit is stamped after the word's newest note, so it wins even over a note imported from a device whose clock ran ahead. The backup schema version stays 1, because the change only adds an event kind; an older build would skip note events on import instead of failing. Undo never removes a note.
- **Flags** can be exported as a CSV from *Stats → Flagged cards → Export flags (CSV)*. They are also included in the backup.
- The app asks for persistent storage. iPhone users are nudged to install it to the home screen (Safari deletes site data after 7 days) and to back up regularly.

## 6. Hosting, PWA and offline

- GitHub Pages at **https://dmilin1.github.io/qian/**, with Vite `base` `/qian/` and **hash routing** (`#/words`), so no 404 fallback is needed.
- The workflow in `.github/workflows/deploy.yml` runs on every push to `main`: lint → Vitest → audio check → build → deploy. Playwright is run locally, not in CI.
- **Service worker** (vite-plugin-pwa, `generateSW`):
  - It precaches the app shell and word data (17 entries, 1.5 MB). It does **not** precache audio.
  - **Audio** is cached on first play (CacheFirst, `qian-audio`, with Range-request support for Safari), or all at once with *Settings → Audio → Download all audio* (about 15 MB).
  - Clips that are no longer in the manifest are pruned.
- **Updates**: when a new version is deployed, an in-page "new version / Reload" notice appears. The app never reloads by itself in the middle of a card.

## 7. Where the app differs from PLAN.md

| PLAN.md | Decided | Why |
|---|---|---|
| Two voices (female and male), alternated, with a voice setting | One voice (Anna Su); no voice setting | The user's choice after the bake-off |
| Working set "about 12", stable at "3–7 days" | 30 words, 5 days | Simulation: 15/7 gave only 1–3 new words a day |
| New words pause during a backlog | Explicit backlog gate (10 due reviews) | Testable and checked on every pick |
| (not specified) | Say card waits for a later study day | Avoids recall from short-term memory |
| (not specified) | A full working set still admits Say cards of words already in it | They add no new word |
| Say reveal plays the audio and the example | It plays the word only; the example has its own button (E) | Keeps the pace fast |
| 和 hàn | 和 hé, with hàn in the note | MOE standard; a native speaker should decide |
| Strict frequency order | 72 curated everyday words placed by judgment | Corpora underrate Taiwanese household words |
| Simplified characters in the word list only | Also on the word detail page | Requested by the Words task |
| `scripts/audio-flags.json` | `scripts/audio/flags.json` | Kept with the other audio files |

## 8. Open questions and known issues

- **For the learner's wife**: [NATIVE-CHECK.md](NATIVE-CHECK.md). It covers the 12 audio clips to listen to; the 喔 reading, where the data says ō but the clip says ò; 和 hé vs hàn; neutral tones; and naturalness questions.
- **Licensing**: the glosses draw on CC-CEDICT, so `src/data/words.json` is published under **CC BY-SA 4.0**. SUBTLEX-CH is research-use only and cited. Only reading fields are taken from MOE. Please confirm this is acceptable for a public site.
- **Not verified on a real iPhone**: the audio unlock, Range requests from the cache, and IndexedDB reconnects. All of them pass in Playwright's WebKit.
- **Short desktop windows**: the sticky grade bar can cover the end of a long answer until you scroll.
- **Pace**: the defaults 30 / 5 come from an idealised simulation. Real intake will likely be lower, and both values are settings.
