import { CURRENCY_SYMBOLS, type Currency } from './types'

export function getCurrencySymbol(currency?: Currency): string {
  return CURRENCY_SYMBOLS[currency ?? 'USD'] ?? '$'
}

export function getWalletCurrency(wallet?: { currency?: Currency } | null): Currency {
  return wallet?.currency === 'KZT' ? 'KZT' : 'USD'
}

export function currentYearMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function stepMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function isAfterCurrentMonth(ym: string): boolean {
  return ym > currentYearMonth()
}

export function formatAmount(n: number, dp: 0 | 2 = 0, currency?: Currency): string {
  if (!currency) {
    return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
  }
  const sign = n < 0 ? '-' : ''
  const numStr = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
  return `${sign}${getCurrencySymbol(currency)}${numStr}`
}

// CJK Unified Ideographs (Traditional/Simplified Chinese)
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/

export function validateTag(tag: string): boolean {
  if (!tag.trim()) return false
  if (tag.includes(',') || tag.includes('|')) return false
  const hasCjk = CJK_RE.test(tag)
  const len = [...tag].length
  return hasCjk ? len <= 5 : len <= 10
}

export function formatHeroAmount(raw: string): string {
  if (!raw) return '0'
  const dotIdx = raw.indexOf('.')
  const intPart = dotIdx === -1 ? raw : raw.slice(0, dotIdx)
  const decPart = dotIdx === -1 ? null : raw.slice(dotIdx + 1)

  const intNum = intPart === '' ? 0 : Number(intPart)
  const intStr = Number.isFinite(intNum)
    ? intNum.toLocaleString('en-US')
    : intPart

  if (dotIdx === -1) return intStr
  return `${intStr}.${decPart}`
}

export function formatMobileHeroAmount(raw: string, isRefund: boolean, currency: Currency = 'USD'): string {
  const amount = `${getCurrencySymbol(currency)}${formatHeroAmount(raw)}`
  return isRefund && raw !== '' ? `+ ${amount}` : amount
}

export function dateToYearMonth(date: string): string {
  return date.substring(0, 7)
}

export function dateToMonthDay(date: string): string {
  return date.substring(5).replace('-', '/')
}
