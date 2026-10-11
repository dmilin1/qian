// The recorded ElevenLabs clips, played through a real <audio> element under /qian/ (only
// speechSynthesis is stubbed, so a fallback to the browser voice would show up in the log).
import { audioLog, clipUrl, expect, listenCard, mediaEvents, MANIFEST, spokenText, startStudying, test, wordByTrad, WORDS } from './fixtures'

test.use({ audioStub: 'speech' })

const first = WORDS[0]

test('every word and example has a versioned clip in the manifest', () => {
  for (const w of WORDS) {
    const e = MANIFEST.entries[w.id]
    expect(e?.word, w.id).toMatch(new RegExp(`^audio/w/${w.id}-[0-9a-f]{8}\\.mp3$`))
    expect(e?.example, w.id).toMatch(new RegExp(`^audio/s/${w.id}-[0-9a-f]{8}\\.mp3$`))
  }
})

test('the Listen card plays the recorded clip, not the browser voice', async ({ page, request, baseURL }) => {
  const url = clipUrl(baseURL!, first.id)
  expect(new URL(url).pathname).toMatch(new RegExp(`^/qian/audio/w/${first.id}-[0-9a-f]{8}\\.mp3$`))
  const served: { status: number; type: string }[] = []
  page.on('response', (res) => {
    if (res.url() === url) served.push({ status: res.status(), type: res.headers()['content-type'] ?? '' })
  })

  await startStudying(page)
  await expect(listenCard(page)).toContainText(first.trad)

  // Autoplay set the shared <audio> element to the versioned clip...
  await expect.poll(async () => (await audioLog(page)).media).toContain(url)
  // ...which the browser fetched as an mp3 (a media request may be a 206 range response)...
  await expect.poll(() => served.length).toBeGreaterThan(0)
  expect(served[0].status === 200 || served[0].status === 206, `status ${served[0].status}`).toBe(true)
  expect(served[0].type).toContain('audio/mpeg')
  // ...and played to the end without an error, so no speechSynthesis fallback.
  await expect.poll(() => mediaEvents(page, url), { timeout: 15_000 }).toContain('ended')
  expect(await mediaEvents(page, url)).not.toContain('error')
  expect(await spokenText(page)).toEqual([])

  // A plain GET of the same URL is the whole file: 200, audio/mpeg, an MP3 (ID3 tag or frame sync).
  const res = await request.get(url)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('audio/mpeg')
  const body = await res.body()
  expect(body.length).toBeGreaterThan(2000)
  expect(body.subarray(0, 3).toString('latin1') === 'ID3' || (body[0] === 0xff && (body[1] & 0xe0) === 0xe0)).toBe(true)
})

test('Settings → Test playback reports a recorded clip', async ({ page, baseURL }) => {
  const sample = wordByTrad('你好')
  const url = clipUrl(baseURL!, sample.id)
  await page.goto('./#/settings')
  await expect(page.getByText(/High-quality recordings/)).toContainText(`all ${WORDS.length} words`)
  await page.getByRole('button', { name: /Test playback/ }).click()
  await expect(page.getByText('Played a recorded clip. Audio is working.')).toBeVisible({ timeout: 15_000 })
  expect((await audioLog(page)).media).toContain(url)
  expect(await spokenText(page)).toEqual([])
})
