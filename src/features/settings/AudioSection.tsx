import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioButton, Banner, Button, Icon, useSelector, useStore } from '../../components'
import { pickZhVoice, type PlayResult } from '../../lib/audio'
import { getManifest, getWords, type Manifest, type WordIndex } from '../../lib/words'
import {
  cacheStorageAvailable,
  clearAudioCache,
  countCached,
  downloadClips,
  formatBytes,
  manifestClipUrls,
  recordedWordCount,
  type DownloadProgress,
  type DownloadResult,
} from './audioCache'
import { Row, RowLabel, Section } from './Section'
import { sampleWord } from './config'

/** Name of the zh voice speechSynthesis would use as the fallback ('' = none found, null = unknown yet). */
function useFallbackVoice(): string | null {
  const [name, setName] = useState<string | null>(() => {
    const synth = globalThis.speechSynthesis
    if (!synth || typeof synth.getVoices !== 'function') return ''
    const voices = synth.getVoices()
    if (!voices.length) return null
    const v = pickZhVoice(voices)
    return v ? `${v.name} (${v.lang})` : ''
  })
  useEffect(() => {
    const synth = globalThis.speechSynthesis
    if (name !== null || !synth || typeof synth.getVoices !== 'function') return
    const read = () => {
      const voices = synth.getVoices()
      if (!voices.length) return false
      const v = pickZhVoice(voices)
      setName(v ? `${v.name} (${v.lang})` : '')
      return true
    }
    // Voices load asynchronously in Chrome; give up after a moment.
    const onChange = () => void read()
    synth.addEventListener?.('voiceschanged', onChange)
    const t = setTimeout(() => {
      if (!read()) setName('')
    }, 1500)
    return () => {
      synth.removeEventListener?.('voiceschanged', onChange)
      clearTimeout(t)
    }
  }, [name])
  return name
}

function resultMessage(r: PlayResult, hasClip: boolean): { tone: 'info' | 'warning' | 'success'; text: string } | null {
  switch (r) {
    case 'clip':
      return { tone: 'success', text: 'Played a recorded clip. Audio is working.' }
    case 'tts':
      return hasClip
        ? { tone: 'info', text: "The recorded clip couldn't load (offline?), so your browser's voice was used instead." }
        : { tone: 'info', text: "Played with your browser's built-in voice." }
    case 'blocked':
      return { tone: 'warning', text: 'Your browser blocked playback. Tap the button again.' }
    case 'failed':
      return {
        tone: 'warning',
        text: "Couldn't play audio. Check that your device isn't muted. Without recorded clips, a Chinese (Taiwan) voice must be installed on the device.",
      }
    default:
      return null
  }
}

function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const p = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} of ${max}`}
      className="h-2 w-full overflow-hidden rounded-full bg-sunken"
    >
      <div className="h-full rounded-full bg-accent-solid transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${p}%` }} />
    </div>
  )
}

function OfflineAudio({ urls }: { urls: string[] }) {
  const store = useStore()
  const persistence = useSelector((s) => s.persistence)
  const supported = cacheStorageAvailable()
  const [cached, setCached] = useState<number | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [result, setResult] = useState<DownloadResult | null>(null)
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    if (supported) void countCached(urls).then((n) => live && setCached(n))
    return () => {
      live = false
    }
  }, [urls, supported])

  // Cancel a running download when leaving the page.
  useEffect(() => () => abort.current?.abort(), [])

  const start = async () => {
    const ctl = new AbortController()
    abort.current = ctl
    setRunning(true)
    setResult(null)
    setProgress({ done: 0, total: urls.length, failed: 0, skipped: 0, bytes: 0 })
    // Ask the browser not to evict ~megabytes of audio (best effort, never blocks the download).
    if (persistence !== 'granted') void store.requestPersistence().catch(() => {})
    const r = await downloadClips(urls, { signal: ctl.signal, onProgress: (p) => !ctl.signal.aborted && setProgress(p) })
    abort.current = null
    setRunning(false)
    setResult(r)
    setProgress(r)
    setCached(await countCached(urls))
  }

  const cancel = () => abort.current?.abort()

  const remove = async () => {
    await clearAudioCache()
    setResult(null)
    setProgress(null)
    setCached(0)
  }

  if (!supported) {
    return (
      <Row>
        <RowLabel title="Offline audio" description="This browser can't save audio for offline use. Recorded clips still play while you're online." />
      </Row>
    )
  }

  const all = cached !== null && cached >= urls.length
  return (
    <Row py="loose" className="flex flex-col gap-3">
      <RowLabel
        title="Offline audio"
        description={
          <>
            Save all {urls.length} recorded clips on this device so studying works without a connection. Clips you've already
            heard are saved automatically.
          </>
        }
      />
      <p className="text-sm text-ink tabular-nums" aria-live="polite">
        {cached === null ? 'Checking…' : all ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <Icon name="check" size={16} /> All {urls.length} clips are saved offline.
          </span>
        ) : (
          `${cached} of ${urls.length} clips saved offline.`
        )}
      </p>

      {running && progress ? (
        <div className="flex flex-col gap-2">
          <ProgressBar value={progress.done} max={progress.total} label="Downloading audio" />
          <div className="flex items-center justify-between gap-3 text-sm text-muted tabular-nums">
            <span>
              {progress.done} / {progress.total}
              {progress.bytes ? ` · ${formatBytes(progress.bytes)}` : ''}
            </span>
            <Button variant="ghost" size="sm" icon="close" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant={all ? 'secondary' : 'primary'} icon="download" onClick={() => void start()}>
            {all ? 'Check for missing clips' : cached ? 'Download the rest' : 'Download all audio'}
          </Button>
          {cached ? (
            <Button variant="ghost" icon="trash" onClick={() => void remove()}>
              Remove offline audio
            </Button>
          ) : null}
        </div>
      )}

      {result ? (
        <Banner
          tone={result.status === 'complete' && result.failed === 0 ? 'success' : result.status === 'cancelled' ? 'info' : 'warning'}
          onDismiss={() => setResult(null)}
        >
          {result.status === 'cancelled'
            ? `Stopped. ${result.done} of ${result.total} clips are done; download again to continue.`
            : result.status === 'error'
              ? result.error
              : result.failed
                ? `${result.failed} clip${result.failed === 1 ? '' : 's'} could not be downloaded. Try again when your connection is better.`
                : `Done. ${result.done - result.skipped} downloaded${result.bytes ? ` (${formatBytes(result.bytes)})` : ''}, ${result.skipped} already saved.`}
        </Banner>
      ) : null}
    </Row>
  )
}

export function AudioSection({ words = getWords(), manifest = getManifest() }: { words?: WordIndex; manifest?: Manifest }) {
  const recorded = useMemo(() => recordedWordCount(words, manifest), [words, manifest])
  const urls = useMemo(() => manifestClipUrls(words, manifest), [words, manifest])
  const total = words.order.length
  const voice = useFallbackVoice()
  const sample = words.list.find((x) => x.trad === '你好') ?? sampleWord()
  const [msg, setMsg] = useState<ReturnType<typeof resultMessage>>(null)
  const sampleHasClip = !!(sample && manifest.path(sample.id, 'word'))

  return (
    <Section id="audio" title="Audio" icon="volume">
      <Row py="loose" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-ink">Voice</span>
          {recorded > 0 ? (
            <p className="text-sm text-muted">
              High-quality recordings (voice “Anna Su”, Taiwan Mandarin) for{' '}
              <span className="font-medium text-ink tabular-nums">
                {recorded === total ? `all ${total}` : `${recorded} of ${total}`}
              </span>{' '}
              words.{recorded < total ? " Words without a recording use your browser's voice." : ''}
            </p>
          ) : (
            <p className="text-sm text-muted">
              No recordings in this version yet, so words are spoken by your browser's built-in voice. It may not sound like
              Taiwan Mandarin.
            </p>
          )}
          {recorded < total ? (
            <p className="text-sm text-muted">
              Browser voice:{' '}
              {voice === null ? (
                'checking…'
              ) : voice ? (
                <span className="text-ink">{voice}</span>
              ) : (
                <span className="text-danger">no Chinese voice found. Add a Chinese (Taiwan) voice in your device's settings.</span>
              )}
            </p>
          ) : null}
        </div>
        {sample ? (
          <div className="flex flex-wrap items-center gap-3">
            <AudioButton
              wordId={sample.id}
              size="md"
              emphasis="primary"
              label={`Play ${sample.trad}`}
              onResult={(r) => setMsg(resultMessage(r, sampleHasClip))}
            >
              Test playback
            </AudioButton>
            <span className="text-sm text-muted">
              <span lang="zh-TW">{sample.trad}</span> · {sample.pinyin}
            </span>
          </div>
        ) : null}
        {msg ? (
          <Banner tone={msg.tone} onDismiss={() => setMsg(null)}>
            {msg.text}
          </Banner>
        ) : null}
      </Row>
      {urls.length > 0 ? (
        <OfflineAudio urls={urls} />
      ) : (
        <Row>
          <RowLabel title="Offline audio" description="There are no recorded clips to download yet." />
        </Row>
      )}
    </Section>
  )
}
