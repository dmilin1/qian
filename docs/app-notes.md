# App domain layer (`src/lib`): API and notes

## Public API (for UI agents)

Import from `src/lib` (barrel `src/lib/index.ts`) or from the individual modules.

### Store: `store.ts` + `useAppStore.ts`
```ts
const store = getAppStore()          // app-wide singleton; call `await store.init()` once at startup
const snap = useAppSnapshot()        // React: useSyncExternalStore over the store
```
`AppSnapshot` (immutable; a new object on every change):
- `ready`, `error` (non-fatal message to show, e.g. "storage unavailable"), `deviceId`, `settings`
- `current: StudyCard | null`: the card to show. `{ key, wordId, dir: 'listen'|'say', word: Word, source, isNew, canMarkKnown, previews: { again|good|easy: { label: '10m', ms, due } }, shownAt }`
- `queue: QueueInfo`: `{ unstableWords, dueReviews, learningDue, learningPending, introducedWords, gateOpen, gateBlockedBy: 'workingSet'|'backlog'|'exhausted'|null, nextLearningDueAt, nextReviewDueAt }`. When `current` is null you are "caught up": show the reason and offer practice-ahead.
- `derived` (card states, see below), `events` (sorted log), `practiceAhead`, `canUndo`, `persistence` ('unknown'|'granted'|'denied'|'unsupported'), `lastExportAt`

Actions (all update in memory synchronously, then persist to IndexedDB):
- `grade(cardKey, 'again'|'good'|'easy', elapsedMs?)`: logs a review and advances `current`
- `markKnown(wordId)`: "I already know this" (only offered when `current.canMarkKnown`)
- `undo()`: deletes the most recent answer (review/known) given in this session, up to 20 back, and puts that card back as `current`. Disabled right after a suspend/unsuspend and after a reload.
- `setSuspended(wordId, bool)`, `flag(wordId, reason, note?)`, `resolveFlag(wordId, reason)`
- `updateSettings(patch)`: validated and clamped; changing `requestRetention` re-derives every card
- `setPracticeAhead(bool)`: when caught up, keep going with the least-retained cards
- `next()`: re-pick the current card. While caught up, the store also re-picks on its own: on a timer when the next card falls due (re-checked at least hourly), and when the page becomes visible again (`visibilitychange`, `focus`, `pageshow`).
- `peekNext()` (pure query), `previews(cardKey)`
- `exportData({ record? })` returns `{ filename, text, exportedAt }`. Pass it to `downloadText(filename, text)`. It also records `lastExportAt` unless `record: false`; in that case, call `markExported(exportedAt)` once the file was really saved. UI code should use `saveBackup(store, 'download' | 'share')` from `features/settings/backup.ts`.
- `importData(fileOrText, 'merge'|'replace')` returns `{ added, duplicates, skipped, total }` and throws `ImportError` with a user-readable message
- `resetAll(keepSettings = false)`, `requestPersistence()`. `navigator.storage.persist()` is also requested automatically on the first grade of a session.

### Audio: `audio.ts`
```ts
const player = getAudioPlayer()          // one shared <audio> element
player.slowRate = settings.slowRate
await player.play(wordId, 'word' | 'example', { slow })   // resolves when playback ENDS
// result: 'clip' | 'tts' (speechSynthesis fallback) | 'blocked' (autoplay refused, needs a tap) | 'failed' | 'stopped'
player.preload([nextWordId])
player.stop()
useAudioUnlocked(player)                 // false until the first user gesture (or a successful play)
```
To play a word and then its example, chain the calls: `const r = await player.play(id, 'word'); if (r === 'clip' || r === 'tts') await player.play(id, 'example')`. Calling `play()` stops whatever was playing first, and the earlier promise resolves with `'stopped'`.

### Words: `words.ts`
`getWords()` returns `{ list (rank order), order (ids), get(id), has(id), indexOf(id) }`. `getManifest().path(id, kind)`. `resolveAudioUrl(path)` joins against `import.meta.env.BASE_URL`.

### Stats: `stats.ts` (pure; pass `snap.derived` / `snap.events`)
- `progressCounts(derived, words.order)` returns `{ listen, say, words }`, each with `{ unseen, learning, young, mature, suspended }`
- `dailyReviewCounts(events)` returns a `Map<'YYYY-MM-DD', n>` for the heatmap
- `streak(daily, now)`, `accuracyByWeek(events)`, `timeStudiedMs(events, since?)`, `dailyTimeStudiedMs(events)`
- `forecast(derived, now, 14)`, `wordHistory(derived, id)`, `wordSummary(derived, id)`, `cardStatus`, `wordStatus`
- Flags: `openFlags(derived)`, `allFlags(derived)`, `flagsToCsv(flags, id => words.get(id))`

### Lower level
- `events.ts`: event types, `cardKey(wordId, dir)` (`"wordId:dir"`), `makeReview/makeKnown/makeSuspend/makeFlag`, `sanitizeEvent`, `compareEvents`
- `derive.ts`: `buildDerived(events, retention)`, `withEvent`, `withoutEvent`, `getCard(derived, wordId, dir)` returns `CardState | undefined` (undefined = new). `CardState.card` is a ts-fsrs `Card` (`state`, `due`, `stability`, `difficulty`, `reps`, `lapses`, `last_review`).
- `scheduler.ts`: `selectNext(...)`, `previewIntervals`, `formatInterval`, `unstableWordCount`, `dueReviewCount`, `newCandidates`, `mulberry32`
- `settings.ts`: `DEFAULT_SETTINGS`, `SETTING_RANGES` (for sliders), `loadSettings/saveSettings/validateSettings`
- `db.ts`: `openQianDb`, `MIGRATIONS`, `loadEvents/putEvents/deleteEvent/replaceEvents`, `getMeta/setMeta`, `getOrCreateDeviceId`

## Judgment calls

- **FSRS config**: ts-fsrs 5.4.2 (FSRS-6) with default weights, `enable_short_term: true` (learning steps 1m and 10m, relearning 10m), and `enable_fuzz: true`. Fuzz is seeded from (previous review time, reps, D×S), not ts-fsrs's default (review millisecond), so it is deterministic under replay and button previews match what grading schedules (see Review fixes (core)). Day boundary: local 4am, not UTC midnight (see Review fixes (core)). Tests check this: the same log replayed twice, shuffled, or reversed gives identical states.
- **Retrievability** for weighting and due checks uses fractional elapsed days. ts-fsrs's own `get_retrievability` floors to whole days, which would treat every card reviewed today as R=1.
- **Event order** is (ts, id). The store stamps local events with strictly increasing timestamps (`max(now, last+1)`, using this device's events only), so two actions in the same millisecond, such as flag then resolve, cannot swap places on replay.
- **Incremental derivation**: a card's state depends only on the events of its own word. An appended event is applied in O(1). An out-of-order event or an undo replays only that word. Import and a retention change rebuild everything. Measured in vitest/jsdom: full replay of 100k events takes about 1.1 s, and an incremental append with 100k events in the log takes about 0.7 ms.
- **"known"** is FSRS Easy at that ts on both cards. With default weights this gives about 8 days of stability, so the word is "stable" immediately (when `stableDays` <= 8; the Settings slider says so) and comes back in about a week. It is offered only when the word's listen card has never been graded (`canMarkKnown`), and never for a newly introduced say card.
- **Say-card eligibility**: the listen card has state Review or Relearning, meaning it graduated at some point. A later lapse does not take the say card back.
- **New-card priority**: eligible say cards (by rank) come before the next unseen word's listen card. Both go through the backlog gate. The working-set cap limits new *words*: when the set is full, only Say cards of words already in it may start (they add no word). Words suspended before they were introduced are skipped. Introduction stays strictly in rank order.
- **Due review** = state Review and `card.due <= now`. That one definition drives the queue, the backlog gate (`> backlogLimit` closes it), `nextReviewDueAt` (store timer, "Next card in"), and the stats forecast. An earlier version also counted cards with R <= requestRetention, which cancelled the upper half of fuzz and disagreed with the timer and forecast (see Review fixes (core)).
- **Interleaving**: when both due reviews and a new card are available, the new card is chosen with probability 0.25 (`newRatio`). Reviews are sampled with weight (1-R)^2. Reviews and practice candidates are sorted by key before sampling, so a seeded RNG gives reproducible picks.
- **Repeat rules**: there are three levels. (1) Not the last card, and not the sibling of any of the last 3 cards. (2) Not the last card. (3) Only if the card is actually due (a learning step or a due review): the last card again. Level 3 prevents a deadlock when a single card is the whole active set. The recent list comes from the tail of the log (a known event counts as both cards), so it needs no extra state and survives reloads.
- **Learning cards early**: if nothing else is available (no due learning, no due review, gate closed or no new cards), a pending learning card is shown early. It is a weighted random pick (weight = fraction of its current step elapsed, squared), skipping the last 5 cards shown while another is available, so a run of introductions is not replayed in the same order. Only cards due within `EARLY_LEARNING_MS` (60 s) qualify: ts-fsrs advances learning steps by count, not elapsed time, so an earlier review would skip the 1m/10m steps. Otherwise the caught-up screen counts down to `nextLearningDueAt`.
- **Practice-ahead** samples Review-state cards only, with weight (1-R)^2. It runs only after all normal sources are empty, so due work always takes priority.
- **Undo** deletes the most recent review/known event graded in this session (store-local list, max 20), from the log and from IndexedDB. If another device already has the event, a later merge brings it back, which is accepted.
- **Flags**: a flag event with `resolved: true` resolves every earlier open flag with the same (wordId, reason). The `resolveFlag(wordId, reason)` API follows this.
- **Import**: malformed individual events are skipped and counted (`skipped`). A wrong top-level shape, a non-qian file, or a schemaVersion higher than ours is rejected with an `ImportError`. On an id collision the local copy wins. In merge mode local settings are kept. Replace mode adopts the file's settings and log.
- **resetAll** clears events and `lastExportAt` and keeps the deviceId. By default it also resets settings.
- **Stats**: days are local calendar days with midnight as the boundary. Heatmap and streak count review and known events. Accuracy uses reviews only, with again counted as wrong and good/easy as right, in weeks starting Monday. A word's status is unseen if neither card has been seen, learning if either card is learning, mature if both cards are mature (S >= 21 d), and young otherwise. Suspended words are counted separately. The forecast puts overdue cards in day 0.
- **Audio**: one shared `<audio>` element. On the first pointerdown/keydown/touchend it plays a silent WAV and an empty utterance, which unlocks iOS. A `NotAllowedError` sets `unlocked=false` and re-arms the gesture listener. A missing clip or a load error (any other `play()` rejection, or an `error` event) falls back to speechSynthesis with `lang zh-TW`. Voice preference: names matching Taiwan/HsiaoChen/HsiaoYu/Meijia/Hanhan/Yating/Zhiwei within zh-TW, then any zh-TW, then zh-*/cmn. TTS rate is 0.9, or 0.9 × slowRate for slow playback. A 15 s safety timeout covers browsers that never fire `onend`. Slow clips use `playbackRate = slowRate` with `preservesPitch` (and the webkit prefix).
- **Settings ranges**: slowRate 0.5–1, requestRetention 0.7–0.97, workingSetCap 1–100, stableDays 1–60, backlogLimit 0–500. Out-of-range numbers are clamped. Invalid types fall back to the previous or default value. Settings are stored as `{ v: 1, settings }` under `qian.settings`.
- **Unknown word ids** in the log, such as words dropped from a later words.json, are kept in the log and in exports but are never scheduled (`includeWord` filter).

## Simulation results (60 days, learner recalls with probability = FSRS R)

Model: about 8–16 s per card, starting 08:00. New cards are recalled with p=0.6. 10% of correct answers are graded Easy. 5% of first appearances are "I already know this". "Endless" means the learner does N cards a day and practises ahead when caught up. "Stop" means the learner stops as soon as the app says caught up. Averages over 3 seeds. Numbers come from `src/lib/__fixtures__/simulate.ts`.

| workingSetCap | stableDays | session | words introduced by day 60 | words/day overall | words/day, days 30–59 | reviews/day | accuracy | max unstable |
|---|---|---|---|---|---|---|---|---|
| 15 | 7 | endless, 150/day (original defaults) | 230 | 3.8 | 3.1 | 150 | 97% | 20 |
| 15 | 7 | endless, 60/day | 172 | 2.9 | 2.1 | 60 | 93% | 19 |
| 15 | 7 | stop when caught up | 92 | 1.5 | 1.3 | 18 | 86% | 18 |
| 15 | 3 | endless, 150/day | 351 | 5.8 | 4.8 | 150 | 94% | 20 |
| 15 | 3 | stop when caught up | 184 | 3.1 | 2.8 | 34 | 87% | 21 |
| 25 | 7 | endless, 150/day | 325 | 5.4 | 4.2 | 150 | 95% | 29 |
| 25 | 7 | stop when caught up | 157 | 2.6 | 2.3 | 30 | 87% | 28 |
| **30** | **5** | **endless, 150/day (current defaults)** | **426** | **7.1** | **5.6** | 150 | 93% | 35 |
| **30** | **5** | **stop when caught up (current defaults)** | **235** | **3.9** | **3.1** | 56 | 89% | 33 |
| 40 | 7 | endless, 150/day | 445 | 7.4 | 5.3 | 150 | 93% | 46 |

Main test run (defaults, seed 2026, endless 150/day, days 35–39 off): 211 words introduced. Before the break the learner averaged about 3 new words a day. On the first day back, 15 reviews were due (above backlogLimit 10), so the gate stayed closed until they were done. The day then introduced 8 words, which is bounded by the free working-set slots. Lapses then pushed the unstable count to 18, and the next 3 days introduced 0 words. The 5-day average after the break is no higher than before it. Calendar quotas would have produced a catch-up burst; there was none. No new word was ever introduced while `unstableWords >= workingSetCap` or `dueReviews > backlogLimit`. The test checks this on every pick.

Observations:
- **The original 15 / 7 defaults gave slow intake, so the defaults were raised to 30 / 5** (the user's choice). The two bold rows were re-measured on 2026-10-11 after the review fixes (Say cards past a full working set, early learning cards limited and randomised, due = card.due); the other rows predate them. With 15 / 7: about 1.5 words/day for a learner who stops when caught up, and about 3–4 words/day even at 150 cards/day. At that pace the 1000 words take 9–24 months. Most of an endless 150-card day is practice-ahead. Practice-ahead does help (2.5× the intake), because reviewing a card a day or more early still raises its stability. The bottleneck is the time it takes FSRS to get both cards of a word to S >= 7 days, which needs about 2 successful reviews days apart per card. Raising `workingSetCap` (25–30) or lowering `stableDays` (3–5) roughly doubles intake while accuracy stays at or above 87%. Both are settings.
- `maxUnstable` runs a few above the cap because stable cards that lapse rejoin the working set. The cap only gates introductions.
- The simulated learner is idealised (perfectly calibrated R). Real intake will likely be lower.

# UI shell and design system (`src/components`, `src/App.tsx`, `src/index.css`)

## How to use (for feature agents)
Import everything from `src/components` (barrel `index.ts`).
- **Pages** are default exports at `src/features/{study,words,stats,settings}/…Page.tsx` (the current ones are placeholders). The route table is in `src/components/routes.tsx`: `/`, `/words`, `/words/:id`, `/stats` (lazy: recharts stays out of the main bundle), `/settings`, and `*` redirects to `/`. `src/App.tsx` builds the **hash** router (`/qian/#/words`). Tests use `createMemoryRouter(routes)`.
- **Layout**: `AppShell` renders a top bar at `sm` (640px) and up, and a bottom tab bar below that. It provides a centered column `max-w-content` (34rem = 544px) with `px-5`, the store `error` banner, and a spinner until `snap.ready`. `<main>` is a flex column, so a page can use `flex-1` to fill the height, for example to pin the grading buttons to the bottom. The tab bar's height (`--tabbar-h`) and the safe-area insets are already in main's bottom padding. The shell sets `document.title` per section; use `usePageTitle()` for something more specific.
- **Hooks**: `useSnapshot()`, `useSelector(fn)`, `useSettings()`, `useSettingsState()` returns `[settings, update]`, `useStore()` gives the actions, `useAudioPlayer()`, `useIsAudioUnlocked()`. All of them read `AppProvider`'s context and fall back to the singletons.
- **Audio**: start playback with `playClip(player, wordId, kind, { slow })`, not `player.play()`, so every `AudioButton` for that clip lights up, autoplay included. It resolves like `player.play()`. Use `stopPlayback(player)`, `useIsPlaying(id, kind, slow?)` and `useNowPlaying()`. `AudioButton` props: `wordId`, `kind`, `slow`, `size: sm|md|lg|hero`, `emphasis: primary|quiet`, optional `children` for a visible label, and `onResult` (for example, show a "tap to play" hint on `'blocked'`). Tapping during playback restarts the clip. `AppProvider` keeps `player.slowRate` in sync with settings.
- **Pinyin**: `<Pinyin word={w} size="hero" />` uses the citation `tones`. `<Pinyin text={w.example.pinyin} />` detects tones per syllable from the tone marks, including words written without spaces (`péngyǒu`). Sizes are `hero|xl|lg|md|sm`. It follows `settings.toneColors`, or pass `toneColors` to override. The pure helpers `segmentPinyin`, `splitSyllables` and `toneOf` are exported.
- **Hanzi**: `<Hanzi word={w} />` is muted and renders nothing when `showCharacters` is off. Pass `force` to show it anyway (word list/detail) and `showSimp` for simplified (word list only).
- **Other components**: `Button` (`variant: primary|secondary|ghost|danger`, `size: sm|md|lg|xl`, `icon`, `iconRight`, `iconOnly` + `aria-label`, `block`, `trailing`, which is handy for `<Kbd>`), `buttonClasses()` (to style a router `<Link>` like a button), `Card` (`padding`, `tone: raised|flat|sunken`, `animate: fade|rise|flip`; give it a new `key` per card/side to replay the animation), `Modal` and `ConfirmDialog` (native `<dialog>`), `Toggle` (role=switch row), `Select` (native), `SegmentedControl` (radio group with arrow keys), `Slider` (pair with `SETTING_RANGES`), `StatTile`, `EmptyState`, `Banner`, `PageHeader`, `Spinner`, `Kbd`, `Icon` (inline SVG, `name` + optional `label`), `Logo`/`SealMark`.
- **Colors**: always use the token utilities: `bg-paper|card|sunken`, `text-ink|muted|faint`, `border-line|line-strong`, `text-accent`, `bg-accent-solid`, `text-accent-ink`, `bg-accent-soft`, `danger(-soft)`, `success(-soft)`, `text-tone-1..5`, `shadow-card|pop`. Use `motion-safe:animate-fade-in|rise-in|flip-in`. Dark mode is the `.dark` class on `<html>`; the `dark:` variant also works, but the tokens already switch with the theme.
- **Test helpers**: `src/components/test-utils.tsx` provides `renderWithApp(ui, { settings })`, which gives you `{ store, fake }`. It uses an in-memory store over the fixture words. `fake.play` is a `vi.fn`, and `fake.finish('clip')` ends playback.

## Judgment calls
- **Palette** (WCAG AA): light paper is #f6f1e7 with ink #1d1a16; dark paper is #141312 with ink #ede7dc. Cinnabar is #b8361e for text and buttons in light mode. In dark mode, accent text is #e2684d and solid buttons are #c9452b, both with white text. All the text and tone colors are at least 4.5:1 on `paper` and `card` in both themes; I checked this with a script. Tone colors in light mode are 1 #c4271f, 2 #19733a, 3 #1f5fc2, 4 #8a3fb8, 5 #655f58. In dark mode they are 1 #ff7a70, 2 #5ccf84, 3 #74a9ff, 4 #cf95f2, 5 #a9a39b. Tone 1 red is close to the accent red; I accepted that because it is the Pleco convention.
- **Pinyin segmentation** is rule-based: the initial (zh/ch/sh or one consonant), then the vowel cluster, which splits before a second tone-marked vowel, then the coda n/ng/r, where n or g starts the next syllable when a vowel follows. A trailing r after n/ng is erhua. I chose this over a syllable inventory. It matched pypinyin on all 4634 multi-syllable words in wordfreq's top 6000, written joined with standard apostrophes. When `tones` is given and its count matches the syllables, the data's citation tones win over the marks.
- **Fonts**: system fonts only, so the app works offline and loads nothing. CJK falls back through PingFang TC, Noto Sans TC and Microsoft JhengHei, which keeps Taiwan glyph shapes. Pinyin uses the system UI sans.
- **Theme**: `index.html` runs an inline script that applies the saved theme from `localStorage['qian.settings']` before first paint, so there is no flash of the wrong theme. `ThemeSync` then manages the `.dark` class, `color-scheme`, and both `theme-color` metas. On load it removes their `media` attributes and sets both to the resolved paper color.
- **Navigation**: the Study tab uses a headphones icon, because the app is about learning by ear. The bottom bar shows on screens narrower than 640px and the top bar on wider ones. Focus moves to `<main>` after in-app navigation, and there is a skip link. Keyboard hints (`Kbd`) only show on devices with `(hover: hover) and (pointer: fine)`.
- **Danger buttons** use an outline style (danger text and border, tinted on hover). A solid danger button would look like the solid cinnabar primary.
- **The slow button** has its own snail icon plus a visible "Slow" label, rather than a bare rate number.
- **Modal** uses the native `<dialog>` with `showModal()`, which gives focus trapping, Escape handling and the top layer for free. Escape is routed through `onClose` so React state stays the source of truth.
- **Shared test setup**: I made a minimal addition to `src/test/setup.ts`: `afterEach(cleanup)`. Vitest globals are off, so React Testing Library does not auto-clean, and renders would pile up between tests.
- **Tooling gotcha**: run vitest from **PowerShell**, or from a shell whose cwd uses an uppercase `C:` drive letter. From Git Bash (`/c/...`), every suite fails with "Cannot read properties of undefined (reading 'config')": the drive-letter case differs, so vitest is loaded twice.
- **Tooling gotcha**: `vite preview` runs with `command === 'serve'`, so base is `/` and the `/qian/` assets 404. Use `npx vite preview --base /qian/`. The production build itself is correct: I checked it under `/qian/` with Playwright and saw no console errors.
- I removed the scaffold leftovers: `src/App.css`, `src/assets/*` and `public/icons.svg`. `public/favicon.svg` is now 千 drawn as strokes (no font dependency) in white on a cinnabar rounded square, the same drawing as `SealMark`.

# Settings page (`src/features/settings`)

## Files
`SettingsPage.tsx` (page + in-page jump nav), one file per section (`StudySection`, `AppearanceSection`, `AudioSection`, `DataSection`, `InstallSection`, `AboutSection`), `Section.tsx` (section/row layout), `audioCache.ts` (offline audio download), `install.ts` (PWA install prompt), `shortcuts.ts` (shortcut list shown in About), `config.ts` (UI slider ranges, demo word). Tests: `SettingsPage.test.tsx`, `audioCache.test.ts`.

## For the integration agent
- **Offline audio cache**: "Download all audio" stores every manifest clip (word + example) in Cache Storage `qian-audio`, keyed by `resolveAudioUrl(path)` (for example `/qian/audio/w/<id>.mp3`). Each clip is stored as a complete 200 response with `Content-Length`. Three settings for the service worker's runtime cache for `audio/*`:
  - Use `cacheName: 'qian-audio'`.
  - Use CacheFirst.
  - Do **not** set an `ExpirationPlugin` `maxEntries` below about 2× the word count. Otherwise the SW evicts clips the user downloaded on purpose.
  - Add workbox `RangeRequestsPlugin`, because Safari's `<audio>` sends Range requests, and Workbox needs this plugin to answer them with 206 from a cached 200.
  
  The "x of N saved" count looks for exact URL keys, so clips the SW cached while the user studied count as already saved.
- **beforeinstallprompt**: `install.ts` registers its listener when the module is imported. `routes.tsx` imports SettingsPage eagerly, so this happens at startup. If Settings is ever lazy-loaded, import `src/features/settings/install` from `main.tsx`. The listener does not call `preventDefault()`, so the browser's own install UI still appears.
- **Keyboard shortcuts**: About lists the shortcuts from PLAN.md (Space, 1/2/3, R, Z) via `shortcuts.ts`. If the Study page adds more keys or changes them, update `STUDY_SHORTCUTS`.
- **Version**: shown from `package.json` `version` (currently `0.0.0`). Consider bumping it to `1.0.0` before release.

## Judgment calls
- **Slider ranges** are narrower than the lib's `SETTING_RANGES`, as the task specified:
  - retention 0.80–0.97
  - words in progress 5–40
  - stable after 1–30 days
  - backlog limit 0–100
  - slow speed 0.5–1.0
  
  If a stored value is outside the UI range (for example from an import), the slider's range widens to include it rather than misrepresenting the value.
- **Target retention** writes to the store 350 ms after the slider stops moving. A retention change re-derives every card (about 1 s at 100k events), so it should not run on every step of a drag. Any pending value is also committed on unmount. The other sliders write immediately because those updates are cheap.
- **Restore study defaults** button: resets the Study-section settings only, not the theme.
- **Live preview** of the Listen card front (你好 / nǐ hǎo) follows the audio-only, characters and tone-color settings. There is also a tone legend (mā má mǎ mà ma).
- **Words in progress** shows the live counts ("Now: N in progress, M introduced") so the effect of the setting is visible.
- **Test playback** plays 你好 (or the top-ranked word if 你好 is missing) and explains the result:
  - recorded clip
  - browser voice, with "clip failed to load" when a clip exists but TTS played
  - blocked by autoplay (tap again)
  - failed (muted, or no Chinese voice)
  
  When some words have no recording, the section names the browser fallback voice (`pickZhVoice`), or warns that no Chinese voice is installed.
- **Offline download**:
  - Downloads 6 clips at a time.
  - Skips clips already cached, so "Download the rest" resumes after a cancel.
  - Counts per-clip failures and keeps going.
  - Stops on QuotaExceededError.
  - Can be cancelled with AbortController, and cancels on leaving the page.
  - Requests `navigator.storage.persist()` first if it is not granted yet, since the download is many MB.
  - A "Remove offline audio" button deletes the cache.
- **Export**:
  - Uses `store.exportData()` + `downloadText()` (Blob + `<a download>`).
  - Where `navigator.canShare({ files })` works (iOS/Android), also offers "Share / Save to Files". iOS standalone PWAs handle blob downloads poorly, and the share sheet is the reliable way to save to Files.
  - Reminder banner when there is progress and either no export yet or the last export is more than 14 days old.
- **Import**:
  - The file is validated with `parseImport` first, so a non-qian or newer-format file shows its error and opens no dialog.
  - The dialog shows the file's export date and entry count, and Merge is preselected (labelled "recommended", with an explanation). Replace turns the confirm button into the danger style ("Replace my data").
  - The summary reports added / already-present / unreadable / new total, plus "Words started: a → b" when the introduced-word count changed.
- **Reset**: step 1 ("Reset all data?") explains the reset and offers "Export first" and a "Keep my settings" checkbox (off by default, which matches `resetAll()`'s default). Step 2 asks the user to type RESET. The typed text is compared **case-insensitively and trimmed**, because mobile keyboards auto-capitalise to "Reset"; the step is still deliberate. Reset does not delete the offline audio cache, because the cache is not progress.
- **Storage row**: shows persistence status, a request button, and `navigator.storage.estimate()` usage. After a denial, it suggests installing the app.
- **Install section**:
  - Already standalone: shows "Installed".
  - iOS: Safari steps (Share → Add to Home Screen), drawn with an inline share glyph.
  - Android/desktop: a "Install qian" button when `beforeinstallprompt` is available, plus browser-menu instructions.
  - The other platform's steps are in a `<details>`.
  - The iOS 7-day eviction note is always visible. It uses the warning style on non-installed iOS.
- **Jump nav** at the top of the page uses buttons with `scrollIntoView`, not `#fragment` links, because hash routing would treat a fragment as a route. It respects reduced motion and moves focus to the section heading.
- **About, licensing**:
  - Lists SUBTLEX-CH (research use, cited), wordfreq (data CC BY-SA 4.0), CC-CEDICT (CC BY-SA 4.0), MOE via moedict (CC BY-ND 3.0 TW) and OpenCC (Apache 2.0).
  - States that the word data (glosses draw on CC-CEDICT) is shared under CC BY-SA 4.0. **Flag for human review.**
  - Credits audio to ElevenLabs voice "Anna Su", with the manifest's model and date when present.

# Stats page (`src/features/stats`)

## Structure
- `StatsPage.tsx` is the default export, lazy-loaded so recharts stays out of the main bundle. Optional props `words` and `now` exist for tests only; the router passes neither.
- `statsModel.ts` is a pure view-model built on `src/lib/stats.ts`. It covers tiles, the accuracy series, the heatmap grid, the forecast, the hardest words and the flag counts, and it has unit tests. Section components: `ProgressSection`, `HeatmapSection`, `AccuracySection`, `ForecastSection`, `WordsSections` (hardest words and flags). `parts.tsx` holds Section, DataTable and Tooltip; `hooks.ts` holds reduced motion and element width.
- I made no changes to `src/lib` or `src/components`.

## Cross-feature contract
- **The flagged-cards link goes to `/words?filter=flagged`** (`FLAGGED_WORDS_HREF` in `WordsSections.tsx`). The words page needs to read that query param and filter to words with open flags. **Words agent / orchestrator: please match this, or tell me the param you chose.**
- Hardest-word rows link to `/words/:id`.

## Judgment calls
- **"Known words"** means the word is introduced, not suspended, and none of its cards is in (re)learning. That is `wordStatus` young or mature. The tile hint shows mature words, where both cards have S ≥ 21 d. A word whose Say card is still unseen still counts as known once its Listen card has graduated, because listening is the primary skill.
- **"Words introduced"** counts words with at least one graded card, including suspended ones. The denominator is `words.list.length` (1000).
- **Overall accuracy** counts reviews only: good or easy is correct, Again is wrong. "I already know this" is excluded. It covers all time, including learning steps. The tile hint gives the number of reviews.
- **Accuracy chart granularity**: if the first review was less than 21 days ago, it shows daily points. After that it shows Monday-based weekly points for up to the last 26 weeks. Empty buckets break the line visually but are bridged with `connectNulls`. Dots appear only when there are 14 points or fewer. The Y axis starts near the data (a multiple of 10, never above 50%) rather than at 0, so the Listen-vs-Say gap stays readable. The summary pools counts over the last 4 weeks (or 7 days).
- **Heatmap**: plain SVG with Monday-first columns. The number of weeks adapts to the card width: 26 weeks (about 6 months) on desktop, about 19 on a 390px phone, and never fewer than 12. Below that, cells and labels would get too small. On wider cards the SVG scales up to fill them. The colour levels scale to the learner's own history: level 4 starts at the 90th percentile of active days, so one marathon day doesn't flatten everything else. Tapping or hovering a day shows its count in a live readout instead of a floating tooltip. Today has an ink outline.
- **Forecast**: 14 days. Day 0 includes overdue cards and learning cards due today, following `lib/stats.forecast`. Only today's bar and the busiest day get direct labels; the axis, tooltip and table carry the rest.
- **Hardest words** are sorted by FSRS lapses (forgotten after being learned), then the total number of Again presses, then miss rate, then rank. The list includes words with misses but no lapses, so a new learner sees something useful before any card has lapsed. It excludes suspended words and shows at most 8. Each row has a play button, because the app is audio-first. The button sits next to the link, never inside it.
- **Progress bars** are CSS segmented bars (learning, young, mature on a "not started" track) for Listen and Say over the whole 1000. Non-zero segments have a minimum width of 4px so that a few words are still visible. A small table serves as both the legend and the table view. Suspended words appear as a row only when there are any.
- **Chart palette** is set in `stats.css` and scoped to `.qian-stats`, with dark variants under `:root.dark`. I validated it with the dataviz palette checker against the `--card` surface in both themes. Listen and Say use blue and orange: CVD ΔE ≥ 24 and ≥ 3:1 contrast in both themes. Progress, the heatmap and the forecast use one jade hue as an ordinal or sequential ramp, which reads lighter as "more" in dark mode. Jade doesn't compete with the cinnabar accent or with the tone colours. Text never uses series colours. Gridlines use `--line`.
- **Accessibility**: every section has a visible plain-language summary. Each recharts chart is `aria-hidden`, with `accessibilityLayer` off, and has a collapsible "Show data as a table" twin. The heatmap is a `role="img"` labelled by its title and summary. Animations are off under `prefers-reduced-motion`.
- **Empty state** applies when there are no review or known events: an EmptyState with a "Start studying" CTA. The flags card still shows if there are open flags.
- **Visual check**: I took Playwright screenshots against the dev server at 375 and 390px and at 1280px, in light and dark, with an empty log, 3 days of history and 150 days of history. There was no horizontal overflow and no console errors. Harness gotcha: seeding via `import('/src/lib/store.ts')` in `page.evaluate` can get a different module instance than the app's once HMR has touched the graph (`?t=` URLs). Reload after seeding.

# Study screen (`src/features/study`)

## Structure
- `StudyPage.tsx` (default export, route `/`): orchestrates start screen → card → caught up. It holds the UI state: reveal, card identity, blocked-autoplay hint, toast, and the elapsed-time clock.
- `CardFaces.tsx` (`ListenFace`, `SayFace`), `ActionBar.tsx` (Show answer / known / Again-Good-Easy), `CardMenu.tsx` (⋯ menu, flag dialog, suspend confirm), `CaughtUp.tsx`, `Progress.tsx` + `progressNumbers.ts`, `useStudyHotkeys.ts`, `predictNext.ts` (preload guess), `time.ts` (`formatWhen`), `session.ts` (module-level "started" flag).
- I made no changes to `src/lib` or `src/components`.

## Judgment calls
- **Start screen** appears only when the player is not yet unlocked and this page load has not started a session (`studySession`). It does not reappear when you come back from another tab. Tapping Start calls `player.unlock()` inside the gesture. The first card is not shown behind the start screen, so its elapsed time does not count the wait.
- **Card identity** = `epoch|key|shownAt`. The epoch is bumped on every grade, known, undo or suspend, so the same card shown again counts as a new card (reveal resets, autoplay fires). A settings change, a retention rebuild or a flag keeps the card and its reveal state.
- **Autoplay**: Listen plays the word when the card appears. Say plays the word on reveal (inside the reveal gesture), but not the example, to keep the pace fast; the example has its own button and the E key. PLAN said "auto-plays audio and the example"; the task said word audio only.
- **Say front has no replay button**, and R/S do nothing until reveal, because the audio would give the answer away. "Replay always visible" applies to Listen.
- **Space** = reveal; once revealed, Space replays the word (PLAN's "space = reveal/replay"). Enter acts like Space. Space/Enter keep their native meaning on a control reached with the keyboard (tracked input modality, see Review fixes (study)), but a mouse-focused button (say, you clicked replay or Undo) does not block Space from revealing. Shortcuts are ignored in text fields, with modifiers, while the card menu is open, and while any `<dialog>` is open. 1/2/3 only work after reveal, K only on the front of a word's first appearance, E only after reveal. On the start and caught-up screens, Space starts or keeps practicing.
- **elapsedMs** = ms from the card appearing (after Start) to the grade, passed raw; stats cap it at 60 s. It is not sent for "known".
- **Preloading**: 400 ms after a card appears, `predictNextWordIds` simulates "graded Good" and "graded Again" through the real `selectNext` on a copy of `derived` (seeded RNG, same recent-cards rule as the store) and preloads those words, plus the current word's example clip. New and learning picks are deterministic, so the guess is usually exact; for weighted reviews it is a best guess.
- **No layout jumps**: on phones the action bar is sticky above the tab bar and its big buttons stay in place, with "I already know this" or "How well did you know it?" in a row above them (that prompt is hidden on screens shorter than 700px to save space). On sm+, the bar follows the card (min-height 30rem) and keeps a placeholder row (on screens 700px+ tall), so revealing never moves the buttons. Card fronts are top-anchored (`justify-start`), so the answer appears below them without shifting anything.
- **Grade colors**: Good is the solid cinnabar button (the most common answer, where the thumb rests). Again is outline with danger text, Easy is outline with success text. Each button shows its interval preview, and its aria-label reads e.g. "Good, next in 10m".
- **Progress line**: "N due · x/cap learning · n/1000 words". On phones I used "learning" rather than "in progress" so it fits on one line at 390px; the tooltip explains the working set. Due = `dueReviews + learningDue`. The total word count comes from `getWords()`.
- **Caught up**: the reason follows `gateBlockedBy`: working set full ("N words are still settling in"), exhausted ("You've met all 1000"), or nothing at risk. "Next card …" uses the earliest `nextLearningDueAt`/`nextReviewDueAt` and refreshes every 15 s. "Keep practicing" is shown only when `store.peekNext(true)` has something to pick (graduated cards exist); otherwise a short note explains why not.
- **Card menu**: a custom ARIA menu (arrow keys, Home/End, Escape returns focus, closes on outside click). Flag opens a dialog with radio reasons (audio / pinyin / meaning / example / other) and an optional note (max 500 characters). The flag form remounts on each open. Suspend asks for confirmation first, then the next card is picked. A toast confirms flag, suspend and known.
- **Leaving the page** stops playback (`stopPlayback` on unmount).

## Verification
- `npx vitest run src/features/study`: 26 tests. They cover Listen/Say fronts and backs, audioOnly, showCharacters off, the known button only on new cards, grading calls with elapsed time, undo, every shortcut, the flag/suspend menu, the start screen unlock, caught-up and practice-ahead, and audio stopping on unmount.
- I checked in Chromium through the dev server at 390×844, 320×568 and 1280×860, in light and dark, with Full and audioOnly fronts: no console errors and no horizontal overflow.

# Words list and word detail (`src/features/words`)

## Files
- `WordsPage.tsx` (`/words`), `WordDetailPage.tsx` (`/words/:id`). Both take an optional `words?: WordIndex` prop. It defaults to `getWords()`, and tests pass fixtures. The store does not expose its word index, so I did not change `src/lib`.
- Pure modules: `search.ts` (query normalisation and matching), `filters.ts` (per-word status, filters, counts, header summary), `format.ts` (stability, %, relative times, labels), `useWindowedRange.ts` (window-scroll virtualization).
- `StatusChip.tsx` (stage glyph and chips) and `FlagDialog.tsx`.

## Judgment calls
- **Search, pinyin**: a query is normalised to letters plus optional tone digits ("nǐ hǎo" → `ni3hao3`, "de0" → `de5`, "lu:4"/"lv4" → `lv4`). Each word is indexed as a toneless key with each syllable's tone digit after it (`ni3hao3`). Untoned syllables match any tone. **Tones the user types (as digits or marks) must match**, so "shi4" narrows the 20+ "shi" words. Plain "u" in a query also matches ü. A match must **start at a syllable boundary**, so "hao" finds 你好 but "ao" finds nothing. `spokenAs` is indexed too, so "ni2 hao3" finds 你好.
- **Search, other**: an English query matches gloss and hint. A whole part ("know" vs "to know") counts as exact. A match at a word start counts at any length; a plain substring match needs at least 3 letters, because "a" or "to" would otherwise match nearly everything. A CJK query matches trad or simp. A bare number or "#12" matches the rank. **Results are ranked** exact → prefix/word-start → inside, with ties in frequency order. An empty query gives plain rank order.
- **Filters**: Learning, Known and Unseen leave out suspended words, which have their own filter (the same rule as `progressCounts`). Known means the word status is young or mature. Flagged means at least one *open* flag, whether suspended or not. Each filter chip shows its count.
- **Header**: "x of N introduced" counts words with any graded card, including ones that were suspended later. A thin bar shows mature, young and learning.
- **Row chips**: a row shows "Listen · status" and "Say · status". When neither card has been introduced, it shows **one quiet "Unseen" chip** instead of two, which keeps the list of about 990 unseen words calm. A suspended word shows a single "Suspended" chip. An open flag shows as a small red flag icon next to the characters, because a chip did not fit at 390px. Each status has a pie glyph (empty, 1/3, 2/3, full) so it does not rely on color alone.
- **Virtualization**: rows have a fixed height (96px), are absolutely positioned inside a `<ul>` sized N×96, and the window scrolls. Only rows near the viewport plus 8 on each side are rendered: about 26 at 390×844. Because the window scrolls, ScrollRestoration and the sticky bars keep working. Text is truncated to one line to keep the height fixed. Rows carry `aria-setsize` and `aria-posinset`.
- **URL state**: the query and filter live in `?q=&f=` (replace, not push). The row link passes `state.fromList`, and the detail page's back link calls `navigate(-1)` in that case, so the search, filter and scroll position come back. Prev/next on the detail page use `replace`, so one "back" still returns to the list. When the query or filter changes, the list scrolls back to its top only if you had scrolled past it. The check compares the previous values; a first-run flag would break under StrictMode's double effects and undo scroll restoration.
- **Detail**: simplified characters show when they differ (the task asked for this, even though PLAN.md says simplified is list-only). Example characters are always shown (`force`), because the detail page is a reference. The card stats are state, recall now (fractional-day retrievability from `lib/fsrs`), due (relative and absolute), stability, difficulty, reviews, lapses, and first/last seen. The history is newest first, shows the first 50 entries with a "Show all" button, and includes known, suspend and flag events. Flags are grouped by reason, and "Resolve" resolves every open flag with that reason, matching `resolveFlag`.
- **Flag reasons** in the UI: Audio sounds wrong, Wrong pinyin or tones, Wrong or unclear meaning, Problem with the example, Something else.

## For the shell owner
- `usePageTitle()` does not work on first render of a route. AppShell's own title effect runs **after** child effects in the same commit, so it overwrites the page's title. The detail page works around this locally by setting `document.title` one microtask later. A fix in the shell could, for example, skip its effect when the route sets its own title.

## Verification
- `npx vitest run src/features/words`: 61 tests across search (tone-insensitive, numbered, marked, sandhi, ü, syllable-boundary, English, characters, rank), filters and counts (built from real derived state, including a mature card), windowing, list page (URL state, filters, keyboard radio group, audio vs row tap, 1000-row windowing) and detail page (audio normal/slow, stats, history, known, suspend, flag/resolve, unknown id, back with query kept, prev/next).
- `npx tsc -p tsconfig.app.json --noEmit` and `oxlint src/features/words` are clean.
- I checked in Chromium on my own dev server, using the real 1000-word list at 390×844 and 1280×900 in light and dark. There were no console errors and no horizontal overflow. Scrolled to y=50000, the list rendered rows 510–535. Back from a detail page restored the scroll position. A search plus re-render took about 10–50 ms in dev mode.

# Integration, PWA, deploy and e2e

## Fixes and consolidation
- **Page titles**: AppShell now sets the per-section title in a `useLayoutEffect`. Layout effects run before every passive effect of the commit, so a page's `usePageTitle()` always wins, even on a route's first render. `usePageTitle` also re-applies on every pathname change. I removed the Word detail page's microtask workaround and added a shell test.
- **Flagged link**: Stats → "Review" now goes to `/words?f=flagged`. The Words page already keeps its filter in `?f=`, so the link follows that instead of the `?filter=` the Stats agent proposed.
- **One flag dialog**: the study card menu and the word detail page each had their own flag dialog with the same reasons. Both now use `components/FlagDialog`, with labels in `components/flagReasons.ts`. The title names the word ("Flag wǒ “I; me”") and the submit button says "Flag word".
- **`useNow(intervalMs)`** moved to `components/hooks.ts`. It was duplicated in CaughtUp and WordDetail.
- **About → Keyboard shortcuts** now lists what the study page actually handles: Space/Enter, 1/2/3, R, S, E, K and Z.
- I left the remaining small duplicates alone because they mean different things: `formatDuration` is the total time studied in Stats but the per-review time in Words.
- Version bumped to 1.0.0, as the Settings agent suggested.

## PWA (vite-plugin-pwa 2.0.0, Vite 8 is in its peer range)
- `generateSW`, `registerType: 'autoUpdate'`, `skipWaiting` + `clientsClaim`, so the first visit is controlled and works offline right away. `injectRegister: false`: registration is in `components/PwaUpdater.tsx` (`useRegisterSW`), which is rendered in App.tsx and kept out of the barrel because the virtual module only exists inside Vite.
- **Update toast instead of a forced reload**: with autoUpdate the plugin reloads the page as soon as a new SW activates. I pass `onNeedReload`, so a small toast ("A new version of qian is ready." with Reload and Later) appears instead. Progress is saved per answer, so nothing is lost either way, but a reload in the middle of a card is jarring. The app also checks for updates every hour while open (installed PWAs rarely do a full reload). There is no "ready to work offline" toast, to keep the app calm.
- **Precache**: `**/*.{js,css,html,svg,png,ico,json}` minus `**/audio/**`, 17 entries, about 1.36 MB. words.json is bundled into JS. `includeManifestIcons: false`, because the glob already covers the icons; leaving it on duplicated every precache entry.
- **Audio runtime cache**: `/\/audio\//`, CacheFirst, `cacheName: 'qian-audio'`, `cacheableResponse: [200]`, `rangeRequests: true`, no ExpirationPlugin. I added a custom `requestWillFetch` plugin that **drops the Range header on a cache miss**. `<audio>` always sends `Range: bytes=0-`, the server answers 206, and a 206 can never be cached, so without this plugin clips played in the app would never be cached. With it, the first play gets the full 200 (cached), and later plays get 206 slices from the cache via RangeRequestsPlugin.
- **No service worker in `vite dev`** (`devOptions.enabled: false`). The virtual module is a no-op in dev; I checked on a dev server.
- **Base**: `command === 'build' || isPreview ? '/qian/' : '/'`. `vite preview` now serves under `/qian/` without `--base`, which fixes the shell agent's gotcha. Dev stays at `/`.
- **Manifest**: id, start_url and scope are `/qian/`. theme_color and background_color are the light paper color #f6f1e7; ThemeSync still updates the `theme-color` meta at runtime for dark mode.
- **Icons**: `@vite-pwa/assets-generator` (dev dependency, the vite-pwa org's tool; it uses sharp) with `pwa-assets.config.ts` builds them from `public/favicon.svg`: pwa-64/192/512, maskable-512 and apple-touch-180 on a full-bleed seal red (#b8361e), plus favicon.ico. The glyph sits inside the 80% maskable safe zone. Run `npm run generate-pwa-assets` after changing the SVG.
- **Chunks**: `words` (the JSON data, about 460 kB) and `react` are separate long-lived chunks, so a code-only deploy keeps the word data cached. `chunkSizeWarningLimit` is 700 because the words chunk is data, not code.

## Deploy
- `.github/workflows/deploy.yml` uses checkout@v7, setup-node@v7 (Node 24, npm cache), configure-pages@v6, upload-pages-artifact@v5 and deploy-pages@v5: the current majors according to `gh api …/releases/latest` on 2026-10-11. Permissions are contents read, pages write and id-token write. The concurrency group is `pages` with cancel-in-progress false. Playwright is **not** run in CI: it needs browser downloads and a few minutes, and the task's step list didn't include it. Run it locally before releases.
- Repo setting needed once: Pages → Source: GitHub Actions.

## E2E (Playwright 1.64)
- `playwright.config.ts`: the webServer runs `npm run build && npx vite preview --port 4317 --strictPort` with base `/qian/`. Projects are Desktop Chrome, Pixel 7 and iPhone 14 (WebKit). `serviceWorkers: 'block'` is the default, and pwa.spec.ts opts back in (Chromium only).
- `e2e/fixtures.ts`: an auto fixture fails any test with a console error or pageerror. An init script stubs `HTMLMediaElement.prototype.play` and `window.speechSynthesis` to record what was played and fire `ended`/`onend` after 40 ms. The tests therefore assert that audio was *attempted*, whether from a recorded clip or the TTS fallback, and still pass once the audio manifest is filled.
- Seeding goes through the real Settings import UI (merge) with generated backup files, not by poking IndexedDB.
- `e2e/screenshots.spec.ts` (Chromium projects) writes 40 PNGs to `docs/screenshots/`: `{mobile|desktop}-{light|dark}-{page}`, with a seeded month of history and reduced motion. In full-page captures the fixed tab bar is put back in the page flow (static), so it sits at the end instead of covering content mid-page.
- `tsconfig.e2e.json` (DOM + node types, bundler resolution) is part of `tsc -b`.
- Behaviour pinned by the tests: after any tap elsewhere in the app, audio is unlocked, so coming back to Study shows the card directly rather than the start screen.

## Open items for a human
- `moe.pkl` (18 MB) sits untracked in the repo root and is not covered by .gitignore. It looks like the data agent's cache; don't commit it.
- Desktop at short window heights (720px): the sticky grade bar overlaps the bottom of a long answer until you scroll. This is by design (the buttons stay put), but worth a look.

## Review fixes (pwa)
- **Audio URLs are content-versioned.** `scripts/audio/generate.py` installs clips as `public/audio/{w,s}/<id>-<hash8>.mp3`, where hash8 is the first 8 hex characters of sha1 of the final mp3 bytes. It was hashing the request before; now a QC retry with the same text and model still gets a new URL. The manifest stores that path. After installing a clip the script deletes the word's other versions, and the legacy `<id>.mp3`. The match is a full regex, because ids like `w6211-5011` start with another id. `needs_work` and `write_outputs` check the file the state record points to. `qc.py --all` finds the versioned file. I chose a filename hash over `?v=` so GitHub Pages' 10-minute max-age and other HTTP caches can never put old bytes under a new cache key.
- **`pruneAudioCache(validUrls)`** (`features/settings/audioCache.ts`) deletes `qian-audio` keys under `/audio/` that the current manifest no longer references. PwaUpdater calls it once at idle after startup (requestIdleCallback, or a 3 s timeout on Safari). Regenerated clips then count as missing in Settings, "Download the rest" fetches them, and dead clips stop using storage. Files the manifest still uses are never touched, including clips downloaded on purpose.
- **First, uncached play now returns 206.** A `handlerWillRespond` callback (`features/settings/audioCache.sw.ts`, imported by vite.config.ts) slices the full 200 for Range requests, using the same logic as workbox-range-requests' createPartialResponse, including suffix ranges and 416. It lives in its own file so it can be unit-tested. generateSW serializes it with `toString()`, so it must stay self-contained (no imports or helpers). I checked the built `sw.js` against a real mp3: `bytes=0-1` returns `206 bytes 0-1/3693` on the miss and on the hit. This still needs a check on a real iPhone.
- **Stale lazy chunk:** PwaUpdater listens for `vite:preloadError` and reloads onto the new version. It reloads at most once a minute (sessionStorage stamp `qian:chunk-reload-at`), and never if sessionStorage is unavailable, so a chunk that is really missing reaches RouteError instead of looping. I did not use "prefetch Stats at idle": it only helps if the prefetch finishes before the update, and the reload covers every lazy chunk.
- **Update checks on resume:** the hourly interval stays. A throttled check (at most every 10 min, online only) also runs on `visibilitychange` → visible and on `online`, because mobile OSes freeze timers in backgrounded installed PWAs and resume them without a navigation. The logic is in `components/PwaUpdater.helpers.ts`.
- **Toast position / RouteError:** another agent moved the update notice in-flow (`UpdateNotice`, `pwaUpdate.ts` with `reloadApp`) and is reworking RouteError while I do this, so I left both alone. I kept PwaUpdater's registration-only shape and added my changes to it.
- **Playwright no longer reuses a server by default** (`reuseExistingServer: !!process.env.PW_REUSE_SERVER`). A leftover server on the port now fails loudly through `--strictPort` and is never tested silently. Set `E2E_PORT` to use another port, and `PW_REUSE_SERVER=1` to iterate against a preview you started yourself. The README's "builds and previews automatically" is now always true.

## Review fixes (ui)
- **Update notice is in-flow, not a fixed toast.** The bottom toast covered the Again/Good/Easy row. `pwaUpdate.ts` holds a tiny external store (`markUpdateReady` / `dismissUpdate` / `useUpdateState`). PwaUpdater (still in App.tsx, outside the router) only writes to it. `UpdateNotice` renders it at the top of AppShell's `<main>` and on RouteError, which sits outside AppShell. Trade-off: if it appears mid-card, the study card shifts down about 3.5rem once. That beats intercepting a grade tap. The `role="status"` wrapper stays mounted so the text is announced, and the Reload/Later buttons now sit on `bg-sunken`, where the global focus ring passes 3:1.
- **RouteError "Back to study"** is now a `<button>` that calls `reloadApp('#/')`: `history.replaceState` then `location.reload()`. A `reloadDocument` hash link is a same-document navigation and never reloads. I did not add an auto-reload for chunk errors in RouteError, because PwaUpdater's `vite:preloadError` handler already does one guarded reload (see Review fixes (pwa)). Two separate guards could have allowed two reloads.
- **Modal**:
  - It restores focus explicitly to the element that was focused at open (if it is still connected and not `<body>`), on top of the browser's native restore.
  - Backdrop dismissal now needs the pointerdown to land on the backdrop too, so a drag-select out of the flag note no longer closes the dialog and loses the note.
  - ConfirmDialog no longer uses `autoFocus`. Cancel gets focus (first in the DOM) on purpose, so destructive confirms need a deliberate Tab or click.
- **CardMenu** (small edit outside my area, named in the finding): menu items call `close()` (refocus the trigger) before opening a dialog, so the dialog returns focus to "Card options". `outline-none` is replaced with `focus-visible:-outline-offset-2`, so the global focus ring shows inside the item.
- **Kbd is `aria-hidden`.** Buttons no longer get names like "Show answer Space". I did not add `aria-keyshortcuts` to the feature buttons (ActionBar, CardFaces, StudyPage, CaughtUp), because those files belong to other agents. Button already passes the attribute through, so it is a one-attribute follow-up.
- **`--faint` → `--muted` for content:** simplified Hanzi, the RouteError message, the Stats heatmap hint and the ProgressSection help text. Placeholders stay faint: on card they are about 4.5:1, and darkening them would make them look like typed text. I did not darken `--faint` globally, because it would end up almost identical to `--muted`.
- **Settings "Test playback" sample** now uses `<Pinyin>` + non-forced `<Hanzi>`, pinyin first, so it follows tone colors and showCharacters.
- **index.html pre-paint script** now also sets the theme-color metas (drops `media`, sets the resolved color), so the status bar matches an explicit theme before the bundle loads. The manifest `theme_color`/`background_color` stay light (#f6f1e7): a manifest can't follow the color scheme, so dark-mode Android users see a cream splash screen at launch. This is a known limitation, accepted.

## Review fixes (pages)
- **Share-sheet cancel no longer counts as a backup.** `store.exportData({ record: false })` builds the file without touching `lastExportAt`; the Share path calls the new `store.markExported(t)` only after `navigator.share()` resolves, or after the non-Abort download fallback. AbortError shows "Not saved." The download path and Reset's "Export first" still record right away: a browser can't tell whether an `<a download>` really wrote the file.
- **Replace import guard**: the import modal shows "This device: N entries · Backup: M entries". With Replace selected and M < N, it shows a warning (with the number of reviews lost), an "Export this device first" button, and a required "I understand…" checkbox before the danger button is enabled. I used a checkbox rather than typing RESET, and the guard applies to any M < N, not just "much smaller", because restoring an older state on purpose is exactly that case and a tick costs little. Merge, and Replace with M >= N, are still one click.
- **Neutral-tone-lenient pinyin search**: a query digit matches the key's digit, or either side is 5 (neutral). 1-4 never match each other. A lenient match ranks one tier lower. As a result, a typed tone also finds a word whose stored syllable is neutral, e.g. "shi1" lists 師 then 認識 (rèn shi), and "shi5" lists every shi.
- **Pinyin ranking**: `MatchTier` is now 0 exact, 1 prefix ending on a whole syllable, 2 prefix stopping inside a syllable, 3 mid-word. "xian" gives 先, 現在, 現場, then 想, 相信. Hanzi `includes` and English substring matches moved from 2 to 3 so they stay last.
- **Words empty states**: with no query and a filter that has 0 words, the page shows per-filter copy with only "Show all words". The search tips show only when a query was typed.
- **"Introduced" has one meaning**: `selectNext` now adds a word to `introduced` before the suspended skip (in src/lib/scheduler.ts, as the verifier suggested). Settings, the import "Words started" message and the Study progress then match the Words and Stats pages. The count is display-only; no gate reads it.
- **Stats clock**: StatsPage uses `useNow(5 min)`, and `useNow` (src/components/hooks.ts) now also refreshes on `visibilitychange` → visible. That benefits WordDetailPage too. `now` is still re-read on each store revision (`Math.max(tick, Date.now())`), so a review made after the last tick is counted as today.
- **About**: the license names link to their deeds (no link for SUBTLEX-CH). The MOE line says "reading fields only; no dictionary text is copied". The BY-SA paragraph names what is shared and links the repo. The audio line uses `recordedWordCount`: "N of M words recorded with ElevenLabs…" or "No studio recordings in this build yet". `AboutSection` takes optional `words`/`manifest` props like AudioSection, for tests.
- **Stable-after slider**: I kept the 1–30 range and added a sentence: "I already know this" words start at about 8 days, so above 8 they count as in progress until their first review. The behavioural alternative (never count known-only cards as unstable) needs the user's decision.
- **iOS install steps**: text only. Step 1 says "On newer iPhones, tap ⋯ first, then Share"; step 2 says to scroll or tap More. Not checked on a device; nothing added about Chrome/Edge on iOS.

## Review fixes (study)
- **Space after a mouse click** (useStudyHotkeys): `:focus-visible` is no longer used. Chromium turns a mouse-focused button focus-visible on the next keypress, so Space re-clicked a focused Undo, deleting one review per press. The hook now tracks input modality itself: a capture-phase `pointerdown` means pointer, a `Tab` keydown means keyboard. Space/Enter keep their native meaning only for a control reached with the keyboard. I chose modality over the verifier's "remember the pointer-focused element" because programmatic refocus after a mouse action (CardMenu returns focus to its trigger) should also leave Space to reveal. The tracking runs even while the shortcuts are disabled (menu open). The initial modality is keyboard, so programmatic focus with no pointer use keeps native activation.
- **Double-tap guard** (ActionBar): the grade buttons are disarmed for 350 ms after reveal (`GRADE_TAP_GUARD_MS`). While disarmed, the grade group has an inline `pointer-events: none` (a second tap falls through to the bar) and onClick ignores clicks. I used pointer-events instead of only dropping clicks in onClick because Playwright then waits for the buttons to accept events, so e2e `revealAndGrade` keeps working without sleeps. Keys 1/2/3 go through StudyPage and are not guarded. The armed state is derived from `key|shownAt`, so the buttons are disarmed from their first paint. The bar also has `touch-action: manipulation`.
- **Bar jump on phones**: the bar now has `-mb-8 pb-9` (2rem pulled into `<main>`'s bottom padding), so its resting and stuck positions match (`sm:mb-0` resets it). The extra strip is covered by the bar's opaque background. On sm+, the bottom padding includes `env(safe-area-inset-bottom)`.
- **Answer hidden under the bar on short screens**: card fronts are now `justify-start pt-2`, with `min-h-48` (12rem) only before reveal. On reveal, the first block of the answer (`AnswerLead`: meaning on Listen, pinyin and replay on Say) scrolls itself into view with `block: 'nearest'` (smooth unless reduced motion). Its `scroll-margin-bottom` matches the bar: tab bar + 7.5rem on phones, 11rem on phones 700px+ tall, 10rem on sm+. The "How well did you know it?" row and its sm placeholder now show only on screens at least 700px tall, on desktop too. I did not clamp the card's `sm:min-h-120`, because it does not move the answer.
- **Scroll carry-over**: a `useLayoutEffect` keyed on the card id runs `window.scrollTo({ top: 0, behavior: 'instant' })` when the page is scrolled, before paint. It only runs when `scrollY > 0`, so jsdom tests need no stub.
- **Toast vs Undo**: the toast stays at the top, but only its own button takes taps (`pointer-events: none` elsewhere). Taps on the text fall through to the header Undo and menu. "Known" and "Suspend" toasts have an inline **Undo** and stay for 5 s instead of 3.2 s. Known's Undo calls the normal undo. `store.undo()` does not cover suspends, so Suspend's Undo calls `setSuspended(id, false)`, which unsuspends the word but keeps the card now showing. A known toast loses its Undo once another answer is graded or undone, because "undo last answer" would then undo something else. `undo()` reads `store.getSnapshot().canUndo` rather than the render's `snap`, because the toast holds a closure from an older render.
- **Hidden tab**: the card effect (clock start, autoplay, preload) waits for `visibilitychange` when `document.visibilityState === 'hidden'`. A card published by the caught-up timer in a background tab plays when the learner comes back, and its elapsed time starts then. The store is unchanged.
- **Audio failures on the card**: `blockedId` became a per-card `audioIssue` ('blocked' | 'failed'). 'failed' shows "Couldn't play audio. Check Settings → Audio" (a plain `#/settings` link, so CardFaces works outside a router in tests). An audio-only Listen front with 'failed' shows the pinyin and characters before reveal, so the card can still be answered. Not covered: a device with no zh voice, where TTS reports 'tts' with a wrong voice. That needs a voice check and is left for later.
- **Audio unlock (src/lib/audio.ts, named in the finding)**:
  - Gesture listeners are now `click`, `touchend` and `keydown`; a touch `pointerdown` is not an activation on iOS.
  - `unlock()` now marks the player unlocked and drops the listeners only after the silent priming `play()` resolves. A `NotAllowedError` keeps listening. Any other rejection (AbortError from the card's own play, a decode error) still counts as unlocked, because the gesture was real.
  - `unlock({ force: true })` always re-primes. StudyPage's Start and Keep practicing use it.
  - `SILENT_WAV` is now a real clip: 400 samples, 8 kHz 8-bit, built as a short base64 prefix plus `'gICA'.repeat(133)`.
  - Speech is primed with `' '` (zh-TW, volume 0). The e2e `contentAudio` helper already ignores blank utterances.
  - Not verified on a real iPhone.
- **Preload via fetch (src/lib/audio.ts)**: `preload()` now issues `fetch(url, { priority: 'low' })` for up to 8 recent URLs, deduplicated by a Set. It no longer creates detached `<audio>` elements. It skips when `navigator.connection.saveData` is on. `fetch` can be injected through `AudioPlayerOptions.fetch` for tests. A failed fetch is forgotten, so it can be retried.
- **Not done (outside src/features/study)**: the verifier's suggested Chromium e2e test (click Undo, press Space, then assert one fewer event and the card revealed) belongs in e2e/study.spec.ts. The unit tests cover the same flow in jsdom.

## Review fixes (core)

- **Early learning cards are capped at 60 s** (`EARLY_LEARNING_MS` in scheduler.ts). ts-fsrs moves learning steps on by count, so the old "show the earliest pending learning card when nothing else is left" let a just-failed word graduate in seconds. With the working set full, which is normal at cap 30, this happened often. A test now grades two lapsed cards Good every 5 s and checks that neither graduates before 9 min. The sibling agent's weighted early pick is kept, but only among cards inside the window. I did not grade early cards at max(now, due), because that would corrupt event timestamps and replay.
- **One definition of "due"** is used: `card.due <= now`. I dropped the R <= requestRetention clause instead of adding an "effective due". FSRS already places due at R ≈ target, and the clause cancelled the upper half of fuzz (the load spreading). It also disagreed with the timer, CaughtUp and forecast. `isDueReview(c, now)` and `dueReviewCount(d, now)` lost their retention parameter.
- **Day boundary at local 4am.** ts-fsrs counts elapsed days by UTC date, which is 08:00 in Taiwan and 16:00/17:00 in Pacific time. A 10-minute step across that boundary counted as a whole day and roughly tripled stability. `applyGrade` now shifts times by a constant `dayOffsetMs` (`defaultDayOffsetMs()` = 4h + getTimezoneOffset). It shifts before calling ts-fsrs and shifts back afterwards. `Derived.dayOffsetMs` carries the value, and `buildDerived` / `emptyDerived` take it as a third argument, defaulting to 0 (UTC, the old behaviour, so pure tests are machine-independent). The store captures it once per device in IndexedDB meta (`dayOffsetMs`, kept by clearAll), so DST changes and travel never re-shift history on replay. It is per device and not exported. A device in another timezone replays merged events with its own boundary, which is acceptable.
- **Fuzz seed** is now `prevReviewTime_reps_D*S` instead of ts-fsrs's `reviewTime_reps_D*S`. Previews (computed at `shownAt`) now match what grading schedules a few seconds later. Before this, 158/200 labels disagreed. Because `prevReviewTime` differs per card, cards with identical grades still spread. The seed adds the day offset back, so fuzz depends only on real times. FSRS instances are cached per (retention, offset). `previewIntervals` now calls `applyGrade` per grade, the same path as derive, instead of `f.repeat`. Existing logs replay with different fuzz. That is harmless, because only grades are logged.
- **Undo** keeps a store-local list of ids graded in this session (max 20). `canUndo` is false after a reload, so pressing Z the next morning does nothing. Suspend and unsuspend clear the list, so Undo is off until the next answer. The Suspend toast's own Undo (Review fixes (study)) still works through `setSuspended(id, false)`. Replace-import and reset also clear the list. `studyCardFor` returns null for a suspended word, and undo then falls back to normal selection.
- **Import/reset failures**: `save()` now returns a boolean. An `importData` whose IndexedDB write fails throws "The backup could not be saved in this browser; nothing was changed." before anything is published. DataSection's existing catch shows it. Replace mode saves settings only after `replaceEvents` succeeds. A merge re-merges onto the current log after the write, so answers given meanwhile are kept. A failing `resetAll` throws and also sets the generic error banner. **DataSection's `doReset` has try/finally but no catch, so the settings owner should show this error there.** In memory mode (no DB) these still succeed.
- **Several tabs**: a `BroadcastChannel('qian:<dbName>')` "changed" message is posted after each saved write, undo, import, reset and settings change. The receiving tabs call `resync()`, which reloads the log from IndexedDB plus any unsaved or in-flight local events, and re-reads settings. The DB replaces the in-memory log, so a reset elsewhere wins and a stale tab stops writing the old history back. If events were removed, or the card on screen changed or was suspended, the current card is re-picked. Otherwise it is kept. `resync()` also runs on the sibling agent's visibility/focus/pageshow hook. `exportData()` reads the log from IndexedDB, merged with memory, so a stale tab cannot write an incomplete backup.
- **Timers** (finding "caught-up screen never refreshed"): the sibling agent had already chained hourly timers and added resume listeners in store.ts. I only hooked `resync()` into them. I did not re-pick a stale *current* card (new/practice) on resume, because that needs to know whether the card has been revealed.
- **Simulation fixture**: in "stop when caught up" mode, the simulated learner now waits for a learning step due within 20 min, as the countdown screen allows, instead of stopping for the day. Without that wait, the 60 s cap would have made that learner abandon pending steps. The "is deterministic" sim test now has a 30 s timeout, because the caught-up path runs `selectNext` twice per pick. **The simulation table above predates these changes and was not re-measured.**
- New tests: `fsrs.test.ts` (day boundary, seed), the "review fixes (core)" block in `scheduler.test.ts`, and `store.core.test.ts` (undo scope, offset persistence, two tabs, failed writes via a mocked `db`). store.core.test.ts is a separate file so it does not collide with the sibling agent's concurrent store.test.ts edits.

## Review fixes (spec)
- **Caught-up refresh** (`store.ts`): `scheduleRefresh` no longer gives up when the next card is more than 1 h away. It sets a timer for `min(wait, 1 h)`, and each refresh re-arms it, so the queue counts also stay fresh. Because hidden pages freeze timers, the store also listens for `visibilitychange` (visible), `focus` and `pageshow` (attached in `init()`, removed in `dispose()`) and re-picks **only while caught up**, so a card mid-answer is never swapped. StudyPage also calls `store.next()` on mount when caught up. Tests: the hourly chain and the resume path, both with fake timers, in `store.test.ts`.
- **Say cards past a full working set** (`scheduler.ts`): the cap limits new *words*. When the set is full, Say cards of words already in it may still start; the backlog gate still blocks them. When both gates apply, `gateBlockedBy` stays `'workingSet'`, as before. The simulation's gate check already counted only new Listen cards. The old store test expected nothing after a word graduated under cap 1; it now gets that word's Say card.
- **Early learning cards** (`scheduler.ts`): a weighted random sample (fraction of the step elapsed, squared) instead of the earliest-due card. It skips the last `RECENT_WINDOW` (5) cards while another is available. The store, predictNext and the simulation now pass the last 5 keys; the sibling and last-card rules still use only the last 3. The sibling "core" agent added a 60 s `EARLY_LEARNING_MS` window on top of this, so the 30-in-a-row replay is now limited both in timing and in order. I did not add the optional "cap consecutive new picks" rule.
- **Flags export** (Stats → Flagged cards): an "Export flags (CSV)" button appears when there are open flags. It sends `qian-flags-YYYY-MM-DD.csv` (`flagsToCsv(openFlags(...))`, every open flag including unknown ids) to the share sheet where files can be shared, and downloads it otherwise. I put it on Stats rather than in the virtualised Words header, which is where the verifier suggested. The FlagDialog text ("you can export them") is now true.
- **Study nudge** (`features/study/StudyNudge.tsx` + `nudge.ts`): one dismissible banner on the start and caught-up screens, never on a card and never before the first answer. Priority: (1) iOS and not standalone → "Add qian to your Home Screen"; (2) backup overdue (the same rule as Settings, now shared in `features/settings/backup.ts`) → "Back up your progress" with a direct Export; (3) `persistence === 'denied'`. A dismissal snoozes that kind for 3 days in `localStorage['qian.nudgeSnoozedAt']` (try/catch; without storage, it lasts for this view). The links to Settings are plain `#/settings` anchors, so the component works without a router in tests.
- **Cancelled share**: `saveBackup()` (`backup.ts`) records `lastExportAt` only after a download, or after `navigator.share` resolves. A dismissed sheet (AbortError) records nothing. Settings' Export row and the nudge both use it. The sibling had already patched the Settings row the same way; I folded that into the shared helper.
- **Word list sort** (`?s=`): Most common (default, left out of the URL), Due soonest, Weakest recall, Most forgotten (lapses), Recently seen. The sort is applied after filtering and is stable over the incoming order, so rank breaks ties. While searching, the "Most common" choice keeps relevance order. Unseen words go last. Suspended words have no due date and sort last for "Due soonest". The control is a small native select on the results line, not in the sticky bar, so the sticky header doesn't grow on phones. `now` for recall comes from `useNow(5 min)`.
- **Audio release guard**: `scripts/check-audio.mjs` runs in `deploy.yml` before the build. It fails when the manifest covers < 99% of word + example clips (2000), or when a listed clip file is missing. `MIN_AUDIO_COVERAGE` overrides the threshold. It is not a vitest test, so local and concurrent test runs pass without the clips. **The clips themselves were not generated by this agent.** The full ElevenLabs run spends paid credits (expected about 1.5–2.5k) on the user's account, and it should be followed by a human listening pass, so I left it for the user. Until then, deploys fail on purpose. See DECISIONS.md.
- **Docs**: added root `DECISIONS.md` (deviations from PLAN plus a human-review list, linking the detailed notes), a "superseded" banner at the top of PLAN.md (original text kept), and `scripts/requirements.txt` (top-level pins from the venv, Python 3.11, referenced in README). The scheduler setting comments no longer state default values. The simulation table marks 30 / 5 as the current defaults; its two rows were re-measured (3 seeds) after the review fixes.
