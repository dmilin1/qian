import type { ReactNode } from 'react'
import type { ClipKind, PlayResult } from '../lib/audio'
import { cx } from './cx'
import { useAudioPlayer } from './hooks'
import { Icon } from './Icon'
import { playClip, useIsPlaying } from './playback'

export type AudioButtonSize = 'sm' | 'md' | 'lg' | 'hero'

const SIZES: Record<AudioButtonSize, { box: string; icon: number }> = {
  sm: { box: 'h-9 min-w-9 text-sm', icon: 18 },
  md: { box: 'h-11 min-w-11 text-sm', icon: 20 },
  lg: { box: 'h-14 min-w-14 text-base', icon: 26 },
  hero: { box: 'h-24 min-w-24 text-base', icon: 40 },
}

export interface AudioButtonProps {
  wordId: string
  /** Word clip (default) or example sentence. */
  kind?: ClipKind
  /** Slow variant: plays at settings.slowRate with pitch preserved. */
  slow?: boolean
  size?: AudioButtonSize
  /** Visible text next to the icon (e.g. "Slow"). Icon-only (round) when omitted. */
  children?: ReactNode
  /** Accessible label; defaults to "Play word" / "Play example" / "... slowly". */
  label?: string
  /** Solid accent (primary) or quiet (default). */
  emphasis?: 'primary' | 'quiet'
  className?: string
  disabled?: boolean
  onResult?: (r: PlayResult) => void
}

/**
 * Play/replay a word or example clip. Shows a playing state (also when the same clip was
 * started elsewhere via playClip, e.g. autoplay). Tapping while playing restarts the clip.
 */
export function AudioButton({
  wordId,
  kind = 'word',
  slow = false,
  size = 'md',
  children,
  label,
  emphasis = 'quiet',
  className,
  disabled,
  onResult,
}: AudioButtonProps) {
  const player = useAudioPlayer()
  const playing = useIsPlaying(wordId, kind, slow)
  const s = SIZES[size]
  const aria = label ?? `Play ${kind === 'word' ? 'word' : 'example'}${slow ? ' slowly' : ''}`

  const onClick = async () => {
    const r = await playClip(player, wordId, kind, { slow })
    onResult?.(r)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={children ? undefined : aria}
      title={aria}
      data-playing={playing || undefined}
      className={cx(
        'relative inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-full font-medium',
        'transition-[background-color,color,transform,border-color] duration-150 active:scale-95',
        'disabled:pointer-events-none disabled:opacity-45',
        s.box,
        children ? 'px-4' : '',
        emphasis === 'primary'
          ? 'bg-accent-solid text-accent-ink shadow-card hover:bg-accent-solid-hover'
          : playing
            ? 'border border-accent/50 bg-accent-soft text-accent'
            : 'border border-line-strong bg-card text-ink hover:bg-sunken',
        playing && 'motion-safe:animate-pulse-ring',
        className,
      )}
    >
      <Icon name={playing ? 'volume' : slow ? 'slow' : 'play'} size={s.icon} className={!playing && !slow && !children ? 'translate-x-[1.5px]' : undefined} />
      {children ? <span>{children}</span> : null}
      {children ? <span className="sr-only">{` (${aria})`}</span> : null}
    </button>
  )
}
