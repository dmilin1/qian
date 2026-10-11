import {
  anyCard,
  backupJson,
  contentAudio,
  expect,
  gradeButton,
  importBackup,
  introducedCount,
  listenCard,
  revealAndGrade,
  review,
  sayCard,
  seededHistory,
  startStudying,
  test,
  WORDS,
} from './fixtures'

const [first, second, third] = WORDS

test.describe('study session', () => {
  test('first visit: start, listen card plays audio, reveal, grade Good, next card', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Ready to listen?' })).toBeVisible()
    await page.getByRole('button', { name: /Start studying/ }).click()

    // The most frequent word comes first, as a new Listen card with pinyin + characters.
    const card = listenCard(page)
    await expect(card).toBeVisible()
    await expect(card.getByText('New', { exact: true })).toBeVisible()
    await expect(card).toContainText(first.trad)
    await expect(card.locator('.pinyin').first()).toBeVisible()
    await expect(card.getByRole('button', { name: 'Replay word' })).toBeVisible()

    // Autoplay attempted (recorded clip or the browser-voice fallback).
    await expect.poll(() => contentAudio(page)).not.toHaveLength(0)

    // Reveal shows the meaning; grading moves on to the next word.
    await page.getByRole('button', { name: /Show answer/ }).click()
    await expect(card.getByRole('region', { name: 'Answer' })).toContainText(first.gloss)
    await expect(gradeButton(page, 'Again')).toBeVisible()
    await expect(gradeButton(page, 'Easy')).toBeVisible()
    await gradeButton(page, 'Good').click()

    await expect(listenCard(page)).toContainText(second.trad)
    await expect(page.getByRole('button', { name: /Show answer/ })).toBeVisible()

    // Replay plays the new word again.
    const before = (await contentAudio(page)).length
    await listenCard(page).getByRole('button', { name: 'Replay word' }).click()
    await expect.poll(async () => (await contentAudio(page)).length).toBeGreaterThan(before)
  })

  test('"I already know this" skips a new word', async ({ page }) => {
    await startStudying(page)
    await expect(listenCard(page)).toContainText(first.trad)
    await page.getByRole('button', { name: 'I already know this' }).click()
    await expect(page.getByText(/Marked .* as known/)).toBeVisible()
    await expect(listenCard(page)).toContainText(second.trad)
    // Offered only on a word's first appearance, and only before revealing.
    await page.getByRole('button', { name: /Show answer/ }).click()
    await expect(page.getByRole('button', { name: 'I already know this' })).toHaveCount(0)
  })

  test('undo restores the previous card on its front', async ({ page }) => {
    await startStudying(page)
    const undo = page.getByRole('button', { name: 'Undo last answer' })
    await expect(undo).toBeDisabled()
    await revealAndGrade(page, 'Good')
    await expect(listenCard(page)).toContainText(second.trad)
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect(listenCard(page)).toContainText(first.trad)
    await expect(page.getByRole('button', { name: /Show answer/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'I already know this' })).toBeVisible()
  })

  test('audio-only setting hides pinyin and characters on the listen front', async ({ page }) => {
    await page.goto('./#/settings')
    const front = page.getByRole('radiogroup', { name: 'Listen card front' })
    await front.getByRole('radio', { name: /Audio only/ }).click()
    await expect(front.getByRole('radio', { name: /Audio only/ })).toHaveAttribute('aria-checked', 'true')

    await page.goto('./')
    await page.getByRole('button', { name: /Start studying/ }).click()
    const card = listenCard(page)
    await expect(card.getByText('What does this mean?')).toBeVisible()
    await expect(card.locator('.pinyin')).toHaveCount(0)
    await expect(card).not.toContainText(first.trad)
    await expect(card.getByRole('button', { name: 'Replay word' })).toBeVisible()

    await page.getByRole('button', { name: /Show answer/ }).click()
    await expect(card.locator('.pinyin').first()).toBeVisible()
    await expect(card).toContainText(first.trad)
  })

  test('a Say card appears once the Listen card has graduated', async ({ page }) => {
    // Seed: the first word's Listen card graduated (two Good answers) on an earlier study day.
    const ago = Date.now() - 30 * 3600_000
    await importBackup(page, backupJson([review(first.id, 'listen', 'good', ago - 12 * 60_000), review(first.id, 'listen', 'good', ago)]))

    await startStudying(page)
    for (let i = 0; i < 12 && !(await sayCard(page).isVisible()); i++) {
      await revealAndGrade(page, 'Good')
      await expect(anyCard(page)).toBeVisible()
    }
    const card = sayCard(page)
    await expect(card).toBeVisible()
    // English prompt on the front; no pinyin and no replay (hearing it would give it away).
    await expect(card).toContainText(first.gloss)
    await expect(card.getByText('Say it out loud')).toBeVisible()
    await expect(card.locator('.pinyin')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Replay word' })).toHaveCount(0)

    const before = (await contentAudio(page)).length
    await page.getByRole('button', { name: /Show answer/ }).click()
    await expect(card.locator('.pinyin').first()).toBeVisible()
    await expect(card).toContainText(first.trad)
    await expect.poll(async () => (await contentAudio(page)).length).toBeGreaterThan(before)
  })

  test('a Say card follows on the next study day once the learning steps have passed (page.clock)', async ({ page }) => {
    await page.clock.install()
    await startStudying(page)
    await expect(listenCard(page)).toContainText(first.trad)
    await revealAndGrade(page, 'Good') // first word: the 10-minute learning step
    await expect(listenCard(page)).toContainText(second.trad)

    // Ten minutes later the first word's step is due, and it comes back before any new word.
    await page.clock.fastForward('10:30')
    await revealAndGrade(page, 'Good')
    await expect(listenCard(page)).toContainText(first.trad)
    await expect(listenCard(page).getByText('New', { exact: true })).toHaveCount(0)
    await revealAndGrade(page, 'Good') // graduates

    // Its Say card waits for the next study day, so it is not answered from short-term memory.
    for (let i = 0; i < 4; i++) {
      await expect(anyCard(page)).toBeVisible()
      await expect(sayCard(page)).toHaveCount(0)
      await revealAndGrade(page, 'Good')
    }
    await page.clock.fastForward('24:00:00')

    for (let i = 0; i < 12 && !(await sayCard(page).isVisible()); i++) {
      await revealAndGrade(page, 'Good')
      await expect(anyCard(page)).toBeVisible()
    }
    await expect(sayCard(page)).toContainText(first.gloss)
    await expect(sayCard(page).getByText('New', { exact: true })).toBeVisible()
  })

  test('progress persists across a reload (IndexedDB)', async ({ page }) => {
    await startStudying(page)
    await revealAndGrade(page, 'Good')
    await expect(listenCard(page)).toContainText(second.trad)
    await revealAndGrade(page, 'Good')
    await expect(listenCard(page)).toContainText(third.trad)

    await page.reload()
    expect(await introducedCount(page)).toBe(2)
    await page.goto('./')
    await page.getByRole('button', { name: /Start studying/ }).click()
    // The first two words are in learning (due in minutes), so the next new word is up.
    await expect(listenCard(page)).toContainText(third.trad)
  })

  test('the header progress line says "in progress" and stays on one line on a narrow phone', async ({ page }) => {
    await importBackup(page, backupJson(seededHistory(30)))
    await startStudying(page)
    const line = page.getByLabel('Progress')
    // "in progress" = the working set; "learning" is kept for short learning steps (Words page filter).
    await expect(line).toContainText(/\d+\/\d+ in progress/)
    await expect(line).not.toContainText('learning')
    await expect(line.getByTitle(/working set/)).toContainText('in progress')

    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 800 })
      if (!(await anyCard(page).isVisible())) {
        await page.getByRole('button', { name: /Start studying/ }).click()
        await expect(anyCard(page)).toBeVisible()
      }
      // Real numbers, then the widest the line can get: 3-digit due count, cap at its maximum, every word introduced.
      for (const widest of [false, true]) {
        const layout = await line.evaluate((p, widest) => {
          const values = [...p.querySelectorAll(':scope > [title] > span:first-child')]
          if (widest) ['999', '40/40', '1000'].forEach((v, i) => (values[i].firstChild!.textContent = v))
          const tops = new Set([...p.children].map((el) => Math.round(el.getBoundingClientRect().top)))
          return { lines: tops.size, overflow: document.documentElement.scrollWidth > window.innerWidth }
        }, widest)
        expect(layout, `width ${width}${widest ? ' (widest numbers)' : ''}`).toEqual({ lines: 1, overflow: false })
      }
      await page.reload() // drop the edited numbers (back on the start screen)
      await expect(page.getByRole('button', { name: /Start studying/ })).toBeVisible()
    }
  })
})

test.describe('keyboard shortcuts', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only')

  test('Space starts and reveals, 2 grades, Z undoes, K marks known, R replays', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Ready to listen?' })).toBeVisible()
    await page.keyboard.press('Space')
    await expect(listenCard(page)).toContainText(first.trad)

    await page.keyboard.press('Space')
    await expect(gradeButton(page, 'Good')).toBeVisible()
    const before = (await contentAudio(page)).length
    await page.keyboard.press('r')
    await expect.poll(async () => (await contentAudio(page)).length).toBeGreaterThan(before)

    await page.keyboard.press('2')
    await expect(listenCard(page)).toContainText(second.trad)
    await page.keyboard.press('z')
    await expect(listenCard(page)).toContainText(first.trad)
    await expect(page.getByRole('button', { name: /Show answer/ })).toBeVisible()

    await page.keyboard.press('k')
    await expect(page.getByText(/Marked .* as known/)).toBeVisible()
    await expect(listenCard(page)).toContainText(second.trad)
  })

  test('after clicking Undo, Space reveals the restored card instead of undoing again', async ({ page }) => {
    await startStudying(page)
    await revealAndGrade(page, 'Good')
    await expect(listenCard(page)).toContainText(second.trad)
    await revealAndGrade(page, 'Good')
    await expect(listenCard(page)).toContainText(third.trad)

    const undo = page.getByRole('button', { name: 'Undo last answer' })
    await undo.click() // mouse focus stays on Undo, which can still undo the first answer
    await expect(listenCard(page)).toContainText(second.trad)
    await expect(undo).toBeEnabled()

    await page.keyboard.press('Space')
    await expect(listenCard(page).getByRole('region', { name: 'Answer' })).toContainText(second.gloss)
    await expect(listenCard(page)).toContainText(second.trad)
    await expect(gradeButton(page, 'Good')).toBeVisible()
    // The first answer was not undone.
    await expect(undo).toBeEnabled()
    expect(await introducedCount(page)).toBe(1)
  })
})
