import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Banner, Button, Icon, Modal, cx, useSelector, useStore } from '../../components'
import { downloadText, ImportError, parseImport, type ImportMode } from '../../lib/exportImport'
import type { ImportSummary } from '../../lib/store'
import { formatBytes } from './audioCache'
import { Row, RowLabel, Section } from './Section'

const DAY_MS = 24 * 60 * 60 * 1000
/** Remind to export when the last backup is older than this. */
const EXPORT_REMINDER_DAYS = 14

function daysSince(t: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - t) / DAY_MS))
}

const fmtDate = (t: number) => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(t)
  } catch {
    return new Date(t).toDateString()
  }
}

const ago = (days: number) => (days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`)
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Whether the Web Share API can share a file (iOS / Android "Save to Files" etc.). */
function canShareFiles(): boolean {
  try {
    const nav = globalThis.navigator
    if (typeof nav?.canShare !== 'function' || typeof File === 'undefined') return false
    return nav.canShare({ files: [new File(['{}'], 'test.json', { type: 'application/json' })] })
  } catch {
    return false
  }
}

// ----- Export -----

function ExportRow() {
  const store = useStore()
  const lastExportAt = useSelector((s) => s.lastExportAt)
  const eventCount = useSelector((s) => s.events.length)
  const [status, setStatus] = useState<string | null>(null)
  const [share] = useState(canShareFiles)

  const run = async (via: 'download' | 'share') => {
    setStatus(null)
    try {
      const { filename, text } = await store.exportData()
      if (via === 'share') {
        try {
          await navigator.share({ files: [new File([text], filename, { type: 'application/json' })], title: filename })
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return
          downloadText(filename, text)
        }
      } else {
        downloadText(filename, text)
      }
      setStatus(`Saved ${filename}`)
    } catch (e) {
      setStatus(`Export failed: ${(e as Error)?.message ?? e}`)
    }
  }

  const days = lastExportAt !== null ? daysSince(lastExportAt) : null
  const overdue = eventCount > 0 && (days === null || days > EXPORT_REMINDER_DAYS)

  return (
    <Row py="loose" className="flex flex-col gap-3">
      <RowLabel
        title="Export backup"
        description="Save all your progress and settings as a file. Keep it somewhere safe, or import it on another device."
      />
      <p className="text-sm text-ink" data-testid="last-export">
        {lastExportAt !== null ? (
          <>
            Last export: {fmtDate(lastExportAt)} ({ago(days!)})
          </>
        ) : (
          'Never exported.'
        )}{' '}
        <span className="text-muted">History: {plural(eventCount, 'entry', 'entries')}.</span>
      </p>
      {overdue ? (
        <Banner tone="warning">
          {lastExportAt === null
            ? "You haven't backed up yet. Your progress lives only in this browser."
            : `Your last backup is ${days} days old. Export a fresh copy so you don't lose recent progress.`}
        </Banner>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon="download" onClick={() => void run('download')}>
          Export backup
        </Button>
        {share ? (
          <Button variant="secondary" icon="external" onClick={() => void run('share')}>
            Share / Save to Files
          </Button>
        ) : null}
      </div>
      {status ? (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      ) : null}
    </Row>
  )
}

// ----- Import -----

interface PendingImport {
  name: string
  text: string
  exportedAt: string
  events: number
  skipped: number
}

interface ImportOutcome extends ImportSummary {
  wordsBefore: number
  wordsAfter: number
}

function ModeOption({
  value,
  current,
  onSelect,
  title,
  children,
  name,
}: {
  value: ImportMode
  current: ImportMode
  onSelect: (m: ImportMode) => void
  title: string
  children: ReactNode
  name: string
}) {
  const id = useId()
  const checked = value === current
  return (
    <label
      htmlFor={id}
      className={cx(
        'flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors duration-150',
        checked ? (value === 'replace' ? 'border-danger/50 bg-danger-soft' : 'border-accent/50 bg-accent-soft') : 'border-line hover:bg-sunken',
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent-solid)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-ink">{title}</span>
        <span className="text-sm text-muted">{children}</span>
      </span>
    </label>
  )
}

function ImportRow() {
  const store = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const radioName = useId()

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow choosing the same file again
    if (!file) return
    setError(null)
    setOutcome(null)
    try {
      const text = await file.text()
      const parsed = parseImport(text)
      setMode('merge')
      setPending({
        name: file.name,
        text,
        exportedAt: parsed.file.exportedAt,
        events: parsed.file.events.length,
        skipped: parsed.skipped,
      })
    } catch (err) {
      setError(err instanceof ImportError ? err.message : `Could not read this file (${(err as Error)?.message ?? err}).`)
    }
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    const wordsBefore = store.getSnapshot().queue.introducedWords
    try {
      const summary = await store.importData(pending.text, mode)
      setOutcome({ ...summary, wordsBefore, wordsAfter: store.getSnapshot().queue.introducedWords })
      setPending(null)
    } catch (err) {
      setError(err instanceof ImportError ? err.message : `Import failed (${(err as Error)?.message ?? err}).`)
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  const exported = pending ? Date.parse(pending.exportedAt) : NaN

  return (
    <Row py="loose" className="flex flex-col gap-3">
      <RowLabel title="Import backup" description="Load a qian backup file, for example from another device." />
      <div>
        <Button variant="secondary" icon="upload" onClick={() => fileRef.current?.click()}>
          Import backup…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a backup file"
          data-testid="import-file"
          onChange={(e) => void onFile(e)}
        />
      </div>
      {error ? (
        <Banner tone="warning" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      ) : null}
      {outcome ? (
        <Banner tone="success" onDismiss={() => setOutcome(null)}>
          <ImportSummaryText o={outcome} />
        </Banner>
      ) : null}

      <Modal
        open={pending !== null}
        onClose={() => !busy && setPending(null)}
        dismissible={!busy}
        title="Import backup"
        description={
          pending ? (
            <>
              <span className="font-medium text-ink break-all">{pending.name}</span>
              <br />
              {Number.isFinite(exported) ? `Exported ${fmtDate(exported)}, ` : ''}
              {plural(pending.events, 'entry', 'entries')}
              {pending.skipped ? ` (${pending.skipped} unreadable, will be skipped)` : ''}.
            </>
          ) : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={mode === 'replace' ? 'danger' : 'primary'} onClick={() => void confirm()} disabled={busy}>
              {busy ? 'Importing…' : mode === 'replace' ? 'Replace my data' : 'Merge'}
            </Button>
          </>
        }
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">How to import</legend>
          <ModeOption name={radioName} value="merge" current={mode} onSelect={setMode} title="Merge (recommended)">
            Combine the backup with what's on this device. Nothing here is lost: reviews already present are skipped, and your
            settings stay as they are. Safe to repeat, and the way to sync two devices.
          </ModeOption>
          <ModeOption name={radioName} value="replace" current={mode} onSelect={setMode} title="Replace">
            Delete this device's progress and settings and use the backup's instead. Use this only to restore an older state
            on purpose.
          </ModeOption>
        </fieldset>
      </Modal>
    </Row>
  )
}

function ImportSummaryText({ o }: { o: ImportOutcome }) {
  const words = o.wordsAfter !== o.wordsBefore ? ` Words started: ${o.wordsBefore} → ${o.wordsAfter}.` : ''
  if (o.mode === 'replace')
    return (
      <span data-testid="import-summary">
        Replaced. This device now has the backup's {plural(o.total, 'entry', 'entries')} and settings
        {o.skipped ? `; ${o.skipped} unreadable entries were skipped` : ''}.{words}
      </span>
    )
  return (
    <span data-testid="import-summary">
      {o.added === 0 ? 'Nothing new: everything in the backup was already here.' : `Merged ${plural(o.added, 'new entry', 'new entries')}.`}
      {o.added > 0 && o.duplicates ? ` ${o.duplicates.toLocaleString()} were already here.` : ''}
      {o.skipped ? ` ${o.skipped} unreadable entries were skipped.` : ''} History now has {plural(o.total, 'entry', 'entries')}.{words}
    </span>
  )
}

// ----- Persistence -----

function useStorageEstimate(dep: unknown): { usage: number; quota: number } | null {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null)
  useEffect(() => {
    let live = true
    const sm = globalThis.navigator?.storage
    if (sm && typeof sm.estimate === 'function')
      sm.estimate()
        .then((e) => live && setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
        .catch(() => {})
    return () => {
      live = false
    }
  }, [dep])
  return est
}

function PersistenceRow() {
  const store = useStore()
  const persistence = useSelector((s) => s.persistence)
  const revision = useSelector((s) => s.events.length)
  const est = useStorageEstimate(revision)
  const [asked, setAsked] = useState(false)

  const ask = async () => {
    await store.requestPersistence()
    setAsked(true)
  }

  const granted = persistence === 'granted'
  return (
    <Row py="loose" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            granted ? 'bg-success-soft text-success' : 'bg-sunken text-muted',
          )}
        >
          <Icon name={granted ? 'check' : 'info'} size={16} />
        </span>
        <RowLabel
          title={granted ? 'Storage is protected' : persistence === 'unsupported' ? 'Storage protection unavailable' : 'Storage is not protected'}
          description={
            granted
              ? "The browser won't clear your progress to free up space."
              : persistence === 'unsupported'
                ? "This browser can't promise to keep your data. Export backups regularly."
                : asked && persistence === 'denied'
                  ? 'The browser declined. Installing qian on your home screen (below) usually helps; otherwise export regularly.'
                  : 'The browser may clear your progress if the device runs low on space.'
          }
        />
      </div>
      {est && est.usage > 0 ? (
        <p className="text-sm text-muted tabular-nums">
          Using {formatBytes(est.usage)}
          {est.quota ? ` of ${formatBytes(est.quota)} available` : ''} on this device.
        </p>
      ) : null}
      {!granted && persistence !== 'unsupported' ? (
        <div>
          <Button variant="secondary" icon="check" onClick={() => void ask()}>
            Ask to keep my data
          </Button>
        </div>
      ) : null}
    </Row>
  )
}

// ----- Reset -----

const RESET_WORD = 'RESET'

function ResetRow() {
  const store = useStore()
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [typed, setTyped] = useState('')
  const [keepSettings, setKeepSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const inputId = useId()
  const matches = typed.trim().toUpperCase() === RESET_WORD

  const close = () => {
    if (busy) return
    setStep(0)
    setTyped('')
  }

  const doReset = async () => {
    if (!matches) return
    setBusy(true)
    try {
      await store.resetAll(keepSettings)
      setDone(true)
    } finally {
      setBusy(false)
      setStep(0)
      setTyped('')
    }
  }

  const exportFirst = async () => {
    const { filename, text } = await store.exportData()
    downloadText(filename, text)
  }

  return (
    <Row py="loose" className="flex flex-col gap-3">
      <RowLabel title="Reset all data" description="Delete all progress on this device and start from the first word." />
      <div>
        <Button variant="danger" icon="trash" onClick={() => {
            setDone(false)
            setStep(1)
          }}>
          Reset all data…
        </Button>
      </div>
      {done ? (
        <Banner tone="success" onDismiss={() => setDone(false)}>
          All progress on this device was deleted.
        </Banner>
      ) : null}

      <Modal
        open={step === 1}
        onClose={close}
        title="Reset all data?"
        description="This deletes your whole review history on this device. It cannot be undone, so export a backup first if you might want it back."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="secondary" icon="download" onClick={() => void exportFirst()}>
              Export first
            </Button>
            <Button variant="danger" onClick={() => setStep(2)}>
              Continue
            </Button>
          </>
        }
      >
        <label className="flex cursor-pointer items-center gap-3 text-ink">
          <input
            type="checkbox"
            checked={keepSettings}
            onChange={(e) => setKeepSettings(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent-solid)]"
          />
          Keep my settings
        </label>
      </Modal>

      <Modal
        open={step === 2}
        onClose={close}
        dismissible={!busy}
        title="Are you sure?"
        description={`Type ${RESET_WORD} to delete all progress on this device.`}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" icon="trash" onClick={() => void doReset()} disabled={!matches || busy}>
              {busy ? 'Deleting…' : 'Delete everything'}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void doReset()
          }}
          className="flex flex-col gap-1.5"
        >
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            Confirmation
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            placeholder={RESET_WORD}
            className="h-11 w-full rounded-xl border border-line-strong bg-paper px-3.5 text-base tracking-widest text-ink placeholder:text-faint"
          />
        </form>
      </Modal>
    </Row>
  )
}

export function DataSection() {
  return (
    <Section id="data" title="Your data" icon="download" intro="Progress is stored only in this browser. Back it up now and then.">
      <ExportRow />
      <ImportRow />
      <PersistenceRow />
      <ResetRow />
    </Section>
  )
}
