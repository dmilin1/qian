// Open flags as a CSV file, to send to whoever fixes the data (PLAN: flags "exportable as a list").
import { openFlags, type Derived } from '../../lib/derive'
import { downloadText, flagsToCsv } from '../../lib/exportImport'
import type { WordIndex } from '../../lib/words'

export function flagsFileName(now = Date.now()): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `qian-flags-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`
}

/** Open flags (oldest first) as CSV, one row per flag, with the word's characters, pinyin and gloss. */
export function openFlagsCsv(derived: Derived, words: Pick<WordIndex, 'get'>): string {
  return flagsToCsv(openFlags(derived), (id) => words.get(id))
}

function canShareFile(file: File): boolean {
  try {
    return typeof navigator?.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/**
 * Hand the CSV to the share sheet where files can be shared (phones), otherwise download it.
 * Returns false if the user dismissed the share sheet.
 */
export async function exportOpenFlags(derived: Derived, words: Pick<WordIndex, 'get'>, now = Date.now()): Promise<boolean> {
  const filename = flagsFileName(now)
  const text = openFlagsCsv(derived, words)
  const file = typeof File === 'undefined' ? null : new File([text], filename, { type: 'text/csv' })
  if (file && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: filename })
      return true
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return false
    }
  }
  downloadText(filename, text, 'text/csv')
  return true
}
