import type { ReactNode } from 'react'
import { version } from '../../../package.json'
import { SealMark } from '../../components'
import manifestJson from '../../data/audio-manifest.json'
import { getManifest, getWords } from '../../lib/words'
import { Row, Section } from './Section'
import { STUDY_SHORTCUTS } from './shortcuts'

export const APP_VERSION: string = version
/** createManifest() does not expose generatedAt, so read it from the JSON. */
const manifestGeneratedAt: string = (manifestJson as { generatedAt?: string }).generatedAt ?? ''

interface Source {
  name: string
  /** Original (Chinese) title, rendered with lang=zh-TW. */
  nameZh?: string
  href: string
  what: string
  license: ReactNode
}

const SOURCES: Source[] = [
  {
    name: 'SUBTLEX-CH',
    href: 'https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexch',
    what: 'Word frequencies from film and TV subtitles (Cai & Brysbaert, 2010).',
    license: 'Free for research use, cited as requested by the authors',
  },
  {
    name: 'wordfreq',
    href: 'https://github.com/rspeer/wordfreq',
    what: 'Second frequency signal, blended with SUBTLEX-CH.',
    license: 'Data CC BY-SA 4.0',
  },
  {
    name: 'CC-CEDICT',
    href: 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
    what: 'English meanings and readings.',
    license: 'CC BY-SA 4.0',
  },
  {
    name: 'MOE Revised Mandarin Dictionary, via moedict',
    nameZh: '教育部重編國語辭典修訂本',
    href: 'https://www.moedict.tw/',
    what: 'Taiwan standard pronunciations.',
    license: 'CC BY-ND 3.0 TW, © Ministry of Education, Taiwan',
  },
  {
    name: 'OpenCC',
    href: 'https://github.com/BYVoid/OpenCC',
    what: 'Conversion to Traditional characters and Taiwan vocabulary.',
    license: 'Apache 2.0',
  },
]

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-8 items-center justify-center rounded-md border border-line-strong bg-paper px-2 py-0.5 font-sans text-sm font-medium text-ink shadow-[inset_0_-1px_0_var(--line-strong)]">
      {children}
    </kbd>
  )
}

export function AboutSection() {
  const manifest = getManifest()
  const generated = getManifestDate()
  const wordCount = getWords().order.length
  return (
    <Section id="about" title="About" icon="info">
      <Row py="loose" className="flex items-center gap-4">
        <SealMark size={48} />
        <div className="flex min-w-0 flex-col">
          <span className="text-lg font-semibold tracking-tight text-ink">
            <span lang="zh-TW">千</span> qian
          </span>
          <span className="text-sm text-muted">
            The {wordCount.toLocaleString()} most common Mandarin words, learned by ear. Version{' '}
            <span className="tabular-nums">{APP_VERSION}</span>.
          </span>
        </div>
      </Row>

      <Row py="loose" className="flex flex-col gap-2">
        <h3 className="font-medium text-ink">Audio</h3>
        <p className="text-sm text-muted">
          Recorded with ElevenLabs, voice “Anna Su” (Taiwan Mandarin){manifest.model ? `, model ${manifest.model}` : ''}
          {generated ? `, generated ${generated}` : ''}. Words without a recording use your browser's speech voice.
        </p>
      </Row>

      <Row py="loose" className="flex flex-col gap-3">
        <h3 className="font-medium text-ink">Word list sources</h3>
        <ul className="flex flex-col gap-3">
          {SOURCES.map((s) => (
            <li key={s.name} className="flex flex-col text-sm">
              <a href={s.href} target="_blank" rel="noopener noreferrer" className="w-fit font-medium text-accent underline-offset-2 hover:underline">
                {s.name}
              </a>
              {s.nameZh ? (
                <span lang="zh-TW" className="text-muted">
                  {s.nameZh}
                </span>
              ) : null}
              <span className="text-muted">{s.what}</span>
              <span className="text-faint">{s.license}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          Glosses, hints and example sentences were written for qian and checked against these dictionaries. Because they draw
          on CC-CEDICT, the word data is shared under CC BY-SA 4.0.
        </p>
      </Row>

      <Row py="loose" className="flex flex-col gap-3">
        <h3 className="font-medium text-ink">Keyboard shortcuts</h3>
        <p className="-mt-2 text-sm text-muted">On the Study screen, with a keyboard.</p>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
          {STUDY_SHORTCUTS.map((s) => (
            <div key={s.action} className="contents">
              <dt className="flex gap-1">
                {s.keys.map((k) => (
                  <Key key={k}>{k}</Key>
                ))}
              </dt>
              <dd className="text-sm text-ink">{s.action}</dd>
            </div>
          ))}
        </dl>
      </Row>
    </Section>
  )
}

function getManifestDate(): string | null {
  const raw = manifestGeneratedAt
  if (!raw) return null
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return null
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(t)
  } catch {
    return null
  }
}
