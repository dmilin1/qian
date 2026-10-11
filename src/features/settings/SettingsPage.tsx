// Settings: study options, appearance, audio (test + offline download), data (export / import /
// persistence / reset), install instructions and about.
import { PageHeader } from '../../components'
import { AboutSection } from './AboutSection'
import { AppearanceSection } from './AppearanceSection'
import { AudioSection } from './AudioSection'
import { DataSection } from './DataSection'
import { InstallSection } from './InstallSection'
import { StudySection } from './StudySection'

const SECTIONS = [
  { id: 'study', label: 'Study' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'audio', label: 'Audio' },
  { id: 'data', label: 'Data' },
  { id: 'install', label: 'Install' },
  { id: 'about', label: 'About' },
] as const

/**
 * In-page jump links. They are buttons rather than #anchors because the app uses hash routing
 * (/qian/#/settings), where a fragment link would navigate away.
 */
function JumpNav() {
  const jump = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    // Move focus to the section heading for keyboard and screen-reader users.
    const h = el.querySelector<HTMLElement>('h2')
    if (h) {
      h.tabIndex = -1
      h.focus({ preventScroll: true })
    }
  }
  return (
    <nav aria-label="Settings sections" className="-mt-2 mb-6">
      <ul className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => jump(s.id)}
              className="h-9 cursor-pointer rounded-full border border-line bg-card px-3.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <JumpNav />
      <div className="flex flex-col gap-10 pb-8">
        <StudySection />
        <AppearanceSection />
        <AudioSection />
        <DataSection />
        <InstallSection />
        <AboutSection />
      </div>
    </>
  )
}
