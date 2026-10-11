// Export / import of the event log. Import merges by default: union of events by id, so
// merging logs from several devices (in any order, any number of times) is safe.
import { DATA_SCHEMA_VERSION } from './db'
import type { FlagRecord } from './derive'
import { compareEvents, sanitizeEvent, type AppEvent } from './events'
import { validateSettings, type Settings } from './settings'

export interface ExportFile {
  app: 'qian'
  schemaVersion: number
  exportedAt: string // ISO time
  deviceId: string
  settings: Settings
  events: AppEvent[]
}

export type ImportMode = 'merge' | 'replace'

export interface ParsedImport {
  file: ExportFile
  /** Events in the file that failed validation and were skipped. */
  skipped: number
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

export function buildExport(events: readonly AppEvent[], settings: Settings, deviceId: string, now = Date.now()): ExportFile {
  return {
    app: 'qian',
    schemaVersion: DATA_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    deviceId,
    settings,
    events: [...events].sort(compareEvents),
  }
}

export function exportFileName(now = Date.now()): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `qian-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`
}

export function serializeExport(file: ExportFile): string {
  return JSON.stringify(file)
}

/**
 * Validate an import (JSON text or an already-parsed object). Throws ImportError for anything
 * that is not a qian export, or that comes from a newer app version. Individual malformed events
 * are skipped and counted.
 */
export function parseImport(input: string | unknown): ParsedImport {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch {
      throw new ImportError('This file is not valid JSON.')
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new ImportError('This is not a qian backup file.')
  const o = data as Record<string, unknown>
  if (o.app !== 'qian') throw new ImportError('This is not a qian backup file.')
  if (typeof o.schemaVersion !== 'number' || !Number.isInteger(o.schemaVersion) || o.schemaVersion < 1)
    throw new ImportError('The backup has no valid schema version.')
  if (o.schemaVersion > DATA_SCHEMA_VERSION)
    throw new ImportError(
      `This backup was made by a newer version of qian (format ${o.schemaVersion}; this app reads up to ${DATA_SCHEMA_VERSION}). Update the app and try again.`,
    )
  if (!Array.isArray(o.events)) throw new ImportError('The backup has no event list.')
  // Future: migrate events from older schemaVersions here.
  const events: AppEvent[] = []
  let skipped = 0
  for (const raw of o.events) {
    const e = sanitizeEvent(raw)
    if (e) events.push(e)
    else skipped++
  }
  return {
    file: {
      app: 'qian',
      schemaVersion: o.schemaVersion,
      exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
      deviceId: typeof o.deviceId === 'string' ? o.deviceId : '',
      settings: validateSettings(o.settings),
      events,
    },
    skipped,
  }
}

export interface MergeResult {
  events: AppEvent[] // sorted by (ts, id)
  added: AppEvent[] // incoming events not present locally
  duplicates: number // incoming events whose id already existed (local copy kept)
}

/** Union by id. Local events always win on id collisions; nothing local is ever dropped. */
export function mergeEvents(local: readonly AppEvent[], incoming: readonly AppEvent[]): MergeResult {
  const byId = new Map<string, AppEvent>()
  for (const e of local) if (!byId.has(e.id)) byId.set(e.id, e)
  const added: AppEvent[] = []
  let duplicates = 0
  for (const e of incoming) {
    if (byId.has(e.id)) duplicates++
    else {
      byId.set(e.id, e)
      added.push(e)
    }
  }
  return { events: [...byId.values()].sort(compareEvents), added, duplicates }
}

/** Read a File/Blob as text (FileReader fallback for older Safari). */
export async function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}

/** Trigger a browser download of a text file (UI helper). */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Flagged items as CSV (for sending to whoever fixes the data). */
export function flagsToCsv(
  flags: readonly FlagRecord[],
  lookup: (wordId: string) => { trad: string; pinyin: string; gloss: string } | undefined,
): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const rows = [['wordId', 'trad', 'pinyin', 'gloss', 'reason', 'note', 'flaggedAt', 'resolved']]
  for (const f of flags) {
    const w = lookup(f.wordId)
    rows.push([f.wordId, w?.trad ?? '', w?.pinyin ?? '', w?.gloss ?? '', f.reason, f.note ?? '', new Date(f.ts).toISOString(), f.resolved ? 'yes' : 'no'])
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n'
}
