import { describe, expect, it, vi } from 'vitest'
import { FIXTURE_MANIFEST, FIXTURE_WORDS } from '../../lib/__fixtures__/words'
import { createManifest, createWordIndex } from '../../lib/words'
import { AUDIO_CACHE, countCached, downloadClips, formatBytes, manifestClipUrls, recordedWordCount } from './audioCache'

const abs = (u: string) => new URL(u, location.href).href

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const open = vi.fn(async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const m = stores.get(name)!
    return {
      match: async (u: string) => m.get(abs(u)),
      put: vi.fn(async (u: string, r: Response) => void m.set(abs(u), r)),
      keys: async () => [...m.keys()].map((url) => ({ url })),
    } as unknown as Cache
  })
  const cs = {
    open,
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
  } as unknown as CacheStorage
  return { cs, stores, open }
}

const okFetch = (size = 10) =>
  vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    return new Response(new Uint8Array(size), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
  })

describe('audioCache', () => {
  const words = createWordIndex(FIXTURE_WORDS)
  const manifest = createManifest(FIXTURE_MANIFEST)

  it('lists every manifest clip once, joined onto the base', () => {
    expect(manifestClipUrls(words, manifest, '/qian/')).toEqual([
      '/qian/audio/w/w4f60.mp3',
      '/qian/audio/s/w4f60.mp3',
      '/qian/audio/w/w6211.mp3',
    ])
    expect(recordedWordCount(words, manifest)).toBe(2)
  })

  it('downloads every clip into the qian-audio cache with progress', async () => {
    const { cs, stores, open } = fakeCaches()
    const urls = ['/a.mp3', '/b.mp3', '/c.mp3']
    const fetchFn = okFetch(100)
    const progress = vi.fn()
    const r = await downloadClips(urls, { cacheStorage: cs, fetchFn: fetchFn as unknown as typeof fetch, onProgress: progress, concurrency: 2 })
    expect(open).toHaveBeenCalledWith(AUDIO_CACHE)
    expect(r).toMatchObject({ status: 'complete', done: 3, total: 3, failed: 0, skipped: 0, bytes: 300 })
    expect(stores.get('qian-audio')!.size).toBe(3)
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ done: 3, total: 3 }))
    expect(await countCached(urls, cs)).toBe(3)
  })

  it('skips clips that are already cached', async () => {
    const { cs } = fakeCaches()
    const fetchFn = okFetch()
    await downloadClips(['/a.mp3'], { cacheStorage: cs, fetchFn: fetchFn as unknown as typeof fetch })
    const r = await downloadClips(['/a.mp3', '/b.mp3'], { cacheStorage: cs, fetchFn: fetchFn as unknown as typeof fetch })
    expect(r).toMatchObject({ status: 'complete', done: 2, skipped: 1 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('counts failed clips and keeps going', async () => {
    const { cs } = fakeCaches()
    const fetchFn = vi.fn(async (url: string) => (url.includes('bad') ? new Response('', { status: 404 }) : new Response('x', { status: 200 })))
    const r = await downloadClips(['/a.mp3', '/bad.mp3', '/c.mp3'], { cacheStorage: cs, fetchFn: fetchFn as unknown as typeof fetch })
    expect(r).toMatchObject({ status: 'complete', done: 3, failed: 1 })
    expect(await countCached(['/a.mp3', '/bad.mp3', '/c.mp3'], cs)).toBe(2)
  })

  it('stops when cancelled', async () => {
    const { cs } = fakeCaches()
    const ctl = new AbortController()
    let n = 0
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      if (++n === 2) ctl.abort()
      return new Response('x', { status: 200 })
    })
    const urls = Array.from({ length: 20 }, (_, i) => `/c${i}.mp3`)
    const r = await downloadClips(urls, { cacheStorage: cs, fetchFn: fetchFn as unknown as typeof fetch, signal: ctl.signal, concurrency: 1 })
    expect(r.status).toBe('cancelled')
    expect(r.done).toBeLessThan(20)
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('stops with an error when storage is full', async () => {
    const { cs } = fakeCaches()
    const cache = await cs.open(AUDIO_CACHE)
    ;(cache.put as ReturnType<typeof vi.fn>).mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    vi.spyOn(cs, 'open').mockResolvedValue(cache)
    const r = await downloadClips(['/a.mp3', '/b.mp3'], { cacheStorage: cs, fetchFn: okFetch() as unknown as typeof fetch, concurrency: 1 })
    expect(r.status).toBe('error')
    expect(r.error).toMatch(/out of storage/)
  })

  it('reports an error without Cache Storage', async () => {
    const r = await downloadClips(['/a.mp3'], { cacheStorage: null })
    expect(r.status).toBe('error')
    expect(await countCached(['/a.mp3'], null)).toBe(0)
  })

  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
