// Display formatting for the word detail page (English locale, user's time zone).
import type { FlagReason } from '../../lib/events'
import type { CardStatus } from '../../lib/stats'

const DAY = 86_400_000

/** FSRS stability in days -> "14 h", "3.2 days", "2.1 months", "1.4 years". */
export function formatStability(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '—'
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`
  if (days < 10) return `${trim(days.toFixed(1))} ${days < 1.05 ? 'day' : 'days'}`
  if (days < 60) return `${Math.round(days)} days`
  if (days < 365) return `${trim((days / 30.44).toFixed(1))} months`
  return `${trim((days / 365.25).toFixed(1))} years`
}

const trim = (s: string) => s.replace(/\.0$/, '')

/** 0.934 -> "93%"; values above 99.5% show "> 99%" so nothing reads as a certain 100%. */
export function formatPercent(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p > 0.995) return '> 99%'
  return `${Math.round(p * 100)}%`
}

const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null

/** Relative time: "in 10 minutes", "in 3 days", "2 days ago", "now". */
export function formatRelative(ts: number, now: number): string {
  const diff = ts - now
  const abs = Math.abs(diff)
  if (abs < 45_000) return 'now'
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60_000],
    ['hour', 3_600_000],
    ['day', DAY],
    ['month', 30.44 * DAY],
    ['year', 365.25 * DAY],
  ]
  let unit = units[0]
  for (const u of units) if (abs >= u[1] * 0.95) unit = u
  // Switch to days only after 22 hours and to months only after ~6 weeks, which reads better.
  if (unit[0] === 'day' && abs < 22 * 3_600_000) unit = units[1]
  if (unit[0] === 'month' && abs < 45 * DAY) unit = units[2]
  const value = Math.round(diff / unit[1])
  if (rtf) return rtf.format(value, unit[0])
  return diff > 0 ? `in ${Math.abs(value)} ${unit[0]}s` : `${Math.abs(value)} ${unit[0]}s ago`
}

/** "Oct 11, 2026, 2:03 PM" (local time). */
export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
}

/** "Oct 11, 2026" */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en', { dateStyle: 'medium' })
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${s % 60} s`
}

export const STATUS_LABEL: Record<CardStatus, string> = {
  unseen: 'unseen',
  learning: 'learning',
  young: 'young',
  mature: 'mature',
}

export { FLAG_REASON_LABEL } from '../../components/flagReasons'

export const FLAG_REASON_SHORT: Record<FlagReason, string> = {
  audio: 'Audio',
  pinyin: 'Pinyin',
  meaning: 'Meaning',
  example: 'Example',
  other: 'Other',
}

export const POS_LABEL: Record<string, string> = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  pron: 'pronoun',
  measure: 'measure word',
  particle: 'particle',
  conj: 'conjunction',
  prep: 'preposition',
  num: 'number',
  interj: 'interjection',
  phrase: 'phrase',
}

export function posLabel(pos: string): string {
  return POS_LABEL[pos] ?? pos
}
