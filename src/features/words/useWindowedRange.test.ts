import { describe, expect, it } from 'vitest'
import { computeRange } from './useWindowedRange'

describe('computeRange', () => {
  it('renders the first screen plus overscan when the list starts below the fold', () => {
    // list starts 300px down a 800px viewport: rows 0..5 visible (500/100), +2 overscan
    expect(computeRange(1000, 100, 300, 800, 2)).toEqual({ start: 0, end: 7 })
  })

  it('follows the scroll position', () => {
    // scrolled 5000px past the list top: rows 50..58 visible
    expect(computeRange(1000, 100, -5000, 800, 2)).toEqual({ start: 48, end: 60 })
  })

  it('clamps to the list bounds', () => {
    expect(computeRange(10, 100, -5000, 800, 2)).toEqual({ start: 10, end: 10 })
    expect(computeRange(0, 100, 0, 800, 2)).toEqual({ start: 0, end: 0 })
    expect(computeRange(3, 100, 0, 800, 8)).toEqual({ start: 0, end: 3 })
  })
})
