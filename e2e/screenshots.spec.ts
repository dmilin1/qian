// Screenshots of every page in light and dark, on a phone (Pixel 7) and on desktop, saved to
// docs/screenshots/. Runs in the Chromium projects only (WebKit would just duplicate the phone set).
import type { Page } from '@playwright/test'
import { anyCard, backupJson, expect, gradeButton, importBackup, sayCard, seededHistory, test, wordByTrad } from './fixtures'

const OUT = 'docs/screenshots'

test.describe.configure({ mode: 'parallel' })
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium projects only')

for (const theme of ['light', 'dark'] as const) {
  test(`screenshots (${theme})`, async ({ page, isMobile }) => {
    test.setTimeout(90_000)
    const device = isMobile ? 'mobile' : 'desktop'
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    const shot = async (name: string, fullPage = false) => {
      await page.evaluate(() => document.fonts.ready)
      // In a full-page capture a fixed tab bar would land mid-page; put it back in the page flow (at the end).
      const style = fullPage ? await page.addStyleTag({ content: 'nav[aria-label="Main"].fixed { position: static !important; }' }) : null
      await page.screenshot({ path: `${OUT}/${device}-${theme}-${name}.png`, fullPage, animations: 'disabled' })
      await style?.evaluate((el) => (el as Element).remove())
    }

    // A returning learner: about a month of history over 30 words.
    await importBackup(page, backupJson(seededHistory(30)))

    // Study: start screen, listen front, answer.
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Ready to listen?' })).toBeVisible()
    await shot('study-start')
    await page.getByRole('button', { name: /Start studying/ }).click()
    await expect(anyCard(page)).toBeVisible()
    await shot('study-card')
    await page.getByRole('button', { name: /Show answer/ }).click()
    await expect(page.getByRole('region', { name: 'Answer' })).toBeVisible()
    await shot('study-answer')
    await findSayCard(page)
    if (await sayCard(page).isVisible()) {
      await shot('study-say')
      await page.getByRole('button', { name: /Show answer/ }).click()
      await expect(page.getByRole('region', { name: 'Answer' })).toBeVisible()
      await shot('study-say-answer')
    }

    // Words list, search, detail.
    await page.goto('./#/words')
    await expect(page.getByRole('list', { name: 'Words' }).getByRole('listitem').first()).toBeVisible()
    await shot('words')
    await page.getByRole('searchbox').fill('hao')
    await expect(page.getByRole('list', { name: 'Words' }).getByRole('listitem').first()).toBeVisible()
    await shot('words-search')
    await page.goto(`./#/words/${seededWordId()}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await shot('word-detail', true)

    // Stats and settings (full page).
    await page.goto('./#/stats')
    await expect(page.getByRole('heading', { name: 'Daily reviews' })).toBeVisible()
    await expect(page.locator('.recharts-surface').first()).toBeVisible()
    await shot('stats', true)
    await page.goto('./#/settings')
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    await shot('settings', true)
  })
}

/** Grade through cards (Good) until a Say card is up, for at most a few cards. */
async function findSayCard(page: Page) {
  for (let i = 0; i < 15 && !(await sayCard(page).isVisible()); i++) {
    if (!(await anyCard(page).isVisible())) return
    const show = page.getByRole('button', { name: /Show answer/ })
    if (await show.isVisible()) await show.click()
    await gradeButton(page, 'Good').click()
    await expect(page.getByRole('group', { name: 'Grade' })).toHaveCount(0)
  }
}

/** A word from the seeded history with a few reviews, for the detail page. */
function seededWordId(): string {
  return wordByTrad('我').id
}
