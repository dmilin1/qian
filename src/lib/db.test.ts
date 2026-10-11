import { describe, expect, it } from 'vitest'
import {
  clearAll,
  DATA_SCHEMA_VERSION,
  DB_VERSION,
  deleteEvent,
  getMeta,
  getOrCreateDeviceId,
  loadEvents,
  MIGRATIONS,
  openQianDb,
  putEvents,
  replaceEvents,
  setMeta,
} from './db'
import { makeKnown, makeReview } from './events'

let n = 0
const freshName = () => `qian-test-${Date.now()}-${n++}`

describe('db', () => {
  it('creates stores, indexes and meta', async () => {
    const name = freshName()
    const db = await openQianDb(name)
    expect(db.version).toBe(DB_VERSION)
    expect([...db.objectStoreNames].sort()).toEqual(['events', 'meta'])
    const tx = db.transaction('events')
    expect([...tx.store.indexNames].sort()).toEqual(['ts', 'wordId'])
    expect(await getMeta(db, 'schemaVersion')).toBe(DATA_SCHEMA_VERSION)
    db.close()
  })

  it('stores, loads, deletes and replaces events', async () => {
    const db = await openQianDb(freshName())
    const a = makeReview({ wordId: 'w1', dir: 'listen', grade: 'good', ts: 2, deviceId: 'd' })
    const b = makeKnown({ wordId: 'w2', ts: 1, deviceId: 'd' })
    await putEvents(db, [a, b])
    await putEvents(db, [a]) // idempotent
    expect((await loadEvents(db)).length).toBe(2)
    expect((await db.getAllFromIndex('events', 'wordId', 'w2'))[0].id).toBe(b.id)
    expect((await db.getAllFromIndex('events', 'ts')).map((e) => e.id)).toEqual([b.id, a.id])
    await deleteEvent(db, a.id)
    expect((await loadEvents(db)).map((e) => e.id)).toEqual([b.id])
    await replaceEvents(db, [a])
    expect((await loadEvents(db)).map((e) => e.id)).toEqual([a.id])
    db.close()
  })

  it('skips corrupt rows when loading', async () => {
    const db = await openQianDb(freshName())
    await db.put('events', { id: 'bad', kind: 'review', wordId: 'w', ts: 1, deviceId: 'd' } as never)
    await putEvents(db, [makeKnown({ wordId: 'w', ts: 1, deviceId: 'd' })])
    expect((await loadEvents(db)).length).toBe(1)
    db.close()
  })

  it('device id is stable; clearAll keeps it but drops events and lastExportAt', async () => {
    const name = freshName()
    let db = await openQianDb(name)
    const id = await getOrCreateDeviceId(db)
    expect(await getOrCreateDeviceId(db)).toBe(id)
    await setMeta(db, 'lastExportAt', 123)
    await putEvents(db, [makeKnown({ wordId: 'w', ts: 1, deviceId: id })])
    db.close()
    db = await openQianDb(name)
    expect(await getOrCreateDeviceId(db)).toBe(id)
    expect(await getMeta(db, 'lastExportAt')).toBe(123)
    await clearAll(db)
    expect(await loadEvents(db)).toEqual([])
    expect(await getMeta(db, 'lastExportAt')).toBeUndefined()
    expect(await getOrCreateDeviceId(db)).toBe(id)
    db.close()
  })

  it('runs migrations in order when upgrading, keeping data', async () => {
    const name = freshName()
    const v1 = await openQianDb(name)
    const e = makeKnown({ wordId: 'w', ts: 1, deviceId: 'd' })
    await putEvents(v1, [e])
    v1.close()
    const ran: number[] = []
    const migrations = {
      ...MIGRATIONS,
      2: (_db: unknown, tx: Parameters<(typeof MIGRATIONS)[1]>[1]) => {
        ran.push(2)
        tx.objectStore('events').createIndex('deviceId' as never, 'deviceId')
      },
      3: () => ran.push(3),
    }
    const v3 = await openQianDb(name, { version: 3, migrations })
    expect(ran).toEqual([2, 3])
    expect(v3.version).toBe(3)
    expect((await loadEvents(v3)).map((x) => x.id)).toEqual([e.id])
    expect(v3.transaction('events').store.indexNames.contains('deviceId' as never)).toBe(true)
    v3.close()
  })
})
