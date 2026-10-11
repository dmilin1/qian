import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestStore, renderWithApp } from '../../components/test-utils'
import { parseImport } from '../../lib/exportImport'
import { __setDeferredPrompt, type BeforeInstallPromptEvent } from './install'
import SettingsPage from './SettingsPage'

/** Capture what downloadText() hands to the browser (Blob URL + <a download> click). */
function captureDownloads() {
  const blobs: Blob[] = []
  const names: string[] = []
  const create = vi.fn((b: Blob) => {
    blobs.push(b)
    return `blob:test/${blobs.length}`
  })
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download)
  })
  return { blobs, names, click }
}

async function readBlob(b: Blob): Promise<string> {
  if (typeof b.text === 'function') return b.text()
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.readAsText(b)
  })
}

/** A real backup made by another (in-memory) device with one graded card. */
async function makeBackup(): Promise<string> {
  const other = makeTestStore()
  await other.init()
  const cur = other.getSnapshot().current!
  await other.grade(cur.key, 'good')
  const { text } = await other.exportData()
  other.dispose()
  return text
}

async function renderPage() {
  const r = renderWithApp(<SettingsPage />)
  await waitFor(() => expect(r.store.getSnapshot().ready).toBe(true))
  return r
}

beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('SettingsPage', () => {
  it('renders every section', async () => {
    await renderPage()
    for (const name of ['Study', 'Appearance', 'Audio', 'Your data', 'Install', 'About'])
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
  })

  it('updates study settings in the store', async () => {
    const { store } = await renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /audio only/i }))
    expect(store.getSnapshot().settings.listenFront).toBe('audioOnly')
    await user.click(screen.getByRole('switch', { name: 'Tone colors' }))
    expect(store.getSnapshot().settings.toneColors).toBe(false)
    await user.click(screen.getByRole('switch', { name: 'Show characters' }))
    expect(store.getSnapshot().settings.showCharacters).toBe(false)
    await user.click(screen.getByRole('switch', { name: 'Autoplay audio' }))
    expect(store.getSnapshot().settings.autoplay).toBe(false)

    fireEvent.change(screen.getByRole('slider', { name: 'Words in progress' }), { target: { value: '30' } })
    expect(store.getSnapshot().settings.workingSetCap).toBe(30)
    fireEvent.change(screen.getByRole('slider', { name: 'Stable after' }), { target: { value: '4' } })
    expect(store.getSnapshot().settings.stableDays).toBe(4)

    await user.click(screen.getByRole('button', { name: /restore study defaults/i }))
    expect(store.getSnapshot().settings).toMatchObject({ listenFront: 'full', toneColors: true, workingSetCap: 30, stableDays: 5 })
  })

  it('commits target retention after the slider settles', async () => {
    const { store } = await renderPage()
    vi.useFakeTimers()
    const slider = screen.getByRole('slider', { name: 'Target retention' })
    expect(slider).toHaveAttribute('min', '0.8')
    expect(slider).toHaveAttribute('max', '0.97')
    fireEvent.change(slider, { target: { value: '0.85' } })
    fireEvent.change(slider, { target: { value: '0.86' } })
    expect(store.getSnapshot().settings.requestRetention).toBe(0.9)
    expect(screen.getByText('86%')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(400))
    expect(store.getSnapshot().settings.requestRetention).toBe(0.86)
    vi.useRealTimers()
  })

  it('switches the theme', async () => {
    const { store } = await renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(store.getSnapshot().settings.theme).toBe('dark')
  })

  it('test playback plays a word', async () => {
    const { fake } = await renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /test playback/i }))
    expect(fake.play).toHaveBeenCalledWith(expect.any(String), 'word', { slow: false })
    act(() => fake.finish('tts'))
    expect(await screen.findByText(/browser's built-in voice/i)).toBeInTheDocument()
  })

  it('lists keyboard shortcuts', async () => {
    await renderPage()
    const about = screen.getByRole('region', { name: 'About' })
    expect(within(about).getByText('Undo the last grade')).toBeInTheDocument()
    expect(within(about).getByText('Space')).toBeInTheDocument()
  })

  it('offers the browser install prompt when available', async () => {
    const prompt = vi.fn(async () => {})
    __setDeferredPrompt({ prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) } as unknown as BeforeInstallPromptEvent)
    await renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Install qian' }))
    expect(prompt).toHaveBeenCalled()
    __setDeferredPrompt(null)
  })
})

describe('Settings: export', () => {
  it('downloads a valid qian-backup-YYYY-MM-DD.json', async () => {
    const { store } = await renderPage()
    await act(() => store.grade(store.getSnapshot().current!.key, 'good'))
    const dl = captureDownloads()
    const user = userEvent.setup()
    expect(screen.getByTestId('last-export')).toHaveTextContent('Never exported')
    await user.click(screen.getByRole('button', { name: 'Export backup' }))
    await waitFor(() => expect(dl.blobs).toHaveLength(1))
    expect(dl.names[0]).toMatch(/^qian-backup-\d{4}-\d{2}-\d{2}\.json$/)
    const text = await readBlob(dl.blobs[0])
    const json = JSON.parse(text)
    expect(json).toMatchObject({ app: 'qian', schemaVersion: expect.any(Number) })
    expect(json.events).toHaveLength(1)
    // And it round-trips through the importer.
    expect(parseImport(text).file.events).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId('last-export')).toHaveTextContent(/Last export: .*today/))
    expect(store.getSnapshot().lastExportAt).not.toBeNull()
  })

  it('reminds to back up when there is progress and no recent export', async () => {
    const { store } = await renderPage()
    expect(screen.queryByText(/haven't backed up yet/)).not.toBeInTheDocument()
    await act(() => store.grade(store.getSnapshot().current!.key, 'good'))
    expect(screen.getByText(/haven't backed up yet/)).toBeInTheDocument()
  })
})

describe('Settings: import', () => {
  it('merges by default and shows what changed', async () => {
    const backup = await makeBackup()
    const { store } = await renderPage()
    const spy = vi.spyOn(store, 'importData')
    const user = userEvent.setup()
    await user.upload(screen.getByTestId('import-file'), new File([backup], 'qian-backup-2026-10-01.json', { type: 'application/json' }))

    const dialog = await screen.findByRole('dialog', { name: 'Import backup' })
    expect(within(dialog).getByRole('radio', { name: /merge/i })).toBeChecked()
    expect(within(dialog).getByText(/1 entry/)).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }))

    expect(spy).toHaveBeenCalledWith(backup, 'merge')
    expect(await screen.findByTestId('import-summary')).toHaveTextContent(/Merged 1 new entry/)
    expect(store.getSnapshot().events).toHaveLength(1)
  })

  it('replace mode is explicit and uses the danger button', async () => {
    const backup = await makeBackup()
    const { store } = await renderPage()
    const spy = vi.spyOn(store, 'importData')
    const user = userEvent.setup()
    await user.upload(screen.getByTestId('import-file'), new File([backup], 'b.json', { type: 'application/json' }))
    const dialog = await screen.findByRole('dialog', { name: 'Import backup' })
    await user.click(within(dialog).getByRole('radio', { name: /replace/i }))
    await user.click(within(dialog).getByRole('button', { name: 'Replace my data' }))
    expect(spy).toHaveBeenCalledWith(backup, 'replace')
    expect(await screen.findByTestId('import-summary')).toHaveTextContent(/Replaced/)
  })

  it('rejects a file that is not a qian backup', async () => {
    const { store } = await renderPage()
    const spy = vi.spyOn(store, 'importData')
    const user = userEvent.setup()
    await user.upload(screen.getByTestId('import-file'), new File(['{"hello":1}'], 'x.json', { type: 'application/json' }))
    expect(await screen.findByText('This is not a qian backup file.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('Settings: reset', () => {
  it('requires two confirmations and typing RESET', async () => {
    const { store } = await renderPage()
    await act(() => store.grade(store.getSnapshot().current!.key, 'good'))
    const reset = vi.spyOn(store, 'resetAll')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /reset all data/i }))
    let dialog = await screen.findByRole('dialog', { name: 'Reset all data?' })
    expect(reset).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

    dialog = await screen.findByRole('dialog', { name: 'Are you sure?' })
    const confirm = within(dialog).getByRole('button', { name: /delete everything/i })
    expect(confirm).toBeDisabled()
    const input = within(dialog).getByRole('textbox', { name: 'Confirmation' })
    await user.type(input, 'RESE')
    expect(confirm).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(reset).not.toHaveBeenCalled()
    await user.type(input, 'T')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(reset).toHaveBeenCalledWith(false)
    await waitFor(() => expect(store.getSnapshot().events).toHaveLength(0))
    expect(await screen.findByText(/All progress on this device was deleted/)).toBeInTheDocument()
  })

  it('cancelling does not reset', async () => {
    const { store } = await renderPage()
    const reset = vi.spyOn(store, 'resetAll')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset all data/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset all data?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(reset).not.toHaveBeenCalled()
  })
})
