// Backup helpers shared by Settings > Your data and the Study screen's reminder banner.
import { downloadText } from '../../lib/exportImport'
import type { AppStore } from '../../lib/store'

const DAY_MS = 24 * 60 * 60 * 1000
/** Remind to export when the last backup is older than this. */
export const EXPORT_REMINDER_DAYS = 14

export function daysSince(t: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - t) / DAY_MS))
}

/** There is progress, and no backup yet or the last one is older than EXPORT_REMINDER_DAYS. */
export function backupOverdue(eventCount: number, lastExportAt: number | null, now = Date.now()): boolean {
  return eventCount > 0 && (lastExportAt === null || daysSince(lastExportAt, now) > EXPORT_REMINDER_DAYS)
}

/** Whether the Web Share API can share a file (iOS / Android "Save to Files" etc.). */
export function canShareFiles(): boolean {
  try {
    const nav = globalThis.navigator
    if (typeof nav?.canShare !== 'function' || typeof File === 'undefined') return false
    return nav.canShare({ files: [new File(['{}'], 'test.json', { type: 'application/json' })] })
  } catch {
    return false
  }
}

/**
 * Export a backup by download or through the share sheet. The export is recorded as the last backup only
 * once the file was actually handed over: a dismissed share sheet records nothing and returns null.
 */
export async function saveBackup(store: Pick<AppStore, 'exportData' | 'markExported'>, via: 'download' | 'share'): Promise<string | null> {
  const { filename, text, exportedAt } = await store.exportData({ record: false })
  if (via === 'share') {
    try {
      await navigator.share({ files: [new File([text], filename, { type: 'application/json' })], title: filename })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return null
      downloadText(filename, text)
    }
  } else {
    downloadText(filename, text)
  }
  await store.markExported(exportedAt)
  return filename
}
