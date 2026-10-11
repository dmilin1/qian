import { contentAudio, expect, test, wordByTrad, WORDS } from './fixtures'

test('words page lists all words in rank order and searches by pinyin, English and characters', async ({ page }) => {
  await page.goto('./#/words')
  await expect(page.getByRole('heading', { name: 'Words', level: 1 })).toBeVisible()
  await expect(page.getByText(/0 of 1,000 introduced/)).toBeVisible()
  const rows = page.getByRole('list', { name: 'Words' }).getByRole('listitem')
  await expect(rows.first()).toContainText(WORDS[0].trad)

  const search = page.getByRole('searchbox')
  const nihao = wordByTrad('你好')
  for (const q of ['ni hao', 'ni3hao3', 'nǐ hǎo', '你好']) {
    await search.fill(q)
    await expect(rows.first()).toContainText(nihao.trad)
  }
  // The query is kept in the URL.
  await expect(page).toHaveURL(/#\/words\?q=/)

  await search.fill('thank')
  await expect(rows.filter({ hasText: wordByTrad('謝謝').trad })).toHaveCount(1)

  await search.fill('zzzzqx')
  await expect(page.getByText('No matching words')).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(rows.first()).toContainText(WORDS[0].trad)
})

test('word detail: open from the list, play audio, flag, suspend, back keeps the search', async ({ page }) => {
  const w = wordByTrad('朋友')
  await page.goto('./#/words?q=pengyou')
  const rows = page.getByRole('list', { name: 'Words' }).getByRole('listitem')
  await expect(rows.first()).toContainText(w.trad)

  // Row audio button plays without opening the word.
  await rows.first().getByRole('button', { name: `Play ${w.pinyin}` }).click()
  await expect.poll(() => contentAudio(page)).not.toHaveLength(0)
  await expect(page).toHaveURL(/#\/words\?q=pengyou$/)

  await rows.first().getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`#/words/${w.id}$`))
  await expect(page.getByRole('heading', { level: 1 })).toContainText(w.pinyin.split(' ')[0])
  await expect(page.getByText(w.gloss).first()).toBeVisible()
  await expect(page).toHaveTitle(new RegExp(`${w.trad} · 千 qian$`))

  // Flag the word.
  await page.getByRole('button', { name: 'Flag a problem' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Wrong pinyin or tones' }).check()
  await dialog.getByRole('textbox').fill('e2e check')
  await dialog.getByRole('button', { name: 'Flag word' }).click()
  await expect(page.getByRole('list', { name: 'Open flags' })).toContainText(/pinyin/i)

  // Suspend and unsuspend.
  await page.getByRole('button', { name: 'Suspend', exact: true }).click()
  await expect(page.getByText('Suspended words are skipped when studying.')).toBeVisible()
  await page.getByRole('button', { name: 'Unsuspend', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible()

  // Back returns to the filtered list.
  await page.getByRole('main').getByRole('link', { name: 'Words', exact: true }).click()
  await expect(page).toHaveURL(/#\/words\?q=pengyou$/)
  await expect(page.getByRole('searchbox')).toHaveValue('pengyou')
})
