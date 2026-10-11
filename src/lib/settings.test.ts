import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY, validateSettings } from './settings'

describe('settings', () => {
  beforeEach(() => localStorage.clear())

  it('defaults', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS).toMatchObject({
      listenFront: 'full',
      showCharacters: true,
      toneColors: true,
      autoplay: true,
      slowRate: 0.7,
      requestRetention: 0.9,
      workingSetCap: 30,
      stableDays: 5,
      backlogLimit: 10,
      theme: 'system',
    })
  })

  it('round trips through localStorage', () => {
    const s = { ...DEFAULT_SETTINGS, listenFront: 'audioOnly' as const, theme: 'dark' as const, workingSetCap: 20 }
    expect(saveSettings(s)).toBe(true)
    expect(loadSettings()).toEqual(s)
  })

  it('validates: wrong types fall back, numbers are clamped and rounded', () => {
    const v = validateSettings({
      listenFront: 'nope',
      showCharacters: 'yes',
      slowRate: 5,
      requestRetention: 0.2,
      workingSetCap: 12.6,
      stableDays: NaN,
      backlogLimit: -3,
      theme: 'dark',
    })
    expect(v.listenFront).toBe('full')
    expect(v.showCharacters).toBe(true)
    expect(v.slowRate).toBe(1)
    expect(v.requestRetention).toBe(0.7)
    expect(v.workingSetCap).toBe(13)
    expect(v.stableDays).toBe(5)
    expect(v.backlogLimit).toBe(0)
    expect(v.theme).toBe('dark')
    expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('survives corrupt JSON and throwing storage', () => {
    localStorage.setItem(SETTINGS_KEY, '{not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    const throwing = {
      getItem() {
        throw new Error('SecurityError')
      },
      setItem() {
        throw new Error('QuotaExceeded')
      },
      removeItem() {},
    } as unknown as Storage
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS)
    expect(saveSettings(DEFAULT_SETTINGS, throwing)).toBe(false)
    expect(saveSettings(DEFAULT_SETTINGS, null)).toBe(false)
  })
})
