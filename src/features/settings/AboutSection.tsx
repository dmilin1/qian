import { useMemo, type ReactNode } from 'react'
import { version } from '../../../package.json'
import { SealMark } from '../../components'
import manifestJson from '../../data/audio-manifest.json'
import { getManifest, getWords, type Manifest, type WordIndex } from '../../lib/words'
import { recordedWordCount } from './audioCache'
import { Row, Section } from './Section'
import { STUDY_SHORTCUTS } from './shortcuts'

export const APP_VERSION: string = version
/** createManifest() does not expose generatedAt, so read it from the JSON. */
const manifestGeneratedAt: string = (manifestJson as { generatedAt?: string }).generatedAt ?? ''

const LICENSES = {
  ccBySa4: 'https://creativecommons.org/licenses/by-sa/4.0/',
  ccByNd3Tw: 'https://creativecommons.org/licenses/by-nd/3.0/tw/',
  apache2: 'https://www.apache.org/licenses/LICENSE-2.0',
} as const
const REPO_URL = 'https://github.com/dmilin1/qian'

interface Source {
  name: string
  /** Original (Chinese) title, rendered with lang=zh-TW. */
  nameZh?: string
  href: string
  what: string
  license: ReactNode
  /** Link to the license text (attribution licenses expect one). */
  licenseHref?: string
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
    licenseHref: LICENSES.ccBySa4,
  },
  {
    name: 'CC-CEDICT',
    href: 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
    what: 'English meanings and readings.',
    license: 'CC BY-SA 4.0',
    licenseHref: LICENSES.ccBySa4,
  },
  {
    name: 'MOE Revised Mandarin Dictionary, via moedict',
    nameZh: '教育部重編國語辭典修訂本',
    href: 'https://www.moedict.tw/',
    what: 'Taiwan standard pronunciations (reading fields only; no dictionary text is copied).',
    license: 'CC BY-ND 3.0 TW, © Ministry of Education, Taiwan',
    licenseHref: LICENSES.ccByNd3Tw,
  },
  {
    name: 'OpenCC',
    href: 'https://github.com/BYVoid/OpenCC',
    what: 'Conversion to Traditional characters and Taiwan vocabulary.',
    license: 'Apache 2.0',
    licenseHref: LICENSES.apache2,
  },
]

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-8 items-center justify-center rounded-md border border-line-strong bg-paper px-2 py-0.5 font-sans text-sm font-medium text-ink shadow-[inset_0_-1px_0_var(--line-strong)]">
      {children}
    </kbd>
  )
}

export function AboutSection({ words = getWords(), manifest = getManifest() }: { words?: WordIndex; manifest?: Manifest }) {
  const generated = getManifestDate()
  const wordCount = words.order.length
  const recorded = useMemo(() => recordedWordCount(words, manifest), [words, manifest])
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
        <p className="text-sm text-muted" data-testid="about-audio">
          {recorded > 0 ? (
            <>
              {recorded === wordCount ? 'All ' : ''}
              {recorded.toLocaleString()} of {wordCount.toLocaleString()} words recorded with ElevenLabs, voice “Anna Su”
              (Taiwan Mandarin){manifest.model ? `, model ${manifest.model}` : ''}
              {generated ? `, generated ${generated}` : ''}.
              {recorded < wordCount ? " The rest use your browser's speech voice." : ''}
            </>
          ) : (
            "No studio recordings in this build yet; words use your browser's speech voice."
          )}
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
              {s.licenseHref ? (
                <a href={s.licenseHref} target="_blank" rel="noopener noreferrer" className="w-fit text-faint underline underline-offset-2 hover:text-muted">
                  {s.license}
                </a>
              ) : (
                <span className="text-faint">{s.license}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          Glosses, hints and example sentences were written for qian and checked against these dictionaries. Because they draw
          on CC-CEDICT, qian's word list (glosses, hints, examples) is shared under{' '}
          <a href={LICENSES.ccBySa4} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
            CC BY-SA 4.0
          </a>
          ; get it from the{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
            qian repository
          </a>
          .
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
