// "Download all audio for offline": fetch every manifest clip into Cache Storage.
// The service worker's runtime cache for audio/* uses the same cache name, so clips cached
// here are served offline, and clips the SW cached while studying count as already done.
import type { WordIndex, Manifest } from '../../lib/words'
import { resolveAudioUrl } from '../../lib/words'

export const AUDIO_CACHE = 'qian-audio'

/** Every clip URL in the manifest (word + example), in word rank order, de-duplicated. */
export function manifestClipUrls(words: WordIndex, manifest: Manifest, base?: string): string[] {
  const out = new Set<string>()
  for (const id of words.order) {
    for (const kind of ['word', 'example'] as const) {
      const p = manifest.path(id, kind)
      if (p) out.add(resolveAudioUrl(p, base))
    }
  }
  return [...out]
}

/** Count of words that have a recorded word clip. */
export function recordedWordCount(words: WordIndex, manifest: Manifest): number {
  let n = 0
  for (const id of words.order) if (manifest.path(id, 'word')) n++
  return n
}

export function cacheStorageAvailable(cs: CacheStorage | undefined | null = globalThis.caches): cs is CacheStorage {
  return !!cs && typeof cs.open === 'function'
}

const absolute = (url: string) => {
  try {
    return new URL(url, globalThis.location?.href ?? 'http://localhost/').href
  } catch {
    return url
  }
}

/** How many of `urls` are already in the audio cache (0 if Cache Storage is unavailable). */
export async function countCached(urls: readonly string[], cs: CacheStorage | undefined | null = globalThis.caches): Promise<number> {
  if (!cacheStorageAvailable(cs) || urls.length === 0) return 0
  try {
    if (!(await cs.has(AUDIO_CACHE))) return 0
    const cache = await cs.open(AUDIO_CACHE)
    const keys = new Set((await cache.keys()).map((r) => r.url))
    let n = 0
    for (const u of urls) if (keys.has(absolute(u))) n++
    return n
  } catch {
    return 0
  }
}

export interface DownloadProgress {
  /** Clips finished (downloaded now, or already cached). */
  done: number
  total: number
  /** Clips that could not be fetched. */
  failed: number
  /** Clips that were already in the cache. */
  skipped: number
  /** Bytes downloaded in this run (from Content-Length / body size). */
  bytes: number
}

export interface DownloadResult extends DownloadProgress {
  status: 'complete' | 'cancelled' | 'error'
  /** Set when status is 'error' (e.g. storage full). */
  error?: string
}

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?: (p: DownloadProgress) => void
  concurrency?: number
  cacheStorage?: CacheStorage | null
  fetchFn?: typeof fetch
}

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError'
const isQuota = (e: unknown) => (e as { name?: string })?.name === 'QuotaExceededError'

/**
 * Download every URL into the 'qian-audio' cache, skipping ones already cached. A failed clip
 * is counted and skipped; running out of storage stops the whole download. Resolves (never
 * rejects) with the final counts.
 */
export async function downloadClips(urls: readonly string[], opts: DownloadOptions = {}): Promise<DownloadResult> {
  const cs = opts.cacheStorage !== undefined ? opts.cacheStorage : globalThis.caches
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis)
  const p: DownloadProgress = { done: 0, total: urls.length, failed: 0, skipped: 0, bytes: 0 }
  const report = () => opts.onProgress?.({ ...p })
  if (!cacheStorageAvailable(cs)) return { ...p, status: 'error', error: 'This browser cannot store files for offline use.' }

  let cache: Cache
  try {
    cache = await cs.open(AUDIO_CACHE)
  } catch (e) {
    return { ...p, status: 'error', error: `Could not open offline storage (${(e as Error)?.message ?? e}).` }
  }

  let next = 0
  let fatal: string | null = null
  const signal = opts.signal
  const stopped = () => signal?.aborted || fatal !== null

  async function one(url: string) {
    if (await cache.match(url)) {
      p.skipped++
      return
    }
    const res = await fetchFn(url, { signal, credentials: 'same-origin' })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    // Store a fully-read copy so a later Range request can be answered from cache.
    const blob = await res.blob()
    const headers = new Headers(res.headers)
    headers.set('Content-Length', String(blob.size))
    await cache.put(url, new Response(blob, { status: 200, statusText: 'OK', headers }))
    p.bytes += blob.size
  }

  async function worker() {
    while (!stopped() && next < urls.length) {
      const url = urls[next++]
      try {
        await one(url)
      } catch (e) {
        if (isAbort(e) || signal?.aborted) return
        if (isQuota(e)) {
          fatal = 'Your device is out of storage space for offline audio.'
          return
        }
        p.failed++
      }
      p.done++
      report()
    }
  }

  report()
  const n = Math.max(1, Math.min(opts.concurrency ?? 6, urls.length || 1))
  await Promise.all(Array.from({ length: n }, worker))
  if (fatal) return { ...p, status: 'error', error: fatal }
  if (signal?.aborted) return { ...p, status: 'cancelled' }
  return { ...p, status: 'complete' }
}

/**
 * Delete cached clips that the current manifest no longer references. Clip URLs are
 * content-versioned ("audio/w/<id>-<hash8>.mp3", see scripts/audio/generate.py), so a regenerated
 * clip has a new URL and its old copy would otherwise sit in the never-expiring 'qian-audio' cache
 * forever. Only keys under /audio/ are touched. Resolves with the number of entries removed.
 */
export async function pruneAudioCache(
  validUrls: readonly string[],
  cs: CacheStorage | undefined | null = globalThis.caches,
): Promise<number> {
  if (!cacheStorageAvailable(cs)) return 0
  try {
    if (!(await cs.has(AUDIO_CACHE))) return 0
    const cache = await cs.open(AUDIO_CACHE)
    const keep = new Set(validUrls.map(absolute))
    let n = 0
    for (const req of await cache.keys()) {
      if (keep.has(req.url) || !new URL(req.url).pathname.includes('/audio/')) continue
      if (await cache.delete(req)) n++
    }
    return n
  } catch {
    return 0
  }
}

/** Remove the offline audio cache entirely. */
export async function clearAudioCache(cs: CacheStorage | undefined | null = globalThis.caches): Promise<boolean> {
  if (!cacheStorageAvailable(cs)) return false
  try {
    return await cs.delete(AUDIO_CACHE)
  } catch {
    return false
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
