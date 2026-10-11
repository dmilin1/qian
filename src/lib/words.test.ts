import { describe, expect, it } from 'vitest'
import { FIXTURE_MANIFEST, FIXTURE_WORDS, makeWord } from './__fixtures__/words'
import { createManifest, createWordIndex, resolveAudioUrl } from './words'

describe('words', () => {
  it('indexes by id and orders by rank', () => {
    const idx = createWordIndex([FIXTURE_WORDS[2], FIXTURE_WORDS[0], FIXTURE_WORDS[1]])
    expect(idx.order).toEqual(['w4f60', 'w6211', 'w662f'])
    expect(idx.get('w6211')?.trad).toBe('我')
    expect(idx.has('nope')).toBe(false)
    expect(idx.indexOf('w662f')).toBe(2)
    expect(idx.indexOf('nope')).toBe(-1)
  })

  it('rejects duplicate ids', () => {
    expect(() => createWordIndex([makeWord(1), makeWord(1)])).toThrow(/Duplicate/)
  })

  it('manifest lookup and URL resolution against the base path', () => {
    const m = createManifest(FIXTURE_MANIFEST)
    expect(m.path('w4f60', 'word')).toBe('audio/w/w4f60.mp3')
    expect(m.path('w6211', 'example')).toBeUndefined()
    expect(m.path('missing', 'word')).toBeUndefined()
    expect(resolveAudioUrl('audio/w/x.mp3', '/qian/')).toBe('/qian/audio/w/x.mp3')
    expect(resolveAudioUrl('/audio/w/x.mp3', '/qian')).toBe('/qian/audio/w/x.mp3')
    expect(resolveAudioUrl('audio/w/x.mp3', '/')).toBe('/audio/w/x.mp3')
    expect(resolveAudioUrl('https://cdn/x.mp3', '/qian/')).toBe('https://cdn/x.mp3')
  })
})
