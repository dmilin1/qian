# Audio toolchain: notes and decisions

## How to run

The full run: all words in `src/data/words.json`, a word clip and an example-sentence clip each. Run it from the repo root (Git Bash):

```bash
# 1. preview: lists the clips and the worst-case credit cost, makes no API calls
PYTHONIOENCODING=utf-8 ./.venv/Scripts/python scripts/audio/generate.py --dry-run
# 2. the real run (resumable: if it stops, run the same command again)
PYTHONIOENCODING=utf-8 ./.venv/Scripts/python scripts/audio/generate.py
```

The run writes:
- `public/audio/w/<id>-<hash8>.mp3` and `public/audio/s/<id>-<hash8>.mp3`. `<hash8>` is taken from the mp3 bytes, so a regenerated clip gets a new URL and the service worker's cache-forever rule stays safe.
- `src/data/audio-manifest.json`
- `scripts/audio/state.json`, which should be committed. It holds the per-clip hash, seed, model, every attempt and its QC result.
- `scripts/audio/flags.json`, the clips that never passed QC. Each entry carries the `review` note from `reviews.json` while the reviewed file is still the one installed.
- `scripts/audio/cache/`, raw FLAC and the mp3 of every attempt. It is gitignored.

Useful flags:
- `--limit N`: only the first N words by rank.
- `--only id1,id2`
- `--words-only` / `--examples-only`
- `--model`
- `--force`: regenerate even when the clip is up to date.
- `--retry-flagged`: give non-passing clips 3 more attempts.
- `--max-credits` (default 15000), `--reserve` (default 2000), `--max-retry-credits` (default 3000)
- `--concurrency` (default 3)
- `--no-qc`
- `--whisper`, `--device`
- `--manifest-only`: rebuild the manifest and flags from the state file without calling the API.
- `--overrides` (default `scripts/audio/overrides.json`): a JSON file of the form `{wordId: {wordText?, exampleText?}}`. It sends different TTS input text, for example an unambiguous homophone for a polyphone. QC still checks against the real word and its pinyin.
- `--extra MODEL[:SEED],...` (needs `--only`): runs one extra attempt per spec on each selected, up-to-date clip, for example `--words-only --only w4ed6 --extra eleven_flash_v2_5:11,eleven_v3:0`. Attempts are appended, the best attempt overall is installed, and the clip hash does not change, so a later plain run keeps the result.
- `--reviews` (default `scripts/audio/reviews.json`): manual review notes for flagged clips, of the form `{clipKey: {status: "ok"|"listen", reason, path}}`. A note is copied into `flags.json` only while `path` is still the installed file.

Other commands:
- Re-score after changing `qc.py` (no API calls): `./.venv/Scripts/python scripts/audio/rescore.py [--all | --only s/w767e,w/w548c]`. It re-runs QC on every cached attempt, picks the best one again, reinstalls it if it changed, and rewrites state, manifest and flags. By default it covers only non-pass clips; `--all` takes about 25 min.
- QC existing clips again (report only): `./.venv/Scripts/python scripts/audio/qc.py --all`. For one file: `qc.py FILE --word 知道 --pinyin "zhi1 dao4"` or `qc.py FILE --sentence 你好。`
- Tests: `./.venv/Scripts/python -m pytest scripts/audio/tests -q`. To include the whisper end-to-end test, set `QC_SLOW=1`.
- Reproduce the bake-off with `scripts/audio/bakeoff.py generate|score`. It writes to `public/audio/_bakeoff/`, which is temporary and should be deleted afterwards.

**Expected cost of the full run (1000 words + 1000 sentences):**
- **Characters:** `data/selected.json` has 1,644 word characters. The examples in `data/enriched` average 8.1 characters each, about 8,100 in total. That makes about 9,750 characters.
- **Worst case (per-character estimate, `eleven_v4` at 1 credit per character):** about 9.8k credits for the first attempts, plus at most 3k for retries.
- **Expected actual spend:** about 1.5–2.5k credits. ElevenLabs' `character-cost` header (which matches the subscription counter) has been far below the per-character rate for these clips:
  - single words mostly cost 0
  - sentences cost about 1–2 credits each (`eleven_v4`: 5 credits for 41 sentence characters)
  - the 10-word end-to-end run (20 clips, 79 characters) cost 9 credits
- **Time:** about 20–30 min on the RTX 3090. QC is about 0.3 s per clip on the GPU, and TTS requests run 3 at a time.

## Decisions (judgment calls)

- **Default model: `eleven_v4`.** Fallback is `eleven_flash_v2_5`, used only for the last retry of a clip that keeps failing. The voice is `9lHjugDhwqoxA5MhX0az` (Anna Su). `eleven_v4` was not listed among the voice's verified models but works with it.
  - In the bake-off, `eleven_v4` was clearly best on isolated words: 20/25 pass, against 14/25 for `eleven_multilingual_v2` and `eleven_flash_v2_5`.
  - It reads polyphones and Taiwan readings correctly where v2/v2.5 did not:
    - 垃圾 lèsè: v2/flash said lājī.
    - 還 hái: v2 said huàn and flash said huán.
    - 長 cháng: v2/flash said chàng.
    - 要 yào: v2 said "yo"/yáo.
    - 想 xiǎng: v2 said shàng.
  - Simulating the retry chain on the bake-off data: v4 seed 0 → v4 seed 1 → flash gives 24/25 pass. v4 ×3 gives 21/25, and a v2-first chain gives 17/25.
  - **Known v4 weakness:** some isolated tone-1 single syllables come out as a mid-to-low fall instead of a high level tone. This happened for 他, 一 and 都, and was consistent across 3 seeds. The pitch QC catches it (suspect or fail). The flash fallback, which produces a level tone 1 for these, is there for exactly this case.
- **Sentences use the same model**, so the voice sounds the same on the word and sentence clips. All 5 models passed all 4 test sentences.
- **No `previous_text`/`next_text` context for word clips.** I tested the example sentence split around the word as context. It made every model worse: pass rates dropped from 20 to 10 (v4) and from 14 to 4 (v2). The models then:
  - leak neighbouring syllables into the clip (認識你, 你知道他, 的東西)
  - return near-silent fragments
  - apply sandhi or reduced forms

  `eleven_v3` rejects context entirely. Context is not billed, but it is harmful here.
- **Voice settings (other than v3):**
  - stability 0.75, similarity 0.75, style 0, speaker boost on
  - speed 0.9 for words and 0.95 for sentences. The voice's own default is 1.15, which is fast.
  - `language_code: "zh"` is sent for every model; the client retries without it if a model rejects it.

  Variants I tried on v4 were not better: speed 1.0 (18/25), stability 0.5 (17/25), a trailing "。" (19/25), and other seeds (19/25).
- **Seeds:** `seed = (crc32("w/<id>" or "s/<id>") + attempt × 104729) mod 2^32`. They are deterministic and recorded per attempt in `state.json`.
- **Audio format:** the API returns `pcm_24000`, and the script encodes it locally to **mono 24 kHz MP3, 48 kbps CBR** with PyAV/libmp3lame. No external ffmpeg is needed.
  - The credit cost is the same as requesting mp3 directly, and it avoids decoding and re-encoding a lossy file when trimming.
  - 48k is the knee:
    - At 40k and below, LAME's lowpass removes energy above 7 kHz. At 32k, only 5–40% of the >7 kHz energy is left. That matters for the s/sh/x and c/ch/q contrasts.
    - 64k adds about 30% to file size with no bandwidth gain.
  - Sizes: about 5 KB per word and 10–17 KB per sentence, so about 20 MB for all 2000 clips.
- **Silence trimming:** silence is trimmed only when it is longer than 200 ms (80 ms of padding plus a 120 ms margin). 80 ms of padding is kept and an 8 ms fade is applied. The threshold is -45 dB relative to the peak frame. v4 clips come back with only about 30–70 ms of lead and tail, so most clips are untouched.
- **Loudness:** the active-speech RMS is normalized to -20 dBFS, with peaks kept below -1 dBFS, so word clips, sentence clips and fallback-model clips play at the same level.
- **Regenerate on `suspect` as well as `fail`.** The task said only `fail`, but words cost about 0 credits, so being strict is nearly free. Use `--regen-on fail` to revert. Each clip gets at most 2 extra attempts, and the best attempt is kept, ranked by verdict and then score. Retries are capped at 3,000 credits in total.
- **Budget:**
  - Before each request, the worst-case per-character estimate is reserved.
  - After it, the actual `character-cost` header is charged, or the estimate if the header is missing.
  - The subscription endpoint is checked at start and every 40 requests. Because it lags, the tighter of two remaining balances is used: start balance minus spend, and latest balance minus spend since that check.
  - `--reserve` (2000) is never touched.
  - Once the budget is reached, no new requests start, the state and manifest are written, and rerunning the command continues the work.
- **Concurrency:** the account reports `maximum-concurrent-requests: 6` on Starter, but I kept the default at 3. The client retries 429, 5xx and network errors with exponential backoff and honours `retry-after`.
- **Idempotency:**
  - A clip's hash covers TTS text, model chain, voice settings, voice, format and pipeline version. Rank and QC thresholds are not in the hash.
  - A clip is skipped when the hash is unchanged, its mp3 exists, and it either passed or used up its attempts.
  - The manifest only lists clips whose text still matches the current `words.json`, so stale clips are dropped and the app falls back to speech synthesis.
- **Manifest `model` field:** this is the primary model. Per-clip models, including any fallbacks, are in `state.json`.

## QC (`qc.py`)

### Speech recognition (ASR)

- **Engine:** faster-whisper, `language="zh"`, beam 5, temperature 0, no VAD, with 0.3 s of silence padding.
- **Model choice:**

  | Model | Device | Time per clip | Notes |
  |---|---|---|---|
  | `large-v3` (float16) | CUDA (default) | ~0.25 s | used for scoring |
  | `small` (int8) | CPU (fallback) | ~1.5 s | about 50–60 min for 2000 clips, but often writes single syllables as Latin letters or digits |

  `medium` and `large-v3-turbo` were not better than large-v3 on the bake-off. All four models are in the default HF cache at `~/.cache/huggingface/hub`, outside the repo.
- **GPU setup:** CTranslate2's Windows wheel bundles cuDNN but not cuBLAS, so I installed `nvidia-cublas-cu12` into the venv. `qc.py` adds its DLL directory automatically. If CUDA fails, it prints a warning and falls back to CPU. **If the venv is ever rebuilt, `nvidia-cublas-cu12` must be reinstalled for GPU QC.**
- **Normalization:** OpenCC t2s, NFKC, and punctuation stripped. Known silence hallucinations ("字幕…", "订阅…") are dropped.
- **Numbers:** whisper writes numbers as digits ("这本书300块"). Each digit run is tried in three spellings and the closest one wins: digit by digit ("1" → 一), as a number with 二 (300 → 三百), and as a number with 兩 before 百/千/萬 (2000 → 兩千). The first run had reported 這本書三百塊 and 總共一百零五塊 as fails because "300" became 三〇〇.

### Word clips

ASR comparison runs in this order:
1. **Exact text match** → match.
2. **Tone-marked pinyin of the transcript vs. `pinyinNumbered`.**
   - Every pypinyin reading of each transcript character is allowed, so homophones pass.
   - Neutral tone 5 is a wildcard on either side.
   - Alignment is by edit distance:
     - same syllable with the same tone → match (a homophone)
     - same syllable with a different tone → `tone_mismatch`
     - equal only after folding the Taiwan mergers zh/ch/sh → z/c/s and -ing/-eng → -in/-en, with the right tone → `accent_match`, which is treated like `primed_match`. Whisper is trained mostly on mainland speech, so it writes 進 as 靜, 金 as 晶 and 站 as 讚 for this Taiwan voice. Folding never hides a tone error.
     - different syllables → `mismatch`
     - the word heard with up to 2 extra characters → `partial`
3. **Latin-only transcripts** ("E", "Sin", "BOOM") → `unclear`. They carry no evidence either way.
4. **A second, primed pass** runs whenever the first pass did not match. It uses `initial_prompt=` set to the word. If it then matches, the status is `primed_match`. In the bake-off this rarely changed the outcome; whisper usually repeats its first answer. So a mismatch that survives priming is strong evidence.

### Sentence clips

- The comparison uses the error rate `min(CER, toneless-pinyin error rate)`. The pinyin side is checked against the data's **Taiwan pinyin**: `example.pinyin` is split into syllables with a DP over valid syllables that respects apostrophes. pypinyin's mainland reading is used only as a fallback.
- Each transcript character may match any of its dictionary readings, not only pypinyin's reading in context. Before this change, 他的头发很长 for 她的頭髮很長 counted 长 as zhǎng and came out suspect.
- This catches 垃圾 read as lājī and heard as 拉機.
- Thresholds: error rate 0 → match, ≤ 0.12 → near (pass), ≤ 0.30 → suspect, otherwise fail.
- A sanity check flags speaking rates outside 1.2–9 characters per second.

### Pitch check (words only)

**Tracking:**
- Praat autocorrelation pitch tracking: 10 ms steps, 75–600 Hz.
- Outliers more than 8.5–9 semitones from the clip median are removed. Very low points are recorded as "creak", which counts as evidence for tone 3.

**Syllables:**
- Syllables are voiced runs, with gaps of 30 ms or less merged.
- When there are too many runs, the strongest n are kept.
- When there are too few, the longest run is split at its deepest intensity dip (at least 1.5 dB), or evenly if there is no dip.
- Each syllable core excludes the first 15% and the last 10%.

**Scores:** each tone gets a soft score from 0 to 1, built from the start, end, minimum, maximum and position of the minimum. The register is relative to `VOICE_MID_ST = 13.5` semitones re 100 Hz (about 218 Hz), calibrated on this voice: its tone 1 sits around 16–19 st, tone-3 lows around 6–9 st, and tone 4 starts at 16–20 st.

| Tone | What scores high |
|---|---|
| 1 | high and level |
| 2 | a rise, possibly after an early dip |
| 3 | reaches a low pitch: low level, low fall, dip, or dip-rise. No final rise is required (Taiwan style). |
| 4 | a fall from mid or high |
| 5 (neutral) | anything; neutral syllables are excluded from the score |

**Allowed realizations:**
- 3+3 sandhi lets the first syllable be 2.
- A non-final 3 may be 4-like (half-third).
- 不 before 4 may be 2.
- 一 before any tone may be 2 or 4.
- `spokenAs` tones are also accepted.

**Status:**
- Each syllable's score is the best score among its allowed tones; the word's score is the minimum over syllables.
- ok if ≥ 0.4, weak if ≥ 0.15, mismatch below that.
- Unvoiced or failed segmentation → unknown, which never fails a clip.

**Limits:**
- Tone 2 and tone 3 cannot be reliably told apart: a low-starting rise is also tone-3 compatible. So cháng vs zhǎng is not caught by pitch.
- Tone 4 vs tone 1 and tone 2 vs tone 4 are caught reliably.
- A word whose characters match but whose pitch does not is only `suspect`, because whisper barely hears tone. That pitch evidence is the only signal for Taiwan readings such as 垃圾 lèsè vs lājī.

### Combined verdict (words)

| Speech recognition result | Pitch ok or unknown | Pitch weak | Pitch mismatch |
|---|---|---|---|
| match | pass | pass | suspect |
| primed_match, accent_match | pass | suspect | suspect |
| tone_mismatch | suspect | fail | fail |
| partial, empty, or unclear | suspect | suspect | fail |
| mismatch | fail | fail | fail |

A word duration outside 0.15 s to (0.9 + 0.55 × syllables) s is always a fail. The score used to pick the best attempt is `0.6 × ASR + 0.4 × pitch`.

### Tests

The suite has 66 fast tests plus 1 slow one.
- **Synthetic contours:** harmonic signals with known pitch shapes, for each tone, wrong-tone rejection, two syllables with and without an unvoiced gap, and sandhi.
- **Real clips:** 17 bake-off clips saved in `tests/fixtures/`. 14 are known good. 3 are known bad: 垃圾 read as lājī by v2 and by flash, and v4's falling 他.
- **Other units:** transcript comparison (including accent folding and digits), number spelling, sentence comparison with numbers and polyphones, Taiwan-pinyin splitting, trimming, mp3 round trip, budget logic, clip hashing.

## Bake-off (2026-10-11)

- **Test set:** 25 words, listed in `bakeoff_set.py`. They are the polyphones, neutral-tone particles, sandhi words and Taiwan readings from the task, plus 4 sentences.
- **Spend:** 85 credits for the bake-off, including about 13 for initial API probes. The end-to-end runs and tests used another 20, so **105 credits in total**. The account is at 105/40000.
- **Raw results:** per-clip results are in `bakeoff-results.json`, scored with whisper large-v3, plus small's transcripts for comparison. The audio was deleted.

| Variant (words, n=25) | ASR exact or homophone | Pitch ok | QC pass | Header cost |
|---|---|---|---|---|
| eleven_multilingual_v2 | 15 | 16 | 14 | 6 |
| eleven_multilingual_v2 (seed 2) | 15 | 18 | 13 | 6 |
| eleven_multilingual_v2 + context | 7 | 12 | 4 | 6 |
| eleven_flash_v2_5 | 16 | 16 | 14 | 0 |
| eleven_flash_v2_5 (seed 2) | 15 | 14 | 14 | 0 |
| eleven_flash_v2_5 + context | 6 | 14 | 7 | 0 |
| **eleven_v4** | **22** | **21** | **20** | 0 |
| eleven_v4 (seed 2 / seed 3) | 19 / 20 | 22 / 21 | 19 / 19 | 0 |
| eleven_v4, text + "。" | 20 | 21 | 19 | 0 |
| eleven_v4, speed 1.0 | 21 | 19 | 18 | 0 |
| eleven_v4, stability 0.5 | 20 | 19 | 17 | 0 |
| eleven_v4 + context | 11 | 16 | 10 | 0 |
| eleven_v4_turbo (seed 1 / 2) | 19 / 21 | 20 / 20 | 17 / 19 | 0 |
| eleven_v4_turbo + context | 11 | 18 | 9 | 0 |
| eleven_v3 (no context support) | 19 | 18 | 14 | 6 |

**Sentences:** all 4 passed with zero error rate for every model. Header cost for the 4 sentences (41 characters) was:
- multilingual_v2: 17
- v3: 17
- flash: 8
- v4: 5
- v4_turbo: 1

**Whisper models on the same clips:** small writes "1", "E", "LOVE", "YO!" and "6" for single syllables, so it produces many more `unclear`/`mismatch` results than large-v3. large-v3-turbo and medium were similar to large-v3. In the v4 rows, the words that do not pass are:
- 他, 一, 都 (falling tone 1, see above)
- 還: whisper hears 嗨 hāi, while the pitch shows a clear rise
- 知道: pitch on the short second syllable

## Open issues / for human review

- **Isolated function words** such as 的, 了, 嗎 and 得 are spoken as single syllables. Their neutral tone carries no pitch evidence, so QC only checks the syllable. 嗎 alone comes out with a rising, question-like contour on v4. That is acceptable, but a human should listen.
- **一 on its own:** the expected citation reading is yī. v4 says it falling on every seed. The installed clip is from `eleven_flash_v2_5` seed 11, added with `--extra`, and it passes with a level tone.
- **Pitch thresholds** were calibrated on one voice and about 100 syllables. After the full run, the pitch check over-flags two cases:
  - short (≤ 110 ms) middle syllables
  - a tone-2 syllable right before a voiced initial (然, 麼, 來), where the syllable boundary seems to land inside the next syllable's low start
  
  I left the thresholds unchanged and recorded these cases as reviews instead, because loosening them would also hide real falling tone-1s. To change them, edit `tone_scores` or `PitchAnalyzer.check`, then run `rescore.py --all` (no credits).
- **`flags.json`** should be listened to by a human, ideally the user's wife. Start with the "listen" entries; the full run report below has a prioritized list.

## Full run report (2026-10-11)

### Totals

- **Coverage:** 1000 words × (word clip + example clip) = **2000 clips, all installed**. Every word has both clips, and no word is missing.
- **Manifest:** `src/data/audio-manifest.json` has 1000 entries. Every path exists on disk, and every mp3 in `public/audio/{w,s}` is referenced. Nothing else is in `public/audio`.
- **Idempotency:** a plain `generate.py --dry-run` now reports 0 clips to generate.
- **Size:** `public/audio` is **16.0 MB**: words average 5.2 KB and sentences 10.9 KB. That is well under the ~60 MB threshold, so I kept 48 kbps.
- **Models of the installed clips:**

  | Model | Word clips | Sentence clips |
  |---|---|---|
  | `eleven_v4` | 859 | 997 |
  | `eleven_flash_v2_5` (fallback) | 122 | 3 |
  | `eleven_v3` (added with `--extra`) | 12 | 0 |
  | `eleven_multilingual_v2` (added with `--extra`) | 7 | 0 |

### QC results (after re-scoring every attempt with the final `qc.py`)

| | Pass | Suspect | Fail |
|---|---|---|---|
| Words | 954 | 45 | 1 |
| Sentences | 999 | 1 | 0 |
| **Total** | **1953** | **46** | **1** |

- All 47 flagged clips have a review note in `reviews.json`, which is copied into `flags.json`:
  - **35 `ok`:** QC is likely a false alarm.
  - **12 `listen`:** these are plausibly wrong.
- For comparison, the first pass had 121 flagged clips (110 suspect, 11 fail).

### Credits

- **Subscription endpoint:** 1240/40000 used after the run, against 105 before, so this task spent **1135 credits** in total. 38,760 remain.
- **Breakdown:**
  - main run: 1046 credits (2506 requests, of which 46 credits were retries; 17.8 min)
  - re-tries and `--extra` attempts: about 87 credits, almost all for `eleven_v3`/`multilingual_v2` attempts on words
  - a scratch model experiment: 2 credits
- **Rates:** words on v4 and flash cost 0 credits, and sentences cost about 1 credit each. The 15,000 budget was never close.

### What I changed after the first pass

**QC false alarms fixed in `qc.py`.** I re-scored with `rescore.py`, which spends no credits.
- Numbers written as digits.
- Per-character readings in sentence pinyin (她/他, 長 in 很長).
- Taiwan accent folding for words (`accent_match`).

These fixed 8 sentence clips plus 金 and 站.

**Polyphone misreads fixed with homophone TTS text** (`overrides.json`; QC still checks the real word):

| Word | Problem | TTS text |
|---|---|---|
| 隻 zhī | v4 read it as 只 zhǐ | 知 |
| 教 jiāo | read as jiào | 交 |
| 待 dāi | read as dài | 呆 |
| 數 shǔ | read as shù | 鼠 |
| 和 hé | read as hè | 河 |
| 字 zì | whisper heard other syllables on every seed | 自 |
| 沒 méi | low tone 2 | 梅 (the pitch is now a clear rise) |

- After the override, all except 沒 pass.
- 腕 for 萬, 沙 for 殺, 衣 for 一, 今 for 金 and 圖然 for 突然 did not help, so I removed them.
- Adding "。" or "！" to a word changed nothing on v4: same contour, same QC result.

**`--retry-flagged`** (3 more seeds each) on all flagged words fixed 35 more.

**`--extra` with other models** on words where v4 kept failing:
- Isolated tone-1 syllables fall on v4 with every seed (他, 一, 喝, 傷, 低, 逼, 殺, 飛). Text tweaks do not change this.
- `eleven_flash_v2_5`, `eleven_v3` or `eleven_multilingual_v2` produced passing clips for most of them. Those clips are installed, so 19 word clips use a non-v4 model (listed in `state.json`). They are the same voice, but the timbre may differ slightly from the v4 sentences.

### Clips a native speaker should listen to (priority order)

Each audio file is `public/<path>` from `flags.json`/the manifest.

1. **w6c92 沒 méi** (rank 40): whisper hears 美 měi on every attempt, but the pitch rises from low. Check that it does not sound like měi. The TTS text is the homophone 梅.
2. **w4ec0-9ebc 什麼 shén me** (rank 22): ASR is exact on all 19 attempts across 4 models, but 什 never rises in pitch. This is probably normal fast speech, but it is a top-25 word.
3. **w5594 喔 ō** (rank 132): every attempt falls (ò), while the data says ō. Taiwan colloquial 喔 is often ò. Decide which reading to teach, and fix the data or the audio to match.
4. **w7a81-7136 突然 tú rán** (rank 669): the first syllable falls on all 19 attempts across 5 models. That is probably a QC segmentation artifact, but it could be tù.
5. **w7a2e 種 zhǒng** (rank 241): whisper hears 中. The contour starts high and only dips through creak, so it could be zhōng or zhòng.
6. **w8b1b 講 jiǎng** (rank 423): whisper hears 醬 jiàng. The fall stops short of the usual tone-3 low, and there is 150 ms of extra voiced sound.
7. **w624d 才 cái** (rank 108) and **w883b 蠻 mán** (rank 623): whisper hears tone 3 (彩, 滿). The rise starts very low, and the pitch check cannot tell tone 2 from tone 3.
8. **w897f 西 xī** (rank 811): only the flash fallback gave a level tone; the v4 attempts fell.
9. **w9060 遠 yuǎn** (rank 531): whisper hears 愿. There is an extra 150 ms voiced segment.
10. **Spot check of the homophone-text clips:**
    - 和 (TTS text 河)
    - 隻 (知)
    - 教 (交)
    - 待 (呆)
    - 數 (鼠)
    - 字 (自)

    Also listen to one or two non-v4 word clips to check that the timbre matches, for example 喝 (`eleven_v3`) and 傷 (`eleven_multilingual_v2`).
11. **Low priority:** 差不多 (差 nearly flat) and 其中 (其 short and flat). Both have exact ASR.

The 35 `ok` clips need no listening unless there is time. Their reasons are in `reviews.json`. Most are isolated syllables that whisper writes with the wrong tone or as English, such as "B", "C", "Go", "Ciao" and "1" for wàn ("one"), while the pitch contour fits the expected tone.
