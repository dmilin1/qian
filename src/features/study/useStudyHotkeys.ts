// Keyboard shortcuts for the study screen:
//   Space / Enter  reveal (or start / keep practicing; replay once revealed)
//   1 2 3          Again / Good / Easy
//   R  replay   S  slow replay   E  example sentence (a hint before reveal on Listen cards)
//   K  "I already know this"   N  your note   Z  undo
import { useEffect, useRef } from 'react'
import type { GradeName } from '../../lib/events'

export interface StudyHotkeyHandlers {
  primary: () => void
  grade: (g: GradeName) => void
  replay: () => void
  slow: () => void
  example: () => void
  known: () => void
  note: () => void
  undo: () => void
}

const GRADE_KEYS: Record<string, GradeName> = { '1': 'again', '2': 'good', '3': 'easy' }

function isTextField(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLElement && el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file', 'image'].includes(type)
  }
  return false
}

const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role="button"], [role="menuitem"], [role="radio"], [role="switch"]'

/**
 * How the user last moved focus. Chromium switches a mouse-focused button to `:focus-visible` as
 * soon as a key is pressed, so `:focus-visible` cannot tell "clicked Undo, then pressed Space" from
 * "tabbed to Undo, then pressed Space". So we track it: a pointer press means pointer, Tab means keyboard.
 */
type Modality = 'keyboard' | 'pointer'

/**
 * Whether Space/Enter on this element should keep its native meaning (activate the focused
 * control). Only a control reached with the keyboard counts: after clicking Undo or Replay with
 * the mouse, Space still reveals the card instead of undoing or replaying again.
 */
function wantsNativeActivation(el: Element | null, modality: Modality): boolean {
  if (!el || el === document.body) return false
  if (!el.closest(INTERACTIVE)) return false
  return modality === 'keyboard'
}

export function useStudyHotkeys({ enabled, handlers }: { enabled: boolean; handlers: StudyHotkeyHandlers }) {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })

  // Input modality, tracked even while the shortcuts are disabled (e.g. a menu opened by mouse).
  const modality = useRef<Modality>('keyboard')
  useEffect(() => {
    const onPointer = () => {
      modality.current = 'pointer'
    }
    const onKeyNav = (e: KeyboardEvent) => {
      if (e.key === 'Tab') modality.current = 'keyboard'
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKeyNav, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKeyNav, true)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTextField(e.target as Element)) return
      // Any open modal dialog owns the keyboard.
      if (document.querySelector('dialog[open]')) return
      const h = ref.current
      const key = e.key
      if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
        if (wantsNativeActivation(e.target as Element, modality.current)) return
        e.preventDefault()
        if (!e.repeat) h.primary()
        return
      }
      if (e.repeat) return
      if (GRADE_KEYS[key]) {
        e.preventDefault()
        h.grade(GRADE_KEYS[key])
        return
      }
      switch (key.toLowerCase()) {
        case 'r':
          h.replay()
          break
        case 's':
          h.slow()
          break
        case 'e':
          h.example()
          break
        case 'k':
          h.known()
          break
        case 'n':
          h.note()
          break
        case 'z':
          h.undo()
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
