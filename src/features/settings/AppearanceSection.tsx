import { SegmentedControl, useSettingsState } from '../../components'
import { Row, RowLabel, Section } from './Section'

export function AppearanceSection() {
  const [s, update] = useSettingsState()
  return (
    <Section id="appearance" title="Appearance" icon="sun">
      <Row py="loose" className="flex flex-col gap-3">
        <RowLabel title="Theme" description="System follows your device's light or dark setting." />
        <SegmentedControl
          label="Theme"
          value={s.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: 'system', label: 'System', icon: 'monitor' },
            { value: 'light', label: 'Light', icon: 'sun' },
            { value: 'dark', label: 'Dark', icon: 'moon' },
          ]}
        />
      </Row>
    </Section>
  )
}
