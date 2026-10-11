import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AudioButton } from './AudioButton'
import { Button } from './Button'
import { Kbd, StatTile } from './Display'
import { Modal } from './Modal'
import { SegmentedControl } from './Select'
import { Slider } from './Slider'
import { applyTheme, resolveTheme } from './theme'
import { Toggle } from './Toggle'
import { renderWithApp } from './test-utils'

describe('<Button>', () => {
  it('defaults to type=button, applies variant classes and fires onClick', async () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" icon="play" onClick={onClick}>
        Reveal
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Reveal' })
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn.className).toContain('bg-accent-solid')
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('icon-only buttons use their aria-label', () => {
    render(<Button iconOnly icon="undo" aria-label="Undo" />)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })
})

describe('<Toggle>', () => {
  it('is a labeled switch, toggled by clicking the switch or the label', async () => {
    function T() {
      const [on, setOn] = useState(false)
      return <Toggle label="Tone colors" description="Color pinyin by tone" checked={on} onChange={setOn} />
    }
    render(<T />)
    const sw = screen.getByRole('switch', { name: 'Tone colors' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw).toHaveAccessibleDescription('Color pinyin by tone')
    await userEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByText('Tone colors'))
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })
})

describe('<SegmentedControl>', () => {
  it('selects with click and arrow keys', async () => {
    function T() {
      const [v, setV] = useState<'system' | 'light' | 'dark'>('system')
      return (
        <SegmentedControl
          label="Theme"
          value={v}
          onChange={setV}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      )
    }
    render(<T />)
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus()
  })
})

describe('<Slider>', () => {
  it('shows the formatted value', () => {
    render(<Slider label="Target retention" value={0.9} min={0.7} max={0.97} step={0.01} onChange={() => {}} format={(v) => `${Math.round(v * 100)}%`} />)
    const input = screen.getByRole('slider', { name: 'Target retention' })
    expect(input).toHaveAttribute('aria-valuetext', '90%')
    expect(screen.getByText('90%')).toBeInTheDocument()
  })
})

describe('<Modal>', () => {
  it('renders title/content when open and closes on Escape', async () => {
    function T() {
      const [open, setOpen] = useState(true)
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Reset progress?" description="This cannot be undone.">
          <p>body</p>
        </Modal>
      )
    }
    render(<T />)
    const dialog = screen.getByRole('dialog', { name: 'Reset progress?' })
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.')
    expect(screen.getByText('body')).toBeInTheDocument()
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    })
    expect(screen.queryByText('body')).toBeNull()
  })
})

describe('<StatTile> and <Kbd>', () => {
  it('renders label and value; Kbd carries the hover-only class', () => {
    render(
      <>
        <StatTile label="Streak" value={12} hint="days" />
        <Kbd>Space</Kbd>
      </>,
    )
    expect(screen.getByText('Streak')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Space')).toHaveClass('kbd-hint')
  })
})

describe('<AudioButton>', () => {
  it('plays through the player and shows a playing state until playback ends', async () => {
    const { fake } = renderWithApp(
      <>
        <AudioButton wordId="w4f60" />
        <AudioButton wordId="w4f60" slow>
          Slow
        </AudioButton>
      </>,
    )
    const normal = screen.getByRole('button', { name: 'Play word' })
    await userEvent.click(normal)
    expect(fake.play).toHaveBeenCalledWith('w4f60', 'word', { slow: false })
    expect(normal).toHaveAttribute('data-playing', 'true')

    const slow = screen.getByRole('button', { name: /Slow/ })
    expect(slow).not.toHaveAttribute('data-playing')
    await userEvent.click(slow)
    expect(fake.play).toHaveBeenLastCalledWith('w4f60', 'word', { slow: true })
    expect(slow).toHaveAttribute('data-playing', 'true')
    expect(normal).not.toHaveAttribute('data-playing')

    await act(async () => fake.finish('clip'))
    expect(slow).not.toHaveAttribute('data-playing')
  })

  it('syncs the player slow rate from settings', () => {
    const { fake } = renderWithApp(<span />, { settings: { slowRate: 0.6 } })
    expect(fake.player.slowRate).toBe(0.6)
  })
})

describe('theme', () => {
  it('resolves system/light/dark', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('applies the dark class and theme-color meta', () => {
    applyTheme('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#141312')
    applyTheme('light')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f1e7')
  })

  it('follows the theme setting', () => {
    const { store } = renderWithApp(<span />, { settings: { theme: 'dark' } })
    expect(document.documentElement).toHaveClass('dark')
    act(() => store.updateSettings({ theme: 'light' }))
    expect(document.documentElement).not.toHaveClass('dark')
  })
})
