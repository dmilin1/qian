// Shared Playwright fixtures and helpers for the qian e2e suite.
//
// - Audio is stubbed in the page (before any app code runs): HTMLMediaElement.prototype.play and
//   window.speechSynthesis record what was played and "end" quickly, so tests can assert that
//   audio was attempted without depending on codecs, voices or autoplay policies.
// - Every test fails if the page logged a console error or threw an uncaught exception.
import { readFileSync } from 'node:fs'
import { expect, test as base, type Page } from '@playwright/test'

export { expect }

export interface AudioLog {
  /** src of every HTMLMediaElement.play() call (includes the silent unlock clip). */
  media: string[]
  /** text of every speechSynthesis.speak() call (includes the empty unlock utterance). */
  speech: string[]
}

function installAudioStub() {
  const log = { media: [] as string[], speech: [] as string[] }
  ;(window as unknown as { __qianAudio: typeof log }).__qianAudio = log

  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    log.media.push(this.currentSrc || this.src)
    setTimeout(() => this.dispatchEvent(new Event('ended')), 40)
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function () {}

  if (typeof window.SpeechSynthesisUtterance === 'undefined') {
    class Utterance extends EventTarget {
      text: string
      lang = ''
      rate = 1
      pitch = 1
      volume = 1
      voice: SpeechSynthesisVoice | null = null
      onend: ((e: Event) => void) | null = null
      onerror: ((e: Event) => void) | null = null
      constructor(text = '') {
        super()
        this.text = text
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true, writable: true })
  }
  const fakeSynth = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    getVoices: () => [],
    speak(u: SpeechSynthesisUtterance) {
      log.speech.push(u.text)
      setTimeout(() => {
        const ev = new Event('end')
        u.onend?.call(u, ev as SpeechSynthesisEvent)
      }, 40)
    },
    cancel() {},
    pause() {},
    resume() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  }
  Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth, configurable: true })
}

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
      })
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
      await page.addInitScript(installAudioStub)
      await use(errors)
      expect(errors, 'no console errors or uncaught exceptions').toEqual([])
    },
    { auto: true },
  ],
})

// ---------- word data ----------

export interface WordLite {
  id: string
  rank: number
  trad: string
  pinyin: string
  gloss: string
}

export const WORDS: WordLite[] = JSON.parse(readFileSync(new URL('../src/data/words.json', import.meta.url), 'utf8'))

export function wordByTrad(trad: string): WordLite {
  const w = WORDS.find((x) => x.trad === trad)
  if (!w) throw new Error(`word ${trad} not in words.json`)
  return w
}

// ---------- audio ----------

export async function audioLog(page: Page): Promise<AudioLog> {
  return page.evaluate(() => (window as unknown as { __qianAudio: AudioLog }).__qianAudio)
}

/** Audio for real content (not the silent unlock clip or the empty unlock utterance). */
export async function contentAudio(page: Page): Promise<string[]> {
  const log = await audioLog(page)
  return [...log.media.filter((src) => src && !src.startsWith('data:')), ...log.speech.filter((t) => t.trim() !== '')]
}

// ---------- study ----------

export const listenCard = (page: Page) => page.getByRole('article', { name: 'Listen card' })
export const sayCard = (page: Page) => page.getByRole('article', { name: 'Say card' })
export const anyCard = (page: Page) => page.getByRole('article', { name: /^(Listen|Say) card$/ })
export const gradeButton = (page: Page, grade: 'Again' | 'Good' | 'Easy') =>
  page.getByRole('group', { name: 'Grade' }).getByRole('button', { name: new RegExp(`^${grade}\\b`) })

export async function startStudying(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: /Start studying/ }).click()
  await expect(anyCard(page)).toBeVisible()
}

export async function revealAndGrade(page: Page, grade: 'Again' | 'Good' | 'Easy' = 'Good') {
  await page.getByRole('button', { name: /Show answer/ }).click()
  await gradeButton(page, grade).click()
}

// ---------- backups (seeding through the real import UI) ----------

export interface SeedEvent {
  id: string
  kind: 'review' | 'known' | 'suspend' | 'flag'
  wordId: string
  ts: number
  deviceId: string
  dir?: 'listen' | 'say'
  grade?: 'again' | 'good' | 'easy'
  elapsedMs?: number
  suspended?: boolean
  reason?: string
  note?: string
}

export function backupJson(events: SeedEvent[]): string {
  return JSON.stringify({ app: 'qian', schemaVersion: 1, exportedAt: new Date().toISOString(), deviceId: 'e2e-seed', settings: {}, events })
}

let seq = 0
export function review(wordId: string, dir: 'listen' | 'say', grade: 'again' | 'good' | 'easy', ts: number): SeedEvent {
  return { id: `e2e-${++seq}-${ts}`, kind: 'review', wordId, dir, grade, ts, deviceId: 'e2e-seed', elapsedMs: 6000 }
}

const MIN = 60_000
const DAY = 86_400_000

/**
 * About a month of plausible history over the first `n` words: each word is introduced on its own
 * day, its listen card graduates the same day, the say card starts a day later, and reviews follow
 * at growing intervals with an occasional miss.
 */
export function seededHistory(n = 30, now = Date.now()): SeedEvent[] {
  const events: SeedEvent[] = []
  const start = new Date(now - 34 * DAY)
  start.setHours(9, 0, 0, 0)
  for (let i = 0; i < n; i++) {
    const w = WORDS[i]
    const intro = start.getTime() + i * DAY + i * 3 * MIN
    const steps = [0, 10 * MIN, 1 * DAY, 3 * DAY, 8 * DAY, 20 * DAY]
    steps.forEach((dt, j) => {
      for (const dir of ['listen', 'say'] as const) {
        const ts = intro + dt + (dir === 'say' ? 1 * DAY + 5 * MIN : 0)
        if (ts >= now - 5 * MIN) continue
        const g = (i + j + (dir === 'say' ? 2 : 0)) % 6 === 0 ? 'again' : (i + j) % 5 === 0 ? 'easy' : 'good'
        events.push(review(w.id, dir, j < 2 && g === 'again' ? 'good' : g, ts))
      }
    })
  }
  // One open flag, for the flagged-cards card.
  events.push({ id: 'e2e-flag-1', kind: 'flag', wordId: WORDS[3].id, reason: 'audio', note: 'clipped at the end', ts: now - 2 * DAY, deviceId: 'e2e-seed' })
  return events
}

/** Import a backup through Settings (merge), and wait for the summary. */
export async function importBackup(page: Page, json: string, name = 'qian-seed.json') {
  await page.goto('./#/settings')
  await page.getByTestId('import-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) })
  const dialog = page.getByRole('dialog', { name: 'Import backup' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Merge' }).click()
  await expect(page.getByTestId('import-summary')).toBeVisible()
}

/** "x of 1,000 introduced" on the Words page. */
export async function introducedCount(page: Page): Promise<number> {
  await page.goto('./#/words')
  const subtitle = page.getByText(/of [\d,]+ introduced/)
  await expect(subtitle).toBeVisible()
  const text = (await subtitle.textContent()) ?? ''
  return Number(text.split(' of ')[0].replace(/[^\d]/g, ''))
}
