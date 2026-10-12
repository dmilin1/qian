// Keyboard shortcuts on the Study screen. Keep in sync with src/features/study/useStudyHotkeys.ts.
export interface Shortcut {
  keys: string[]
  action: string
}

export const STUDY_SHORTCUTS: readonly Shortcut[] = [
  { keys: ['Space', 'Enter'], action: 'Show the answer, or replay the audio' },
  { keys: ['1'], action: 'Again' },
  { keys: ['2'], action: 'Good' },
  { keys: ['3'], action: 'Easy' },
  { keys: ['R'], action: 'Replay the audio' },
  { keys: ['S'], action: 'Replay slowly' },
  { keys: ['E'], action: 'Play the example sentence (a hint on Listen cards)' },
  { keys: ['K'], action: 'I already know this (new words)' },
  { keys: ['N'], action: 'Add or edit your note' },
  { keys: ['Z'], action: 'Undo the last grade' },
]
