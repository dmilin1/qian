// Hooks for the Stats page.
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'

const REDUCED = '(prefers-reduced-motion: reduce)'
function subscribeReduced(cb: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(REDUCED)
  mq.addEventListener?.('change', cb)
  return () => mq.removeEventListener?.('change', cb)
}
function getReduced() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED).matches : false
}

/** True when the user prefers reduced motion (chart animations are then disabled). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, getReduced, () => false)
}

/** Content-box width of an element (null until measured, or where ResizeObserver is missing). */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}
