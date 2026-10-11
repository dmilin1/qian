// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { audioRangeResponse } from './audioCache.sw'

const body = () => new Uint8Array(Array.from({ length: 100 }, (_, i) => i))
const full = () => new Response(body(), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
const req = (range?: string) => new Request('http://localhost/qian/audio/w/x-0123abcd.mp3', range ? { headers: { Range: range } } : {})

describe('audioRangeResponse (SW handlerWillRespond)', () => {
  it('turns a full 200 into a 206 slice for a Range request (first, uncached play)', async () => {
    const r = await audioRangeResponse({ request: req('bytes=0-1'), response: full() })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 0-1/100')
    expect(r.headers.get('content-length')).toBe('2')
    expect(r.headers.get('content-type')).toBe('audio/mpeg')
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([0, 1])
  })

  it('handles open-ended, suffix and clamped ranges', async () => {
    const open = await audioRangeResponse({ request: req('bytes=98-'), response: full() })
    expect(open.headers.get('content-range')).toBe('bytes 98-99/100')
    const suffix = await audioRangeResponse({ request: req('bytes=-3'), response: full() })
    expect([...new Uint8Array(await suffix.arrayBuffer())]).toEqual([97, 98, 99])
    const clamped = await audioRangeResponse({ request: req('bytes=90-500'), response: full() })
    expect(clamped.headers.get('content-range')).toBe('bytes 90-99/100')
  })

  it('answers an unsatisfiable range with 416', async () => {
    const r = await audioRangeResponse({ request: req('bytes=200-'), response: full() })
    expect(r.status).toBe(416)
    expect(r.headers.get('content-range')).toBe('bytes */100')
  })

  it('passes through requests without Range, non-200s (cache hits are already 206) and odd ranges', async () => {
    const plain = full()
    expect(await audioRangeResponse({ request: req(), response: plain })).toBe(plain)
    const partial = new Response('x', { status: 206 })
    expect(await audioRangeResponse({ request: req('bytes=0-1'), response: partial })).toBe(partial)
    const multi = full()
    expect(await audioRangeResponse({ request: req('bytes=0-1,5-6'), response: multi })).toBe(multi)
  })
})
