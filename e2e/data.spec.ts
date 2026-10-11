import { readFile } from 'node:fs/promises'
import { backupJson, expect, importBackup, introducedCount, revealAndGrade, seededHistory, startStudying, test, WORDS } from './fixtures'

test('export -> reset -> import round trip restores progress', async ({ page }) => {
  await startStudying(page)
  await revealAndGrade(page, 'Good')
  await revealAndGrade(page, 'Again')
  await revealAndGrade(page, 'Easy')
  expect(await introducedCount(page)).toBe(3)

  // Export.
  await page.goto('./#/settings')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()])
  expect(download.suggestedFilename()).toMatch(/^qian-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const text = await readFile(await download.path(), 'utf8')
  const file = JSON.parse(text)
  expect(file.app).toBe('qian')
  expect(file.events.filter((e: { kind: string }) => e.kind === 'review')).toHaveLength(3)

  // Reset (two steps, typed confirmation).
  await page.getByRole('button', { name: 'Reset all data…' }).click()
  await page.getByRole('dialog', { name: 'Reset all data?' }).getByRole('button', { name: 'Continue' }).click()
  const confirm = page.getByRole('dialog', { name: 'Are you sure?' })
  await confirm.getByLabel('Confirmation').fill('reset')
  await confirm.getByRole('button', { name: 'Delete everything' }).click()
  await expect(page.getByText('All progress on this device was deleted.')).toBeVisible()
  expect(await introducedCount(page)).toBe(0)

  // Import the exported file.
  await importBackup(page, text, download.suggestedFilename())
  await expect(page.getByTestId('import-summary')).toContainText('Merged 3 new entries')
  expect(await introducedCount(page)).toBe(3)

  // And it survives a reload.
  await page.reload()
  expect(await introducedCount(page)).toBe(3)
})

test('importing the same backup twice adds nothing (merge is idempotent)', async ({ page }) => {
  const json = backupJson(seededHistory(5))
  await importBackup(page, json)
  await importBackup(page, json)
  await expect(page.getByTestId('import-summary')).toContainText('Nothing new')
})

test('stats page renders every section with data', async ({ page }) => {
  await importBackup(page, backupJson(seededHistory(30)))
  await page.goto('./#/stats')
  await expect(page.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible()
  for (const name of [/Progress through the 1,000/, 'Daily reviews', 'Accuracy', 'Upcoming reviews', 'Hardest words', 'Flagged cards']) {
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }
  await expect(page.getByText('Nothing to show yet')).toHaveCount(0)
  // Charts rendered (recharts SVG + the heatmap).
  await expect(page.locator('.recharts-surface').first()).toBeVisible()
  await expect(page.getByRole('img').first()).toBeVisible()

  // "Review" on the flagged-cards card opens the Words list filtered to flagged words.
  await page.getByRole('link', { name: /Review/ }).click()
  await expect(page).toHaveURL(/#\/words\?f=flagged$/)
  await expect(page.getByRole('radio', { name: /Flagged/ })).toHaveAttribute('aria-checked', 'true')
  const rows = page.getByRole('list', { name: 'Words' }).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(WORDS[3].gloss)
})

/** The flags CSV: a header row, then one row per open flag. */
function expectFlagsCsv(csv: string) {
  const lines = csv.trim().split('\n')
  expect(lines[0]).toBe('wordId,trad,pinyin,gloss,reason,note,flaggedAt,resolved')
  expect(lines).toHaveLength(2)
  const w = WORDS[3]
  expect(lines[1].startsWith(`${w.id},${w.trad},${w.pinyin},`), lines[1]).toBe(true)
  expect(lines[1]).toMatch(/,audio,clipped at the end,\d{4}-\d\d-\d\dT[\d:.]+Z,no$/)
}

test('flagged cards export as CSV (download)', async ({ page }) => {
  // Desktop browsers without file sharing get a download.
  await page.addInitScript(() => {
    delete (Navigator.prototype as { canShare?: unknown }).canShare
    delete (Navigator.prototype as { share?: unknown }).share
  })
  await importBackup(page, backupJson(seededHistory(30)))
  await page.goto('./#/stats')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export flags (CSV)' }).click()])
  expect(download.suggestedFilename()).toMatch(/^qian-flags-\d{4}-\d{2}-\d{2}\.csv$/)
  expectFlagsCsv(await readFile(await download.path(), 'utf8'))
})

test('flagged cards export as CSV (share sheet on phones)', async ({ page }) => {
  await page.addInitScript(() => {
    const shared: { name: string; type: string; text: string }[] = []
    ;(window as unknown as { __shared: typeof shared }).__shared = shared
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (d?: { files?: File[] }) => !!d?.files?.length })
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async (d: { files: File[] }) => {
        for (const f of d.files) shared.push({ name: f.name, type: f.type, text: await f.text() })
      },
    })
  })
  await importBackup(page, backupJson(seededHistory(30)))
  await page.goto('./#/stats')
  let downloaded = false
  page.on('download', () => (downloaded = true))
  await page.getByRole('button', { name: 'Export flags (CSV)' }).click()
  const sharedFiles = () => page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; text: string }[] }).__shared)
  await expect.poll(sharedFiles).toHaveLength(1)
  const [file] = await sharedFiles()
  expect(file.name).toMatch(/^qian-flags-\d{4}-\d{2}-\d{2}\.csv$/)
  expect(file.type).toBe('text/csv')
  expectFlagsCsv(file.text)
  expect(downloaded).toBe(false)
})
