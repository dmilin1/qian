# qian — build plan

A flashcard SPA for learning the 1000 most common Mandarin words by **ear**. Built for one learner who speaks conversational Mandarin (learned from a Taiwanese speaker), cannot read, and does not want to learn to read.

## Priorities (in order)
1. Audio. Every card is built around hearing the word.
2. Pinyin with tones. It's the visual aid for tones.
3. English meaning.
4. Characters. Shown but de-emphasized (small, muted). Never the focus.

## Stack
- React + Vite + TypeScript, Tailwind for styling.
- Vitest for unit tests and Playwright for end-to-end tests.
- `ts-fsrs` for scheduling and `idb` (or Dexie) for IndexedDB. Use `vite-plugin-pwa` for offline/installable.
- Only popular, well-maintained packages. No obscure dependencies.
- Static hosting on GitHub Pages, deployed via a GitHub Actions workflow. Set the Vite `base` to the repo name.

## Locale: Taiwan Mandarin
- Traditional characters (zh-TW). Simplified can be shown in the word list only.
- Vocabulary uses Taiwan usage: 計程車 not 出租车, 腳踏車, 鳳梨, 馬鈴薯, and so on.
- Pinyin follows Taiwan standard readings: 垃圾 lèsè, 星期 xīngqí, 和 hàn (conjunction, colloquial; note the alternative), fewer neutral tones, little erhua. Cross-check against the MOE dictionary (moedict / g0v data) where possible.
- Pinyin shows dictionary tones. Where speech differs (3rd-tone sandhi, 不/一 changes), show a small "spoken as" hint.

## Data pipeline (build-time scripts in `scripts/`; outputs committed to `public/`)
1. **Frequency list.** Start from SUBTLEX-CH (spoken/subtitle corpus); fall back to `wordfreq` if the download fails. Convert to Taiwan usage (OpenCC `s2twp`). Remove proper nouns and segmentation junk. Merge words that collapse to the same entry. Keep the top 1000 in rank order.
2. **Enrichment per word** (JSON):
   - `id`: a stable slug that never changes, even if rank changes.
   - `rank`, `trad`, `simp`, `pinyin` (tone marks), `pinyinNumbered`.
   - `gloss`: short English. `hint`: disambiguator for the English→Chinese card, e.g. "to know (a person)" for 認識 vs "to know (a fact)" for 知道.
   - `pos`, `note` (required for grammar words like 了, 吧, 呢, 的, 個), `spokenAs` (sandhi hint, optional).
   - `example`: `{ trad, pinyin, english }`. Natural, short, conversational Taiwan Mandarin using common words.
3. **Verify enrichment adversarially.** Independent agents check pinyin (especially polyphones: 還, 行, 得, 了, 長, 重, 覺, 為, 都, 地…), gloss accuracy, hint uniqueness (no two words share an identical English prompt), and sentence naturalness and correctness. Fix disagreements; log unresolved items in `DECISIONS.md`.
4. **Audio via ElevenLabs.** The API key comes from `.env.local` (`ELEVENLABS_API_KEY`). It is gitignored and **never** bundled into the app.
   - Two Taiwan-accent voices (one female, one male), alternated per word in the app. Word clip + example sentence clip per voice.
   - Use a model with language-code support for Chinese; where pronunciation control (alias/phoneme rules) works, use it for polyphones.
   - QC every clip:
     - transcribe with ElevenLabs Speech-to-Text and confirm the expected word/sentence;
     - for single words, check pitch contour against expected tones (e.g. `praat-parselmouth`).
     - Regenerate failures (up to N tries, keep the best); log anything still failing to `DECISIONS.md` and `scripts/audio-flags.json`.
   - The script is resumable and idempotent: it skips existing good clips and stays within a credit budget.
   - Output: compact mp3s in `public/audio/`, plus a manifest.
5. A fallback to browser `speechSynthesis` (zh-TW voice) if a clip is missing.

## Cards
Two cards per word, scheduled independently.
- **Listen (中→EN):** the front auto-plays audio and shows pinyin + characters. A setting makes it **audio only**. Reveal shows English, hint, note, example sentence (with play button).
- **Say (EN→中):** the front shows English + hint. Reveal shows pinyin (large, tone-colored), characters (small), and auto-plays audio and the example.
- Replay button always visible. Slow-playback button (playbackRate ~0.7, pitch preserved).
- Grading: **Again / Good / Easy** (3 buttons, mapped to FSRS Again/Good/Easy). The first exposure of a word also offers **"I already know this"**, which schedules it far out but still checks it eventually.
- Keyboard shortcuts on desktop (space = reveal/replay, 1/2/3 = grade, R = replay, Z = undo). Large tap targets on mobile.
- Undo last grade. "Flag this card" (bad audio / wrong pinyin / bad gloss), exportable as a list.

## Scheduling — no daily quotas
- FSRS computes each card's stability and current recall probability (retrievability).
- **Endless session.** The next card is sampled from a distribution weighted toward the lowest retrievability (most at-risk first, with mild randomness so order isn't predictable). Avoid showing a word's other direction back to back.
- **New words enter by mastery, not by calendar.** Keep a working set of "unstable" cards (in learning/relearning, or stability below a threshold of about 3–7 days). When the unstable count drops below a cap (setting; default about 12 words), the next word by frequency rank is introduced. Missing days never causes a flood: a backlog only means reviews, and new words pause until the backlog clears.
- Introduce the Listen card first. The Say card becomes eligible once Listen has graduated from learning.
- When nothing is at risk and the working set is full, show "caught up" with an option to keep practicing (practice-ahead on least-stable cards).
- Target retention setting (default 0.9).

## Data model (event-sourced)
- The source of truth is an append-only review log in IndexedDB: `{ id (uuid), wordId, dir: 'listen'|'say', grade, ts, deviceId }`.
- Card state is derived by replaying the log through FSRS and cached; the cache can always be rebuilt.
- Settings and the last-used UI state go in localStorage. The schema is versioned with migrations.
- **Export/import now.** Export a JSON file (log + settings + flags + schema version). Import merges by unioning the logs (dedupe by review id) and replaying. Merging between devices is therefore safe.
- Call `navigator.storage.persist()`. Nudge to install as a PWA on iOS (Safari evicts storage after 7 days otherwise) and remind the user to export periodically.

## Stats
- Progress through the 1000 words (unseen / learning / known / mature), per direction.
- Daily review heatmap, streak, time studied.
- Accuracy over time, Listen vs Say.
- Forecast of upcoming reviews.
- Word list: searchable/sortable, per-word history, replay audio, suspend/unsuspend, flagged items.

## Other
- Dark mode (follows system). Mobile-first layout that also works on desktop.
- PWA: installable and offline, with audio cached.
- Settings: audio-only Listen front, characters on/off, tone colors on/off, voice (female / male / alternate), working-set cap, target retention, autoplay on/off.

## Verification before calling it done
- Unit tests: scheduler, introduction gating, log replay, import merge (including duplicate/out-of-order logs), migrations.
- Playwright: full study flow on mobile and desktop viewports, audio element triggered, reveal/grade/undo, export → clear → import roundtrip, stats render. Screenshots saved to `docs/screenshots/`.
- `npm run build` is clean, there are no TypeScript errors, and the production build works under the GitHub Pages base path.
- `README.md` covers running locally, regenerating data/audio, and deploying. `DECISIONS.md` lists every judgment call and anything flagged for human review.
