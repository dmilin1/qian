// IndexedDB persistence (via `idb`). Stores the append-only event log and a little metadata.
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb'
import { sanitizeEvent, uuid, type AppEvent } from './events'

export const DB_NAME = 'qian'
/** IndexedDB schema version. Bump and add a migration below when the stores change. */
export const DB_VERSION = 1
/** Version of the event/data format (also written into exports). */
export const DATA_SCHEMA_VERSION = 1

export interface MetaValues {
  deviceId: string
  lastExportAt: number
  schemaVersion: number
  /** FSRS day-boundary shift captured on first run (fsrs.defaultDayOffsetMs). Kept by clearAll. */
  dayOffsetMs: number
}
export type MetaKey = keyof MetaValues

export interface QianDB extends DBSchema {
  events: {
    key: string
    value: AppEvent
    indexes: { ts: number; wordId: string }
  }
  meta: {
    key: MetaKey
    value: MetaValues[MetaKey]
  }
}

export type Db = IDBPDatabase<QianDB>
type UpgradeTx = IDBPTransaction<QianDB, StoreNames<QianDB>[], 'versionchange'>

/**
 * Migrations keyed by the version they upgrade TO. Each runs inside the versionchange
 * transaction, in order, for every version between oldVersion+1 and DB_VERSION.
 */
export const MIGRATIONS: Record<number, (db: Db, tx: UpgradeTx) => void> = {
  1: (db) => {
    const events = db.createObjectStore('events', { keyPath: 'id' })
    events.createIndex('ts', 'ts')
    events.createIndex('wordId', 'wordId')
    db.createObjectStore('meta')
  },
}

export async function openQianDb(
  name = DB_NAME,
  opts: { version?: number; migrations?: typeof MIGRATIONS } = {},
): Promise<Db> {
  const version = opts.version ?? DB_VERSION
  const migrations = opts.migrations ?? MIGRATIONS
  const db = await openDB<QianDB>(name, version, {
    upgrade(db, oldVersion, newVersion, tx) {
      for (let v = oldVersion + 1; v <= (newVersion ?? version); v++) migrations[v]?.(db, tx)
    },
    blocking() {
      // Another tab wants a newer version: let it upgrade.
      db.close()
    },
  })
  const tx = db.transaction('meta', 'readwrite')
  if ((await tx.store.get('schemaVersion')) === undefined) await tx.store.put(DATA_SCHEMA_VERSION, 'schemaVersion')
  await tx.done
  return db
}

/** All valid events (invalid rows are skipped defensively). */
export async function loadEvents(db: Db): Promise<AppEvent[]> {
  const rows = await db.getAll('events')
  const out: AppEvent[] = []
  for (const r of rows) {
    const e = sanitizeEvent(r)
    if (e) out.push(e)
  }
  return out
}

export async function putEvents(db: Db, events: readonly AppEvent[]): Promise<void> {
  if (!events.length) return
  const tx = db.transaction('events', 'readwrite')
  for (const e of events) void tx.store.put(e)
  await tx.done
}

export async function deleteEvent(db: Db, id: string): Promise<void> {
  await db.delete('events', id)
}

/** Replace the whole log atomically. */
export async function replaceEvents(db: Db, events: readonly AppEvent[]): Promise<void> {
  const tx = db.transaction('events', 'readwrite')
  void tx.store.clear()
  for (const e of events) void tx.store.put(e)
  await tx.done
}

export async function getMeta<K extends MetaKey>(db: Db, key: K): Promise<MetaValues[K] | undefined> {
  return (await db.get('meta', key)) as MetaValues[K] | undefined
}

export async function setMeta<K extends MetaKey>(db: Db, key: K, value: MetaValues[K]): Promise<void> {
  await db.put('meta', value, key)
}

export async function getOrCreateDeviceId(db: Db): Promise<string> {
  const tx = db.transaction('meta', 'readwrite')
  let id = (await tx.store.get('deviceId')) as string | undefined
  if (!id) {
    id = uuid()
    await tx.store.put(id, 'deviceId')
  }
  await tx.done
  return id
}

/** Wipe all progress: every event and lastExportAt. The deviceId and schemaVersion are kept. */
export async function clearAll(db: Db): Promise<void> {
  const tx = db.transaction(['events', 'meta'], 'readwrite')
  void tx.objectStore('events').clear()
  void tx.objectStore('meta').delete('lastExportAt')
  await tx.done
}
