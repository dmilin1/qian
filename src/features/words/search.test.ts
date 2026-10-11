import { describe, expect, it } from 'vitest'
import { makeWord } from '../../lib/__fixtures__/words'
import { buildSearchIndex, normalizePinyinQuery, pinyinKey, searchWords } from './search'

const WORDS = [
  makeWord(1, { id: 'w662f', trad: '是', simp: '是', pinyin: 'shì', pinyinNumbered: 'shi4', tones: [4], gloss: 'to be; yes' }),
  makeWord(2, { id: 'w4f60', trad: '你', simp: '你', pinyin: 'nǐ', pinyinNumbered: 'ni3', tones: [3], gloss: 'you' }),
  makeWord(3, { id: 'w9019', trad: '這', simp: '这', pinyin: 'zhè', pinyinNumbered: 'zhe4', tones: [4], gloss: 'this' }),
  makeWord(4, { id: 'w77e5-9053', trad: '知道', simp: '知道', pinyin: 'zhī dào', pinyinNumbered: 'zhi1 dao4', tones: [1, 4], gloss: 'to know', hint: 'a fact' }),
  makeWord(5, { id: 'w8a8d-8b58', trad: '認識', simp: '认识', pinyin: 'rèn shi', pinyinNumbered: 'ren4 shi5', tones: [4, 5], gloss: 'to know', hint: 'a person' }),
  makeWord(6, { id: 'w5403', trad: '吃', simp: '吃', pinyin: 'chī', pinyinNumbered: 'chi1', tones: [1], gloss: 'to eat' }),
  makeWord(7, { id: 'w4f60-597d', trad: '你好', simp: '你好', pinyin: 'nǐ hǎo', pinyinNumbered: 'ni3 hao3', tones: [3, 3], spokenAs: 'ní hǎo', gloss: 'hello' }),
  makeWord(8, { id: 'w5973-5152', trad: '女兒', simp: '女儿', pinyin: 'nǚ ér', pinyinNumbered: 'nv3 er2', tones: [3, 2], gloss: 'daughter' }),
  makeWord(9, { id: 'w7da0', trad: '綠', simp: '绿', pinyin: 'lǜ', pinyinNumbered: 'lv4', tones: [4], gloss: 'green' }),
  makeWord(10, { id: 'w5783-573e', trad: '垃圾', simp: '垃圾', pinyin: 'lè sè', pinyinNumbered: 'le4 se4', tones: [4, 4], gloss: 'garbage; trash' }),
  makeWord(11, { id: 'w6771-897f', trad: '東西', simp: '东西', pinyin: 'dōng xi', pinyinNumbered: 'dong1 xi5', tones: [1, 5], gloss: 'thing; stuff' }),
  makeWord(12, { id: 'w597d', trad: '好', simp: '好', pinyin: 'hǎo', pinyinNumbered: 'hao3', tones: [3], gloss: 'good; well' }),
  makeWord(13, { id: 'w670b-53cb', trad: '朋友', simp: '朋友', pinyin: 'péngyǒu', pinyinNumbered: 'peng2 you3', tones: [2, 3], gloss: 'friend' }),
  makeWord(14, { id: 'w5e2b', trad: '師', simp: '师', pinyin: 'shī', pinyinNumbered: 'shi1', tones: [1], gloss: 'teacher; master' }),
  makeWord(15, { id: 'w5341', trad: '十', simp: '十', pinyin: 'shí', pinyinNumbered: 'shi2', tones: [2], gloss: 'ten' }),
]
const index = buildSearchIndex(WORDS)
const find = (q: string) => searchWords(index, q).map((w) => w.trad)

describe('pinyin normalisation', () => {
  it.each([
    ['nihao', 'nihao'],
    ['ni hao', 'nihao'],
    ['Ni3 Hao3', 'ni3hao3'],
    ['ni3hao', 'ni3hao'],
    ['nǐ hǎo', 'ni3hao3'],
    ['nǐhǎo', 'ni3hao3'],
    ['NǏ', 'ni3'],
    ['de0', 'de5'],
    ['lu:4', 'lv4'],
    ['lǜ', 'lv4'],
    ['nü3', 'nv3'],
    ["xi'an", 'xian'],
    ['nǐ', 'ni3'], // decomposed tone mark
  ])('%s -> %s', (q, expected) => {
    expect(normalizePinyinQuery(q)).toBe(expected)
  })

  it('rejects non-pinyin queries', () => {
    expect(normalizePinyinQuery('你好')).toBeNull()
    expect(normalizePinyinQuery('hello!')).toBeNull()
    expect(normalizePinyinQuery('ni7')).toBeNull()
    expect(normalizePinyinQuery('   ')).toBeNull()
  })

  it('builds keys with a tone digit after every syllable', () => {
    expect(pinyinKey('nǐ hǎo', [3, 3])).toEqual({ key: 'ni3hao3', starts: [0, 3] })
    expect(pinyinKey('rèn shi', [4, 5]).key).toBe('ren4shi5')
    expect(pinyinKey('péngyǒu').key).toBe('peng2you3')
    expect(pinyinKey('lǜ').key).toBe('lv4')
  })
})

describe('searchWords: pinyin', () => {
  it('is tone-insensitive without tones', () => {
    expect(find('nihao')).toEqual(['你好'])
    expect(find('ni hao')).toEqual(['你好'])
    // exact matches before longer words; ties in rank order
    expect(find('shi')).toEqual(['是', '師', '十', '認識'])
    expect(find('ni')).toEqual(['你', '你好'])
  })

  it('respects tone numbers', () => {
    expect(find('ni3')).toEqual(['你', '你好'])
    expect(find('ni3hao3')).toEqual(['你好'])
    expect(find('ni3 hao')).toEqual(['你好'])
    expect(find('ni4')).toEqual([])
    // 認識 is rèn shi (neutral), so any typed tone also finds it, ranked after exact-tone matches.
    expect(find('shi1')).toEqual(['師', '認識'])
    expect(find('shi2')).toEqual(['十', '認識'])
    // A typed neutral tone matches any tone, exact-tone and whole-word matches first.
    expect(find('shi5')).toEqual(['是', '師', '十', '認識'])
    expect(find('shi0')).toEqual(['是', '師', '十', '認識'])
  })

  it('lets a neutral tone match the full tone many Taiwanese say', () => {
    expect(find('ren4shi4')).toEqual(['認識']) // data: rèn shi
    expect(find('dong1xi1')).toEqual(['東西']) // data: dōng xi
    expect(find('peng2you5')).toEqual(['朋友']) // data: péng yǒu
    // Full tones never match each other.
    expect(find('ni4')).toEqual([])
    expect(find('ren3shi4')).toEqual([])
  })

  it('respects tone marks', () => {
    expect(find('nǐ hǎo')).toEqual(['你好'])
    expect(find('shì')).toEqual(['是', '認識'])
    expect(find('hǎo')).toEqual(['好', '你好'])
  })

  it('also matches the spoken (sandhi) reading', () => {
    expect(find('ni2 hao3')).toEqual(['你好'])
    expect(find('ní hǎo')).toEqual(['你好'])
  })

  it('matches from a syllable start only', () => {
    expect(find('hao')).toEqual(['好', '你好'])
    expect(find('ao')).toEqual([])
    expect(find('yǒu')).toEqual(['朋友'])
    expect(find('pengyou')).toEqual(['朋友'])
  })

  it('handles ü typed as v, u: or u', () => {
    expect(find('lv')).toEqual(['綠'])
    expect(find('lu:4')).toEqual(['綠'])
    expect(find('lu4')).toEqual(['綠'])
    expect(find('nv er')).toEqual(['女兒'])
  })

  it('uses Taiwan readings', () => {
    expect(find('lese')).toEqual(['垃圾'])
    expect(find('laji')).toEqual([])
  })

  it('treats an unmarked syllable in a marked query as any tone', () => {
    expect(find('dōng xi')).toEqual(['東西'])
    expect(find('dong1xi')).toEqual(['東西'])
    expect(find('dong4')).toEqual([])
  })
})

describe('searchWords: English', () => {
  it('matches glosses and hints, exact parts first', () => {
    expect(find('know')).toEqual(['知道', '認識'])
    expect(find('person')).toEqual(['認識'])
    expect(find('trash')).toEqual(['垃圾'])
    expect(find('to eat')).toEqual(['吃'])
    expect(find('EAT')).toEqual(['吃'])
  })

  it('needs a word start for short queries but allows substrings from 3 letters', () => {
    expect(find('ea')).toEqual(['吃']) // "eat" starts with "ea"
    expect(find('ugh')).toEqual(['女兒']) // "daughter"
    expect(find('ug')).toEqual([])
  })

  it('combines English and pinyin matches', () => {
    // "he" is pinyin for nothing here, but "hello" and "teacher" contain it
    expect(find('he')).toEqual(['你好'])
    // "you" is both an English gloss (你) and pinyin (朋友 péngyǒu)
    expect(find('you')).toEqual(['你', '朋友'])
  })
})

describe('searchWords: characters and rank', () => {
  it('matches traditional and simplified characters', () => {
    expect(find('這')).toEqual(['這'])
    expect(find('这')).toEqual(['這'])
    expect(find('认识')).toEqual(['認識'])
    expect(find('識')).toEqual(['認識'])
    expect(find('你')).toEqual(['你', '你好'])
    expect(find('好')).toEqual(['好', '你好'])
  })

  it('matches a rank number', () => {
    expect(find('7')).toEqual(['你好'])
    expect(find('#12')).toEqual(['好'])
  })

  it('returns everything in rank order for an empty query', () => {
    expect(find('')).toEqual(WORDS.map((w) => w.trad))
    expect(find('   ')).toEqual(WORDS.map((w) => w.trad))
  })
})

describe('searchWords: ranking', () => {
  const MORE = [
    makeWord(33, { id: 'w60f3', trad: '想', simp: '想', pinyin: 'xiǎng', pinyinNumbered: 'xiang3', tones: [3], gloss: 'to think; to want' }),
    makeWord(54, { id: 'w73fe-5728', trad: '現在', simp: '现在', pinyin: 'xiàn zài', pinyinNumbered: 'xian4 zai4', tones: [4, 4], gloss: 'now' }),
    makeWord(60, { id: 'w5abd', trad: '媽', simp: '妈', pinyin: 'mā', pinyinNumbered: 'ma1', tones: [1], gloss: 'mom' }),
    makeWord(61, { id: 'w5abd-5abd', trad: '媽媽', simp: '妈妈', pinyin: 'mā ma', pinyinNumbered: 'ma1 ma5', tones: [1, 5], gloss: 'mother' }),
    makeWord(70, { id: 'w8b1d-8b1d', trad: '謝謝', simp: '谢谢', pinyin: 'xiè xie', pinyinNumbered: 'xie4 xie5', tones: [4, 5], gloss: 'thanks' }),
    makeWord(198, { id: 'w76f8-4fe1', trad: '相信', simp: '相信', pinyin: 'xiāng xìn', pinyinNumbered: 'xiang1 xin4', tones: [1, 4], gloss: 'to believe' }),
    makeWord(250, { id: 'w5148', trad: '先', simp: '先', pinyin: 'xiān', pinyinNumbered: 'xian1', tones: [1], gloss: 'first' }),
    makeWord(580, { id: 'w73fe-5834', trad: '現場', simp: '现场', pinyin: 'xiàn chǎng', pinyinNumbered: 'xian4 chang3', tones: [4, 3], gloss: 'scene; on the spot' }),
  ]
  const idx = buildSearchIndex(MORE)
  const find2 = (q: string) => searchWords(idx, q).map((w) => w.trad)

  it('ranks whole-syllable matches above ones that stop inside a syllable', () => {
    // "xian" is a whole syllable of 現在/現場 but only the start of xiǎng/xiāng.
    expect(find2('xian')).toEqual(['先', '現在', '現場', '想', '相信'])
  })

  it('ranks exact-tone matches above neutral-tone-lenient ones', () => {
    expect(find2('xie4xie4')).toEqual(['謝謝'])
    expect(find2('ma1')).toEqual(['媽', '媽媽'])
    expect(find2('ma1ma5')).toEqual(['媽媽'])
    expect(find2('ma1ma1')).toEqual(['媽媽'])
  })
})
