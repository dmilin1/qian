// "⋯" menu on the study card: Flag this card (reason + note) and Suspend word.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Word } from '../../data/types'
import type { FlagReason } from '../../lib/events'
import { Button, ConfirmDialog, FlagDialog, Icon, cx, type IconName } from '../../components'

interface MenuProps {
  word: Word
  onFlag: (reason: FlagReason, note: string) => void
  onSuspend: () => void
  /** Reports whether any menu/dialog is open (keyboard shortcuts pause meanwhile). */
  onOpenChange?: (open: boolean) => void
}

type Dialog = 'flag' | 'suspend' | null

function MenuItem({ icon, label, onClick, danger }: { icon: IconName; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        'flex h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-base outline-none hover:bg-sunken focus-visible:bg-sunken',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      <Icon name={icon} size={18} />
      {label}
    </button>
  )
}

export function CardMenu({ word, onFlag, onSuspend, onOpenChange }: MenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    onOpenChange?.(menuOpen || dialog !== null)
  }, [menuOpen, dialog, onOpenChange])

  // Focus the first item on open; close on outside pointer.
  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  const close = (refocus = true) => {
    setMenuOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = items.length
      items[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="md"
        iconOnly
        icon="more"
        aria-label="Card options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen((o) => !o)}
        className="text-muted hover:text-ink"
      />
      {menuOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Card options"
          onKeyDown={onMenuKey}
          className="absolute top-full right-0 z-30 mt-1 w-60 rounded-xl border border-line bg-card p-1.5 shadow-pop motion-safe:animate-fade-in"
        >
          <MenuItem
            icon="flag"
            label="Flag this card…"
            onClick={() => {
              close(false)
              setDialog('flag')
            }}
          />
          <MenuItem
            icon="eye-off"
            label="Suspend word…"
            danger
            onClick={() => {
              close(false)
              setDialog('suspend')
            }}
          />
        </div>
      ) : null}

      <FlagDialog
        open={dialog === 'flag'}
        wordLabel={`${word.pinyin} “${word.gloss}”`}
        onClose={() => setDialog(null)}
        onSubmit={(reason, note) => {
          setDialog(null)
          onFlag(reason, note)
        }}
      />
      <ConfirmDialog
        open={dialog === 'suspend'}
        title={`Suspend “${word.gloss}”?`}
        description={`${word.pinyin} won't be shown again (both cards). You can unsuspend it from the Words tab.`}
        confirmLabel="Suspend"
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null)
          onSuspend()
        }}
      />
    </div>
  )
}
