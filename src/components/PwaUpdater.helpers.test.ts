import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHUNK_RELOAD_GAP_MS,
  CHUNK_RELOAD_KEY,
  createUpdateCheck,
  handleChunkError,
  RESUME_CHECK_GAP_MS,
  UPDATE_CHECK_MS,
  watchForUpdates,
} from './PwaUpdater.helpers'

function memStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('createUpdateCheck', () => {
  it('checks at most once per gap, and only online', () => {
    let t = 0
    let online = true
    const reg = { update: vi.fn(async () => undefined) }
    const check = createUpdateCheck(reg as unknown as ServiceWorkerRegistration, { now: () => t, online: () => online })
    expect(check()).toBe(false) // registration just checked
    t = RESUME_CHECK_GAP_MS
    expect(check()).toBe(true)
    expect(check()).toBe(false)
    t += RESUME_CHECK_GAP_MS
    online = false
    expect(check()).toBe(false)
    online = true
    expect(check()).toBe(true)
    expect(reg.update).toHaveBeenCalledTimes(2)
  })

  it('swallows update errors (e.g. offline mid-check)', async () => {
    const reg = { update: vi.fn(async () => Promise.reject(new Error('net'))) }
    const check = createUpdateCheck(reg as unknown as ServiceWorkerRegistration, { minGapMs: 0, online: () => true })
    expect(check()).toBe(true)
    await Promise.resolve()
  })
})

describe('watchForUpdates', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('checks hourly, when the app becomes visible again, and when back online', () => {
    vi.useFakeTimers()
    const check = vi.fn()
    const stop = watchForUpdates(check)
    vi.advanceTimersByTime(UPDATE_CHECK_MS)
    expect(check).toHaveBeenCalledTimes(1)

    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(check).toHaveBeenCalledTimes(1)
    vis.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(check).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('online'))
    expect(check).toHaveBeenCalledTimes(3)

    stop()
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(UPDATE_CHECK_MS)
    expect(check).toHaveBeenCalledTimes(3)
  })
})

describe('handleChunkError (vite:preloadError)', () => {
  it('reloads onto the new version once, then lets the error screen show', () => {
    const storage = memStorage()
    const reload = vi.fn()
    let t = 1_000_000
    const ev = () => new Event('vite:preloadError', { cancelable: true })

    const e1 = ev()
    expect(handleChunkError(e1, { storage, now: () => t, reload })).toBe(true)
    expect(e1.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(storage.m.get(CHUNK_RELOAD_KEY)).toBe(String(t))

    // Still broken right after the reload: don't loop.
    t += 5_000
    const e2 = ev()
    expect(handleChunkError(e2, { storage, now: () => t, reload })).toBe(false)
    expect(e2.defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)

    t += CHUNK_RELOAD_GAP_MS
    expect(handleChunkError(ev(), { storage, now: () => t, reload })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('does not reload without working storage (no loop guard)', () => {
    const reload = vi.fn()
    expect(handleChunkError(new Event('x', { cancelable: true }), { storage: null, reload })).toBe(false)
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
    }
    expect(handleChunkError(new Event('x', { cancelable: true }), { storage: throwing, reload })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
