// One small, dismissible reminder on the Study start and caught-up screens: install on iOS (Safari
// deletes site data after 7 days without a visit), back up, or storage not protected. Settings has the
// full controls; this reaches learners who never open Settings.
import { useState, type ReactNode } from 'react'
import { Banner, Button, useNow, useSelector, useStore } from '../../components'
import { canShareFiles, daysSince, saveBackup } from '../settings/backup'
import { isIOS, isStandalone } from '../settings/install'
import { pickNudge, readSnoozes, writeSnooze } from './nudge'

export function StudyNudge({ className }: { className?: string }) {
  const store = useStore()
  const eventCount = useSelector((s) => s.events.length)
  const lastExportAt = useSelector((s) => s.lastExportAt)
  const persistence = useSelector((s) => s.persistence)
  const [snoozedAt, setSnoozedAt] = useState(readSnoozes)
  const [busy, setBusy] = useState(false)
  const now = useNow(60_000)
  const kind = pickNudge({ ios: isIOS(), standalone: isStandalone(), eventCount, lastExportAt, persistence, snoozedAt, now })
  if (!kind) return null

  const dismiss = () => {
    const t = Date.now()
    writeSnooze(kind, t)
    setSnoozedAt((s) => ({ ...s, [kind]: t }))
  }

  const exportNow = async () => {
    setBusy(true)
    try {
      await saveBackup(store, canShareFiles() ? 'share' : 'download')
    } catch {
      // Settings > Your data shows export errors; here the reminder simply stays.
    } finally {
      setBusy(false)
    }
  }

  const settingsLink = (
    <a href="#/settings" className="font-medium text-accent underline underline-offset-2">
      Settings
    </a>
  )

  let body: ReactNode
  let action: ReactNode = null
  if (kind === 'install') {
    body = (
      <>
        <strong className="font-medium">Add qian to your Home Screen</strong> so Safari doesn't delete your progress: tap Share, then
        “Add to Home Screen”. Steps in {settingsLink}.
      </>
    )
  } else if (kind === 'backup') {
    body = (
      <>
        <strong className="font-medium">Back up your progress.</strong>{' '}
        {lastExportAt === null
          ? 'It lives only in this browser.'
          : `Your last backup is ${daysSince(lastExportAt, now)} days old.`}
      </>
    )
    action = (
      <Button size="sm" variant="secondary" icon="download" disabled={busy} onClick={() => void exportNow()}>
        Export
      </Button>
    )
  } else {
    body = (
      <>
        <strong className="font-medium">This browser may clear your progress</strong> when space runs low. Export a backup now and then
        ({settingsLink}).
      </>
    )
  }

  return (
    <Banner tone="info" action={action} onDismiss={dismiss} className={className}>
      <span data-testid="study-nudge" data-kind={kind}>
        {body}
      </span>
    </Banner>
  )
}
