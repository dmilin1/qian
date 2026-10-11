import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithApp } from '../../components/test-utils'
import { NUDGE_SNOOZE_DAYS, pickNudge, type NudgeInput } from './nudge'
import { StudyNudge } from './StudyNudge'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 11, 9)
const base: NudgeInput = { ios: false, standalone: false, eventCount: 5, lastExportAt: NOW, persistence: 'granted', snoozedAt: {}, now: NOW }

describe('pickNudge', () => {
  it('shows nothing before the first answer, or when all is well', () => {
    expect(pickNudge({ ...base, eventCount: 0, ios: true, lastExportAt: null })).toBeNull()
    expect(pickNudge(base)).toBeNull()
  })

  it('iOS Safari (not installed) gets the install nudge first', () => {
    expect(pickNudge({ ...base, ios: true, lastExportAt: null })).toBe('install')
    expect(pickNudge({ ...base, ios: true, standalone: true })).toBeNull()
  })

  it('reminds to back up with no export or one older than 14 days', () => {
    expect(pickNudge({ ...base, lastExportAt: null })).toBe('backup')
    expect(pickNudge({ ...base, lastExportAt: NOW - 14 * DAY })).toBeNull()
    expect(pickNudge({ ...base, lastExportAt: NOW - 15 * DAY })).toBe('backup')
  })

  it('warns when storage persistence was denied', () => {
    expect(pickNudge({ ...base, persistence: 'denied' })).toBe('persist')
  })

  it('a dismissed nudge stays away for a few days, then the next one shows', () => {
    const o = { ...base, ios: true, lastExportAt: null }
    expect(pickNudge({ ...o, snoozedAt: { install: NOW - DAY } })).toBe('backup')
    expect(pickNudge({ ...o, snoozedAt: { install: NOW - DAY, backup: NOW - DAY } })).toBeNull()
    expect(pickNudge({ ...o, snoozedAt: { install: NOW - NUDGE_SNOOZE_DAYS * DAY } })).toBe('install')
  })
})

describe('<StudyNudge>', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('offers a direct export, which records the backup and hides the reminder', async () => {
    const created: Blob[] = []
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn((b: Blob) => (created.push(b), 'blob:x')), configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { store } = renderWithApp(<StudyNudge />)
    await waitFor(() => expect(store.getSnapshot().ready).toBe(true))
    expect(screen.queryByTestId('study-nudge')).toBeNull()
    await act(() => store.grade(store.getSnapshot().current!.key, 'good'))
    expect(screen.getByTestId('study-nudge')).toHaveAttribute('data-kind', 'backup')
    expect(screen.getByText(/Back up your progress/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(store.getSnapshot().lastExportAt).not.toBeNull())
    expect(created).toHaveLength(1)
    expect(screen.queryByTestId('study-nudge')).toBeNull()
  })

  it('can be dismissed (remembered in this browser)', async () => {
    const { store } = renderWithApp(<StudyNudge />)
    await waitFor(() => expect(store.getSnapshot().ready).toBe(true))
    await act(() => store.grade(store.getSnapshot().current!.key, 'good'))
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('study-nudge')).toBeNull()
    expect(JSON.parse(localStorage.getItem('qian.nudgeSnoozedAt')!)).toHaveProperty('backup')
  })
})
