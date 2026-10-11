// Design system + app shell. See docs/app-notes.md ("UI shell and components").
export { AppProvider } from './AppProvider'
export { AppShell, PageLoading } from './AppShell'
export { NAV_ITEMS, type NavItem } from './navItems'
export { AudioButton, type AudioButtonProps } from './AudioButton'
export { Button, type ButtonProps } from './Button'
export { buttonClasses, type ButtonVariant, type ButtonSize } from './buttonStyles'
export { Card, type CardProps } from './Card'
export { cx } from './cx'
export { Banner, EmptyState, Kbd, Logo, PageHeader, SealMark, Spinner, StatTile } from './Display'
export { FlagDialog, type FlagDialogProps } from './FlagDialog'
export { FLAG_NOTE_MAX, FLAG_REASON_LABEL } from './flagReasons'
export { Hanzi, type HanziProps } from './Hanzi'
export {
  useAudioPlayer,
  useIsAudioUnlocked,
  useNow,
  usePageTitle,
  useSelector,
  useSettings,
  useSettingsState,
  useSnapshot,
  useStore,
} from './hooks'
export { Icon, type IconName } from './Icon'
export { ConfirmDialog, Modal, type ModalProps } from './Modal'
export { NoteText } from './NoteText'
export { annotateNote, buildNoteDictionary, lookupPinyin, type NoteDictionary, type NoteSegment } from './noteAnnotate'
export { Pinyin, type PinyinProps } from './Pinyin'
export { segmentPinyin, splitSyllables, toneOf, type PinyinSegment } from './pinyinText'
export { playClip, stopPlayback, useIsPlaying, useNowPlaying, type NowPlaying } from './playback'
export { SegmentedControl, Select, type SelectOption, type SegmentedOption } from './Select'
export { Slider } from './Slider'
export { applyTheme, resolveTheme, THEME_COLORS, useSystemDark } from './theme'
export { ThemeSync } from './ThemeSync'
export { Toggle } from './Toggle'
