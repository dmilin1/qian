// Non-component helpers shared by the settings sections.
import { SETTING_RANGES } from '../../lib/settings'
import { getWords } from '../../lib/words'

/**
 * UI ranges. Narrower than the validator's SETTING_RANGES (which accept anything sane from an
 * import); if the stored value is outside, the slider's range widens to include it.
 */
export const UI_RANGES = {
  slowRate: SETTING_RANGES.slowRate,
  requestRetention: { min: 0.8, max: 0.97, step: 0.01 },
  workingSetCap: { min: 5, max: 40, step: 1 },
  stableDays: { min: 1, max: 30, step: 1 },
  backlogLimit: { min: 0, max: 100, step: 1 },
} as const

/** A word to demo audio with: 你好 if present, else the most frequent word. */
export function sampleWord() {
  const w = getWords()
  return w.list.find((x) => x.trad === '你好') ?? w.list[0]
}
