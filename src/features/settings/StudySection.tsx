import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AudioButton,
  Button,
  Hanzi,
  Icon,
  Pinyin,
  SegmentedControl,
  Slider,
  Toggle,
  cx,
  useSelector,
  useSettingsState,
} from '../../components'
import { DEFAULT_SETTINGS, type Settings } from '../../lib/settings'
import { sampleWord, UI_RANGES } from './config'
import { Row, RowLabel, Section } from './Section'

type NumKey = keyof typeof UI_RANGES

const STUDY_KEYS = ['listenFront', 'showCharacters', 'toneColors', 'autoplay', 'slowRate', 'requestRetention', 'workingSetCap', 'stableDays', 'backlogLimit'] as const

const pct = (v: number) => `${Math.round(v * 100)}%`

const PREVIEW = { pinyin: 'nǐ hǎo', tones: [3, 3] as const, trad: '你好' }

/**
 * A slider bound to one numeric setting. Retention changes re-derive every card, so that one
 * commits after the thumb settles instead of on every step of a drag.
 */
function SettingSlider({
  k,
  label,
  description,
  format,
  debounceMs = 0,
}: {
  k: NumKey
  label: string
  description: ReactNode
  format?: (v: number) => string
  debounceMs?: number
}) {
  const [settings, update] = useSettingsState()
  const stored = settings[k]
  const [draft, setDraft] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  // Commit any pending value when unmounting.
  const pending = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) update({ [k]: pending.current } as Partial<Settings>)
    },
    [k, update],
  )

  const r = UI_RANGES[k]
  const value = draft ?? stored
  const onChange = (v: number) => {
    if (!debounceMs) {
      update({ [k]: v } as Partial<Settings>)
      return
    }
    setDraft(v)
    pending.current = v
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      pending.current = null
      update({ [k]: v } as Partial<Settings>)
      setDraft(null)
    }, debounceMs)
  }
  return (
    <Slider
      label={label}
      description={description}
      value={value}
      min={Math.min(r.min, stored)}
      max={Math.max(r.max, stored)}
      step={r.step}
      format={format}
      onChange={onChange}
    />
  )
}

function ListenPreview({ s }: { s: Settings }) {
  const audioOnly = s.listenFront === 'audioOnly'
  return (
    <div
      aria-hidden
      className="flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-paper px-4 py-4"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-solid text-accent-ink">
        <Icon name="volume" size={20} />
      </span>
      {audioOnly ? (
        <span className="text-sm text-muted">Just the sound</span>
      ) : (
        <>
          <Pinyin text={PREVIEW.pinyin} tones={PREVIEW.tones} size="lg" toneColors={s.toneColors} />
          {s.showCharacters ? <Hanzi text={PREVIEW.trad} size="sm" force /> : null}
        </>
      )}
    </div>
  )
}

function ToneLegend({ on }: { on: boolean }) {
  const tones = [
    { t: 1, s: 'mā', n: '1st' },
    { t: 2, s: 'má', n: '2nd' },
    { t: 3, s: 'mǎ', n: '3rd' },
    { t: 4, s: 'mà', n: '4th' },
    { t: 5, s: 'ma', n: 'neutral' },
  ]
  return (
    <ul aria-label="Tone colors" className={cx('mb-3 flex flex-wrap gap-x-4 gap-y-1 pinyin', on && 'tone-colors')}>
      {tones.map((x) => (
        <li key={x.t} className="flex items-baseline gap-1.5">
          <span lang="zh-Latn-pinyin" className={cx(`tone-${x.t}`, 'text-lg font-medium')}>
            {x.s}
          </span>
          <span className="text-xs text-muted">{x.n}</span>
        </li>
      ))}
    </ul>
  )
}

export function StudySection() {
  const [s, update] = useSettingsState()
  const unstable = useSelector((x) => x.queue.unstableWords)
  const introduced = useSelector((x) => x.queue.introducedWords)
  const sample = sampleWord()
  const isDefault = STUDY_KEYS.every((k) => s[k] === DEFAULT_SETTINGS[k])

  const restore = () => {
    const patch: Partial<Settings> = {}
    for (const k of STUDY_KEYS) (patch as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k]
    update(patch)
  }

  return (
    <Section id="study" title="Study" icon="study" intro="How cards look and sound, and how fast new words arrive.">
      <Row py="loose" className="flex flex-col gap-3">
        <RowLabel
          id="listen-front-label"
          title="Listen card front"
          description="What you see before revealing the meaning. Audio only trains your ear hardest."
        />
        <SegmentedControl
          label="Listen card front"
          value={s.listenFront}
          onChange={(listenFront) => update({ listenFront })}
          options={[
            { value: 'full', label: 'Audio + pinyin', icon: 'eye' },
            { value: 'audioOnly', label: 'Audio only', icon: 'eye-off' },
          ]}
        />
        <ListenPreview s={s} />
      </Row>
      <Row py="tight">
        <Toggle
          label="Show characters"
          description="Small Traditional characters under the pinyin."
          checked={s.showCharacters}
          onChange={(showCharacters) => update({ showCharacters })}
        />
      </Row>
      <Row py="tight">
        <Toggle
          label="Tone colors"
          description="Color each syllable by its tone."
          checked={s.toneColors}
          onChange={(toneColors) => update({ toneColors })}
        />
        <ToneLegend on={s.toneColors} />
      </Row>
      <Row py="tight">
        <Toggle
          label="Autoplay audio"
          description="Play the word when a Listen card appears, and when a Say card's answer is shown."
          checked={s.autoplay}
          onChange={(autoplay) => update({ autoplay })}
        />
      </Row>
      <Row py="tight" className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <SettingSlider
            k="slowRate"
            label="Slow playback speed"
            description="Speed of the slow button. The pitch stays the same."
            format={pct}
          />
        </div>
        {sample ? (
          <AudioButton wordId={sample.id} slow size="md" className="mb-2" label={`Play ${sample.trad} slowly`}>
            Try
          </AudioButton>
        ) : null}
      </Row>

      <Row py="loose" className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">Pace</h3>
        <SettingSlider
          k="requestRetention"
          label="Target retention"
          debounceMs={350}
          format={pct}
          description={
            <>
              How likely you should be to remember a word when it comes back. Higher means you forget less but see every word
              more often; above 95% the reviews pile up fast. 90% is a good balance.
            </>
          }
        />
        <SettingSlider
          k="workingSetCap"
          label="Words in progress"
          description={
            <>
              How many words you learn at once. A new word arrives only when one of these becomes stable, so{' '}
              <strong className="font-medium text-ink">higher = new words come faster</strong>, with more reviews per day.{' '}
              <span className="tabular-nums">
                Now: {unstable} in progress, {introduced} introduced.
              </span>
            </>
          }
        />
        <SettingSlider
          k="stableDays"
          label="Stable after"
          format={(v) => `${v} day${v === 1 ? '' : 's'}`}
          description="A word stops counting as in progress once you'd likely remember it this long. Lower = new words come faster, but they're less settled."
        />
        <SettingSlider
          k="backlogLimit"
          label="Backlog limit"
          format={(v) => `${v} review${v === 1 ? '' : 's'}`}
          description="New words pause while more reviews than this are due. After a break you catch up first, so missed days never cause a flood."
        />
        <div className="pt-2">
          <Button variant="ghost" size="sm" icon="replay" onClick={restore} disabled={isDefault}>
            Restore study defaults
          </Button>
        </div>
      </Row>
    </Section>
  )
}
