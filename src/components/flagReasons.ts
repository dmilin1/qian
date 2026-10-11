import type { FlagReason } from '../lib/events'

/** Labels for flag reasons, shared by the flag dialog, word detail and exports. */
export const FLAG_REASON_LABEL: Record<FlagReason, string> = {
  audio: 'Audio sounds wrong',
  pinyin: 'Wrong pinyin or tones',
  meaning: 'Wrong or unclear meaning',
  example: 'Problem with the example',
  other: 'Something else',
}

export const FLAG_NOTE_MAX = 500
