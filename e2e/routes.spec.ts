import { anyCard, expect, test, WORDS } from './fixtures'

// Hash routes under the GitHub Pages base path. The auto fixture fails any test whose page logs a
// console error or throws, so this also covers "no console errors on any page".
const ROUTES: { hash: string; heading: RegExp | string; title: RegExp }[] = [
  { hash: '#/', heading: 'Ready to listen?', title: /^千 qian$/ },
  { hash: '#/words', heading: 'Words', title: /^Words · 千 qian$/ },
  { hash: `#/words/${WORDS[1].id}`, heading: new RegExp(WORDS[1].pinyin), title: new RegExp(`${WORDS[1].trad} · 千 qian$`) },
  { hash: '#/stats', heading: 'Stats', title: /^Stats · 千 qian$/ },
  { hash: '#/settings', heading: 'Settings', title: /^Settings · 千 qian$/ },
]

for (const r of ROUTES) {
  test(`deep link ${r.hash} loads directly`, async ({ page }) => {
    await page.goto(`./${r.hash}`)
    await expect(page.getByRole('heading', { level: 1, name: r.heading })).toBeVisible()
    await expect(page).toHaveTitle(r.title)
    // Assets resolve under /qian/ (a broken base would leave the page unstyled or blank).
    expect(new URL(page.url()).pathname).toBe('/qian/')
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  })
}

test('unknown routes and unknown words are handled', async ({ page }) => {
  await page.goto('./#/no-such-page')
  await expect(page).toHaveURL(/\/qian\/#\/$/)
  await expect(page.getByRole('heading', { name: 'Ready to listen?' })).toBeVisible()

  await page.goto('./#/words/not-a-word')
  await expect(page.getByRole('heading', { name: 'Word not found' })).toBeVisible()
})

test('navigation reaches every section', async ({ page, isMobile }) => {
  await page.goto('./')
  const nav = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true })
  await expect(nav).toHaveCount(1)
  // Phones get the bottom tab bar, wider screens the top bar.
  const box = await nav.boundingBox()
  const viewport = page.viewportSize()!
  if (isMobile) expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 5)
  else expect(box!.y).toBeLessThan(100)

  for (const label of ['Words', 'Stats', 'Settings'] as const) {
    await nav.getByRole('link', { name: label }).click()
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible()
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  }
  // Back on Study after a tap anywhere: audio is already unlocked, so the card shows directly.
  await nav.getByRole('link', { name: 'Study' }).click()
  await expect(anyCard(page)).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Study' })).toHaveAttribute('aria-current', 'page')
})

test('no horizontal scrolling on any page', async ({ page }) => {
  for (const r of ROUTES) {
    await page.goto(`./${r.hash}`)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, r.hash).toBeLessThanOrEqual(0)
  }
})
