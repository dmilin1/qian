// Minimal window-scroll virtualization for a list of fixed-height rows. The page (window) scrolls,
// not an inner container, so the browser's own scroll restoration and the sticky top/tab bars
// keep working. Only the rows near the viewport (plus `overscan` on each side) are rendered.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export interface WindowRange {
  start: number
  end: number // exclusive
}

/** Pure range computation (exported for tests). */
export function computeRange(count: number, rowHeight: number, listTop: number, viewport: number, overscan: number): WindowRange {
  if (count <= 0) return { start: 0, end: 0 }
  const scrolledPast = Math.max(0, -listTop)
  const first = Math.floor(scrolledPast / rowHeight)
  const visibleBottom = Math.max(0, viewport - Math.max(listTop, 0) + scrolledPast)
  const last = Math.ceil(visibleBottom / rowHeight)
  const start = Math.max(0, Math.min(count, first - overscan))
  const end = Math.max(start, Math.min(count, last + overscan))
  return { start, end }
}

export function useWindowedRange(
  ref: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  overscan = 8,
): WindowRange {
  const [range, setRange] = useState<WindowRange>(() => computeRange(count, rowHeight, 0, typeof window === 'undefined' ? 800 : window.innerHeight || 800, overscan))
  const frame = useRef(0)

  const measure = useCallback(() => {
    frame.current = 0
    const el = ref.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    const viewport = window.innerHeight || document.documentElement.clientHeight || 800
    const next = computeRange(count, rowHeight, top, viewport, overscan)
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
  }, [ref, count, rowHeight, overscan])

  useLayoutEffect(() => {
    measure()
    const onScroll = () => {
      if (!frame.current) frame.current = requestAnimationFrame(measure)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [measure])

  return range
}
