# Decisions and open questions

PLAN.md asks for one place that lists the judgment calls and everything flagged for human review. This file is that index. The detailed reasoning lives next to the work, so each item links to its source:

- [`data/NOTES.md`](data/NOTES.md): word selection and enrichment, chunk by chunk, with every accepted or rejected review finding.
- [`data/AUDIT.md`](data/AUDIT.md): the final audit of `src/data/words.json`, including the list of readings for a native speaker to check.
- [`scripts/audio/NOTES.md`](scripts/audio/NOTES.md): voice bake-off, model choice, QC thresholds, credit budget.
- [`docs/app-notes.md`](docs/app-notes.md): app architecture and every app-side judgment call (scheduler, store, UI, PWA, deploy).

## Where the app differs from PLAN.md

| PLAN.md says | What was decided | Why |
|---|---|---|
| Two Taiwan voices (female and male), alternated per word, with a voice setting | **One voice**: ElevenLabs "Anna Su" (`9lHjugDhwqoxA5MhX0az`) for every word and sentence; no voice setting | Chosen by the user after the voice bake-off (`scripts/audio/NOTES.md`). |
| Working-set cap "about 12 words"; stable at "about 3–7 days" | **`workingSetCap` 30, `stableDays` 5** (both settings) | The 60-day simulation showed the original 15 / 7 gave only 1.5–4 new words a day (`docs/app-notes.md`, "Simulation results"). The user picked 30 / 5. |
| New words pause while there is a backlog | Explicit **backlog gate**: no new word while more than `backlogLimit` (10) reviews are due | Makes "a backlog only means reviews" testable; checked on every pick in the simulation. |
| The gate introduces the next *word* | A full working set still lets in the **Say card of a word already in it** | It adds no word to the set; blocking it only delayed Say practice by days. |
| Say reveal "auto-plays audio and the example" | Say reveal autoplays the **word only**; the example has its own button (E key) | Keeps the pace fast; see "Study screen" in `docs/app-notes.md`. |
| Word list simplified characters only | The word **detail** page also shows simplified when it differs | Requested by the words task; the list itself is unchanged. |
| Audio: `scripts/audio-flags.json` | `scripts/audio/flags.json` (written by the full generation run) | Kept with the other audio files. |

Other notable calls (details in `docs/app-notes.md`): FSRS-6 with short-term steps 1m/10m and deterministic fuzz; "I already know this" = Easy on both cards (back in about a week); learning cards are shown early only when nothing else is available, picked at random weighted toward the most elapsed step; recent-card rules (never the same card twice, avoid the other direction within 3 cards); event-sourced log with merge-by-id import; hash routing for GitHub Pages; audio cached on first play, not precached.

## For a human to review

Word data and readings (most are questions for a native Taiwan speaker; the full list is in [`data/AUDIT.md`](data/AUDIT.md), "For a native speaker"):

- **和**: the data uses **hé** and the note mentions the colloquial Taiwan **hàn** (PLAN suggested hàn). Which does the learner's wife say?
- **力量 / 早上**: switched to the MOE neutral tones (lì liang, zǎo shang, like 晚上 wǎn shang). The full tones may be more common in Taiwan. If full tones are chosen project-wide, 晚上 and the wǎnshang / zǎoshang example spellings change too (`data/NOTES.md`, chunk 14 review).
- **Proposed neutral-tone rule**: follow MOE neutral tones unless CEDICT has the full tone *and* MOE's own parallel words do too (so 上面 shàng miàn and 家裡 jiā lǐ keep full tones). Confirm or replace (`data/NOTES.md`).
- **Capitalized proper-noun headwords** (美國 Měi guó): headword pinyin is otherwise lowercase; this is a deliberate display convention (`data/NOTES.md`).
- **Licensing**: the glosses draw on CC-CEDICT, so `src/data/words.json` is declared **CC BY-SA 4.0** (README, Settings > About). SUBTLEX-CH is research-use and cited. MOE data is CC BY-ND 3.0 TW and only factual reading fields are used. Please confirm this is acceptable for a public site.

Audio:

- **The recordings have not been generated yet.** `src/data/audio-manifest.json` is empty, so every word currently plays through the browser's built-in voice. Run `scripts/audio/generate.py --dry-run`, then the full run (expected about 1.5–2.5k ElevenLabs credits), and commit `public/audio/`, the manifest and `scripts/audio/flags.json`. The deploy workflow refuses to publish until the manifest covers 99% of the clips (`scripts/check-audio.mjs`).
- After the run, someone (ideally the learner's wife) should listen to every clip in **`scripts/audio/flags.json`**, plus isolated particles such as 嗎 (`scripts/audio/NOTES.md`, "Open issues").

App:

- Defaults 30 / 5 are a guess from an idealised simulation; real intake may be lower. Both are settings.
- Desktop at short window heights: the sticky grade bar can cover the bottom of a long answer until you scroll (`docs/app-notes.md`, "Open items").
