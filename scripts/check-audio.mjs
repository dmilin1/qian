// Release guard: fail when the recorded audio is missing, so a browser-TTS-only build is never deployed
// by accident. Run from the repo root: `node scripts/check-audio.mjs` (the deploy workflow runs it
// before the build). It checks that src/data/audio-manifest.json covers at least MIN_AUDIO_COVERAGE
// (default 0.99) of the word + example clips in src/data/words.json, and that every clip the manifest
// lists exists under public/ (any missing file fails). MIN_AUDIO_COVERAGE=0 skips both checks.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
const words = readJson('src/data/words.json')
const manifest = readJson('src/data/audio-manifest.json')
const min = Number(process.env.MIN_AUDIO_COVERAGE ?? 0.99)

const entries = manifest.entries ?? {}
let expected = 0
let covered = 0
const missingFiles = []
for (const w of words) {
  const e = entries[w.id] ?? {}
  for (const kind of ['word', 'example']) {
    if (kind === 'example' && !w.example) continue
    expected++
    const path = e[kind]
    if (!path) continue
    if (existsSync(join(root, 'public', path))) covered++
    else missingFiles.push(path)
  }
}

const coverage = expected ? covered / expected : 0
const pct = (x) => `${(x * 100).toFixed(1)}%`
console.log(`Audio: ${covered}/${expected} clips (${pct(coverage)}), voice ${manifest.voiceId || '?'}, model ${manifest.model || '?'}, generated ${manifest.generatedAt || '?'}`)
if (missingFiles.length && min > 0) {
  // A listed clip that is missing would 404 and fall back to browser TTS for that word, so any missing file fails.
  console.error(
    `${missingFiles.length} manifest clips are missing under public/, e.g. ${missingFiles.slice(0, 5).join(', ')}. ` +
      'Commit the files the manifest lists (or re-run scripts/audio/generate.py).',
  )
  process.exit(1)
}
if (missingFiles.length) console.error(`${missingFiles.length} manifest clips are missing under public/ (ignored: MIN_AUDIO_COVERAGE=0).`)
if (coverage < min) {
  console.error(
    `Audio coverage ${pct(coverage)} is below ${pct(min)}. Generate the clips first (scripts/audio/generate.py, see scripts/audio/NOTES.md) ` +
      'and commit public/audio plus src/data/audio-manifest.json. Set MIN_AUDIO_COVERAGE=0 to deploy without recordings on purpose.',
  )
  process.exit(1)
}
