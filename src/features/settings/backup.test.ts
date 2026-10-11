import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupOverdue, saveBackup } from './backup'

const DAY = 24 * 60 * 60 * 1000

function fakeStore() {
  return {
    exportData: vi.fn(async (o: { record?: boolean } = {}) => ({ filename: 'qian-backup-2026-10-11.json', text: '{}', exportedAt: 123, record: o.record })),
    markExported: vi.fn(async () => {}),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'share')
})

describe('saveBackup', () => {
  it('a dismissed share sheet records no backup', async () => {
    const store = fakeStore()
    Object.defineProperty(navigator, 'share', { value: vi.fn(async () => Promise.reject(new DOMException('cancel', 'AbortError'))), configurable: true })
    expect(await saveBackup(store, 'share')).toBeNull()
    expect(store.exportData).toHaveBeenCalledWith({ record: false })
    expect(store.markExported).not.toHaveBeenCalled()
  })

  it('records the backup once the share sheet succeeds', async () => {
    const store = fakeStore()
    Object.defineProperty(navigator, 'share', { value: vi.fn(async () => {}), configurable: true })
    expect(await saveBackup(store, 'share')).toBe('qian-backup-2026-10-11.json')
    expect(store.markExported).toHaveBeenCalledWith(123)
  })

  it('records a download', async () => {
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:x'), configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const store = fakeStore()
    expect(await saveBackup(store, 'download')).toBe('qian-backup-2026-10-11.json')
    expect(click).toHaveBeenCalled()
    expect(store.markExported).toHaveBeenCalledWith(123)
  })
})

describe('backupOverdue', () => {
  it('needs progress, and no export or one older than 14 days', () => {
    const now = Date.UTC(2026, 9, 11)
    expect(backupOverdue(0, null, now)).toBe(false)
    expect(backupOverdue(3, null, now)).toBe(true)
    expect(backupOverdue(3, now - 14 * DAY, now)).toBe(false)
    expect(backupOverdue(3, now - 15 * DAY, now)).toBe(true)
  })
})
