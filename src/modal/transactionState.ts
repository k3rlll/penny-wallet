import type { TransactionType, PennyWalletConfig, Transaction, Wallet } from '../types'
import { translateCategory } from '../i18n'
import { validateTag, dateToMonthDay, getWalletCurrency } from '../utils'

/**
 * Form state shared between TransactionModal and helpers in this module.
 * Mirrors the protected fields on TransactionModal class (date, type, ...).
 */
export interface TransactionFormState {
  date: string         // 'yyyy-mm-dd'
  type: TransactionType
  wallet: string
  fromWallet: string
  toWallet: string
  category: string
  note: string
  tags: string[]
  amount: string       // raw input string (not parsed yet)
  toAmount?: string    // target received amount string for cross-currency transfers
  isRefund: boolean
}

export function isCrossCurrencyTransfer(
  config: PennyWalletConfig,
  fromWalletName: string,
  toWalletName: string,
): boolean {
  if (!fromWalletName || !toWalletName || fromWalletName === toWalletName) return false
  const fromW = config.wallets.find(w => w.name === fromWalletName)
  const toW = config.wallets.find(w => w.name === toWalletName)
  if (!fromW || !toW) return false
  return getWalletCurrency(fromW) !== getWalletCurrency(toW)
}

/**
 * Parse a stored Transaction.amount (which may be negative for refunds)
 * back into modal form state. Mirrors initState's refund unwrap.
 */
export function parseAmountForEdit(rawAmount: number): { display: string; isRefund: boolean } {
  if (rawAmount < 0) {
    return { display: String(-rawAmount), isRefund: true }
  }
  return { display: String(rawAmount), isRefund: false }
}

/**
 * Build category dropdown options for a given transaction type.
 * Default keys go through i18n translation; custom labels are user strings.
 */
export function getCategoryOptions(
  config: PennyWalletConfig,
  type: TransactionType,
): { key: string; label: string }[] {
  const catOptions = type === 'expense'
    ? config.options.categories.expense
    : type === 'income'
      ? config.options.categories.income
      : config.options.categories.transfer

  const defaultKeys = catOptions.default
  const customs = catOptions.custom

  return [
    ...defaultKeys.map(key => ({ key, label: translateCategory(key) })),
    ...customs.map(c => ({ key: c, label: c })),
  ]
}

export type AddTagResult =
  | { kind: 'added'; next: string[] }
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'duplicate' }
  | { kind: 'max' }

/**
 * Pure tag-list update. Modal callsite handles input.value clearing,
 * dropdown hiding, and chip rendering as side effects based on the kind.
 */
export function addTagToList(current: string[], raw: string): AddTagResult {
  const normalized = raw.replace(/^#/, '').trim()
  if (!normalized) return { kind: 'empty' }
  if (!validateTag(normalized)) return { kind: 'invalid' }
  if (current.includes(normalized)) return { kind: 'duplicate' }
  if (current.length >= 3) return { kind: 'max' }
  return { kind: 'added', next: [...current, normalized] }
}

export type ValidationErrorKey =
  | 'err.invalidDate'
  | 'err.amountRequired'
  | 'err.toAmountRequired'
  | 'err.amountPositive'
  | 'err.amountInteger'
  | 'err.walletRequired'
  | 'err.fromWalletRequired'
  | 'err.toWalletRequired'
  | 'err.fromMustNotBeCreditCard'
  | 'err.toMustBeCreditCard'
  | 'err.sameWallet'

export type ValidationResult =
  | { ok: true }
  | { ok: false; errorKey: ValidationErrorKey }

/**
 * Pure validation. Mirrors the original branching order in
 * TransactionModal.validate so error messages appear in the same priority.
 */
export function validateTransactionForm(
  state: TransactionFormState,
  config: PennyWalletConfig,
): ValidationResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.date)) {
    return { ok: false, errorKey: 'err.invalidDate' }
  }
  const dp = config.decimalPlaces ?? 0
  const amount = parseFloat(state.amount)
  if (!state.amount || isNaN(amount)) {
    return { ok: false, errorKey: 'err.amountRequired' }
  }
  if (amount <= 0) {
    return { ok: false, errorKey: 'err.amountPositive' }
  }
  if (dp === 0 && !Number.isInteger(amount)) {
    return { ok: false, errorKey: 'err.amountInteger' }
  }

  if (state.type === 'expense' || state.type === 'income') {
    if (!state.wallet) return { ok: false, errorKey: 'err.walletRequired' }
  } else {
    if (!state.fromWallet) return { ok: false, errorKey: 'err.fromWalletRequired' }
    if (!state.toWallet) return { ok: false, errorKey: 'err.toWalletRequired' }
    if (state.category === 'credit_card_payment') {
      const fromType = config.wallets.find(w => w.name === state.fromWallet)?.type
      const toType = config.wallets.find(w => w.name === state.toWallet)?.type
      if (fromType === 'creditCard') {
        return { ok: false, errorKey: 'err.fromMustNotBeCreditCard' }
      }
      if (toType !== 'creditCard') {
        return { ok: false, errorKey: 'err.toMustBeCreditCard' }
      }
    }
    if (state.fromWallet === state.toWallet) {
      return { ok: false, errorKey: 'err.sameWallet' }
    }
    if (isCrossCurrencyTransfer(config, state.fromWallet, state.toWallet)) {
      const toAmount = parseFloat(state.toAmount ?? '')
      if (!state.toAmount || isNaN(toAmount)) {
        return { ok: false, errorKey: 'err.toAmountRequired' }
      }
      if (toAmount <= 0) {
        return { ok: false, errorKey: 'err.amountPositive' }
      }
      if (dp === 0 && !Number.isInteger(toAmount)) {
        return { ok: false, errorKey: 'err.amountInteger' }
      }
    }
  }
  return { ok: true }
}

/**
 * Build a Transaction payload from form state. Mirrors the inline
 * object literal that used to live in handleConfirm.
 *
 * Refund handling: isRefund=true → amount stored as negative.
 */
export function buildTransactionPayload(state: TransactionFormState, config?: PennyWalletConfig): Transaction {
  const parsedToAmount = state.type === 'transfer' && state.toAmount ? parseFloat(state.toAmount) : undefined
  const includeToAmount = parsedToAmount !== undefined && !isNaN(parsedToAmount) && (
    !config || isCrossCurrencyTransfer(config, state.fromWallet, state.toWallet)
  )
  return {
    date: dateToMonthDay(state.date),
    type: state.type,
    wallet:     (state.type === 'expense' || state.type === 'income') ? state.wallet : undefined,
    fromWallet: state.type === 'transfer' ? state.fromWallet : undefined,
    toWallet:   state.type === 'transfer' ? state.toWallet : undefined,
    category:   state.category || undefined,
    note: state.note,
    amount: state.isRefund ? -parseFloat(state.amount) : parseFloat(state.amount),
    ...(includeToAmount ? { toAmount: parsedToAmount } : {}),
    tags: state.tags.length ? state.tags : undefined,
  }
}

/**
 * Filter active wallets into from/to candidates for transfer category.
 * cc_payment: from excludes creditCard, to only creditCard.
 * Other categories: both from and to use all active wallets.
 */
export function getTransferWalletCandidates(
  activeWallets: Wallet[],
  category: string,
): { fromCandidates: Wallet[]; toCandidates: Wallet[] } {
  if (category === 'credit_card_payment') {
    return {
      fromCandidates: activeWallets.filter(w => w.type !== 'creditCard'),
      toCandidates: activeWallets.filter(w => w.type === 'creditCard'),
    }
  }
  return { fromCandidates: activeWallets, toCandidates: activeWallets }
}
