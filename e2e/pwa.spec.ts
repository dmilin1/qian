import { expect, test } from './fixtures'

test.describe('PWA', () => {
  test.use({ serviceWorkers: 'allow' })
  // Service workers in Playwright are reliable in Chromium only.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only')

  test('manifest is linked and valid, and icons load', async ({ page, request }) => {
    await page.goto('./')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBeTruthy()
    const res = await request.get(new URL(href!, page.url()).toString())
    expect(res.ok()).toBe(true)
    const manifest = await res.json()
    expect(manifest).toMatchObject({
      name: '千 qian - Mandarin by ear',
      short_name: 'qian',
      start_url: '/qian/',
      scope: '/qian/',
      display: 'standalone',
    })
    const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose ?? 'any')
    expect(purposes).toContain('maskable')
    for (const icon of manifest.icons) {
      const r = await request.get(new URL(icon.src, new URL(href!, page.url())).toString())
      expect(r.ok(), icon.src).toBe(true)
      expect(r.headers()['content-type']).toContain('image/png')
    }
    const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
    expect((await request.get(new URL(apple!, page.url()).toString())).ok()).toBe(true)
  })

  test('service worker precaches the app (no audio) and serves it offline', async ({ page, context }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Ready to listen?' })).toBeVisible()
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
    expect(new URL(scope).pathname).toBe('/qian/')
    // autoUpdate uses clientsClaim, so the first page load becomes controlled.
    await page.evaluate(
      () => navigator.serviceWorker.controller ?? new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })),
    )

    const cached = await page.evaluate(async () => {
      const urls: string[] = []
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(req.url)
      return urls
    })
    expect(cached.some((u) => /\/qian\/index\.html/.test(u))).toBe(true)
    expect(cached.some((u) => /\/assets\/words-.*\.js/.test(u))).toBe(true)
    expect(cached.some((u) => /\/audio\//.test(u))).toBe(false)

    // Offline: reload and deep-link still work from the precache.
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Ready to listen?' })).toBeVisible()
    await page.goto('./#/words')
    await expect(page.getByRole('heading', { name: 'Words', level: 1 })).toBeVisible()
    await context.setOffline(false)
  })

  test('audio is runtime-cached (CacheFirst) into the qian-audio cache', async ({ request }) => {
    const sw = await (await request.get('sw.js')).text()
    expect(sw).toMatch(/CacheFirst\(\{cacheName:"qian-audio"/)
    expect(sw).toContain('RangeRequestsPlugin')
    expect(sw).not.toMatch(/url:"[^"]*audio\//)
  })
})
