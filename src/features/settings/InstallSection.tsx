import { useState } from 'react'
import { Banner, Button, Icon } from '../../components'
import { isIOS, isStandalone, promptInstall, useInstallState } from './install'
import { Row, RowLabel, Section } from './Section'

/** The iOS share glyph (square with an up arrow), drawn inline to match Safari's button. */
function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="inline-block align-[-3px]" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
    </svg>
  )
}

function IOSSteps() {
  return (
    <ol className="flex list-none flex-col gap-2 text-ink">
      {[
        <>
          Open qian in <strong className="font-medium">Safari</strong> and tap <span className="font-medium">Share</span>{' '}
          <ShareGlyph />
          <span className="sr-only"> (the square with an arrow)</span>.
        </>,
        <>
          Scroll down and choose <strong className="font-medium">Add to Home Screen</strong>.
        </>,
        <>From now on, open qian from its home-screen icon.</>,
      ].map((step, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-sm font-medium text-muted tabular-nums">
            {i + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  )
}

function OtherSteps({ canPrompt }: { canPrompt: boolean }) {
  return (
    <p className="text-ink">
      {canPrompt
        ? 'Or use your browser menu: '
        : 'In Chrome, Edge or Samsung Internet, open the browser menu and choose '}
      <strong className="font-medium">Install app</strong> or <strong className="font-medium">Add to Home screen</strong>.
    </p>
  )
}

export function InstallSection() {
  const { canPrompt, installedNow } = useInstallState()
  const [standalone] = useState(isStandalone)
  const [ios] = useState(() => isIOS())
  const [declined, setDeclined] = useState(false)
  const installed = standalone || installedNow

  const install = async () => {
    const r = await promptInstall()
    setDeclined(r !== 'accepted')
  }

  return (
    <Section id="install" title="Install" icon="plus" intro="Add qian to your home screen to use it like an app, even offline.">
      {installed ? (
        <Row py="loose">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
              <Icon name="check" size={16} />
            </span>
            <RowLabel
              title={standalone ? 'Installed' : 'Installed. Open qian from your home screen or app list.'}
              description="You're using qian as an app. Keep exporting a backup now and then."
            />
          </div>
        </Row>
      ) : (
        <>
          {canPrompt ? (
            <Row py="loose" className="flex flex-col gap-3">
              <RowLabel title="Install on this device" description="Adds an icon and opens qian in its own window." />
              <div>
                <Button variant="primary" icon="download" onClick={() => void install()}>
                  Install qian
                </Button>
              </div>
              {declined ? <p className="text-sm text-muted">Not installed. You can do it later from here.</p> : null}
            </Row>
          ) : null}
          <Row py="loose" className="flex flex-col gap-3">
            <RowLabel title={ios ? 'iPhone and iPad' : 'Android and desktop'} />
            {ios ? <IOSSteps /> : <OtherSteps canPrompt={canPrompt} />}
          </Row>
          <Row py="loose">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg font-medium text-ink [&::-webkit-details-marker]:hidden">
                {ios ? 'Android and desktop' : 'iPhone and iPad'}
                <Icon name="chevron-down" size={18} className="text-muted transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <div className="pt-3">{ios ? <OtherSteps canPrompt={canPrompt} /> : <IOSSteps />}</div>
            </details>
          </Row>
        </>
      )}
      <Row py="loose">
        <Banner tone={ios && !installed ? 'warning' : 'info'}>
          On iPhone and iPad, Safari may delete a website's data after 7 days without a visit. Installing qian to the home
          screen avoids this. Either way, export a backup regularly.
        </Banner>
      </Row>
    </Section>
  )
}
