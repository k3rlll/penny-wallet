import { describe, it, expect } from 'vitest'
import { WalletFile } from '../../src/io/WalletFile'
import { createMockApp } from '../helpers/mockApp'
import type { Wallet, Transaction, WalletBalance } from '../../src/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWalletFile(wallets: Wallet[]): WalletFile {
  const { app } = createMockApp()
  const wf = new WalletFile(app)
  wf.updateConfig({ wallets })
  return wf
}

const CASH: Wallet = { name: 'Cash', type: 'cash', initialBalance: 1000, status: 'active', includeInNetAsset: true }
const BANK: Wallet = { name: 'Bank', type: 'bank', initialBalance: 5000, status: 'active', includeInNetAsset: true }
const CARD: Wallet = { name: 'Card', type: 'creditCard', initialBalance: 0, status: 'active', includeInNetAsset: true }

// ── computeWalletBalances ─────────────────────────────────────────────────────

describe('computeWalletBalances', () => {
  it('expense on bank reduces balance', () => {
    const wf = makeWalletFile([BANK])
    const txs: Transaction[] = [{ date: '04/01', type: 'expense', wallet: 'Bank', category: 'food', note: '', amount: 200 }]
    const result = wf.computeWalletBalances(txs)
    expect(result[0].balance).toBe(4800)
  })

  it('expense on creditCard increases debt (balance increases)', () => {
    const wf = makeWalletFile([CARD])
    const txs: Transaction[] = [{ date: '04/01', type: 'expense', wallet: 'Card', category: 'food', note: '', amount: 300 }]
    const result = wf.computeWalletBalances(txs)
    expect(result[0].balance).toBe(300)
  })

  it('income on bank increases balance', () => {
    const wf = makeWalletFile([BANK])
    const txs: Transaction[] = [{ date: '04/01', type: 'income', wallet: 'Bank', category: 'salary', note: '', amount: 10000 }]
    const result = wf.computeWalletBalances(txs)
    expect(result[0].balance).toBe(15000)
  })

  it('transfer: fromWallet decreases, toWallet increases', () => {
    const wf = makeWalletFile([BANK, CASH])
    const txs: Transaction[] = [{ date: '04/01', type: 'transfer', fromWallet: 'Bank', toWallet: 'Cash', note: '', amount: 500 }]
    const result = wf.computeWalletBalances(txs)
    const bank = result.find(r => r.wallet.name === 'Bank')!
    const cash = result.find(r => r.wallet.name === 'Cash')!
    expect(bank.balance).toBe(4500)
    expect(cash.balance).toBe(1500)
  })

  it('credit_card_payment (was repayment): bank decreases, creditCard debt decreases', () => {
    const wf = makeWalletFile([BANK, CARD])
    // First create some credit card debt
    const txs: Transaction[] = [
      { date: '04/01', type: 'expense', wallet: 'Card', category: 'food', note: '', amount: 500 },
      { date: '04/15', type: 'transfer', category: 'credit_card_payment', fromWallet: 'Bank', toWallet: 'Card', note: '', amount: 500 },
    ]
    const result = wf.computeWalletBalances(txs)
    const bank = result.find(r => r.wallet.name === 'Bank')!
    const card = result.find(r => r.wallet.name === 'Card')!
    expect(bank.balance).toBe(4500)   // 5000 - 500
    expect(card.balance).toBe(0)      // 0 + 500 - 500
  })

  it('negative expense on creditCard reduces debt', () => {
    const wf = makeWalletFile([CARD])
    const txs: Transaction[] = [
      { date: '04/01', type: 'expense', wallet: 'Card', category: 'shopping', note: '', amount: 300 },
      { date: '04/02', type: 'expense', wallet: 'Card', category: 'shopping', note: '退款', amount: -100 },
    ]
    const result = wf.computeWalletBalances(txs)
    expect(result[0].balance).toBe(200) // 0 + 300 - 100
  })

  it('negative expense on bank restores balance', () => {
    const wf = makeWalletFile([BANK])
    const txs: Transaction[] = [
      { date: '04/01', type: 'expense', wallet: 'Bank', category: 'shopping', note: '', amount: 500 },
      { date: '04/02', type: 'expense', wallet: 'Bank', category: 'shopping', note: '退款', amount: -200 },
    ]
    const result = wf.computeWalletBalances(txs)
    expect(result[0].balance).toBe(4700) // 5000 - 500 + 200
  })

  it('transfer credit_card_refund no longer has special case (treated as normal transfer)', () => {
    const wf = makeWalletFile([BANK, CARD])
    // Old-style record still parsed, now processed as regular transfer (from-, to+)
    const txs: Transaction[] = [
      { date: '04/01', type: 'transfer', category: 'credit_card_refund', fromWallet: 'Card', toWallet: 'Card', note: '', amount: 100 },
    ]
    const result = wf.computeWalletBalances(txs)
    const card = result.find(r => r.wallet.name === 'Card')!
    // from=Card: balance -= 100; to=Card: balance += 100 → net 0
    expect(card.balance).toBe(0)
  })

  it('unknown wallet in transaction is silently ignored', () => {
    const wf = makeWalletFile([BANK])
    const txs: Transaction[] = [{ date: '04/01', type: 'expense', wallet: 'Ghost', category: 'food', note: '', amount: 100 }]
    const result = wf.computeWalletBalances(txs)
    expect(result[0].balance).toBe(5000) // unaffected
  })

  it('accumulates multiple expenses on the same wallet', () => {
    const wf = makeWalletFile([BANK])
    const txs: Transaction[] = [
      { date: '04/01', type: 'expense', wallet: 'Bank', category: 'food', note: '', amount: 100 },
      { date: '04/02', type: 'expense', wallet: 'Bank', category: 'transport', note: '', amount: 200 },
    ]
    const result = wf.computeWalletBalances(txs)
    expect(result[0].balance).toBe(4700) // 5000 - 100 - 200
  })

  it('preserves wallet order from config', () => {
    const wf = makeWalletFile([CARD, BANK, CASH])
    const result = wf.computeWalletBalances([])
    expect(result.map(r => r.wallet.type)).toEqual(['creditCard', 'bank', 'cash'])
  })
})

// ── computeNetAsset ───────────────────────────────────────────────────────────

describe('computeNetAsset', () => {
  it('sums bank and cash balances', () => {
    const wf = makeWalletFile([BANK, CASH])
    const balances: WalletBalance[] = [
      { wallet: BANK, balance: 5000 },
      { wallet: CASH, balance: 1000 },
    ]
    expect(wf.computeNetAsset(balances)).toBe(6000)
  })

  it('subtracts creditCard debt from net asset', () => {
    const wf = makeWalletFile([BANK, CARD])
    const balances: WalletBalance[] = [
      { wallet: BANK, balance: 5000 },
      { wallet: CARD, balance: 300 }, // 300 in debt
    ]
    expect(wf.computeNetAsset(balances)).toBe(4700)
  })

  it('excludes wallet with includeInNetAsset: false', () => {
    const archived: Wallet = { ...BANK, name: 'OldBank', includeInNetAsset: false }
    const wf = makeWalletFile([CASH, archived])
    const balances: WalletBalance[] = [
      { wallet: CASH, balance: 1000 },
      { wallet: archived, balance: 9999 }, // should be excluded
    ]
    expect(wf.computeNetAsset(balances)).toBe(1000)
  })

  it('excludes creditCard with includeInNetAsset: false', () => {
    const hiddenCard: Wallet = { ...CARD, name: 'OldCard', includeInNetAsset: false }
    const wf = makeWalletFile([BANK, hiddenCard])
    const balances: WalletBalance[] = [
      { wallet: BANK, balance: 5000 },
      { wallet: hiddenCard, balance: 800 }, // should be excluded, not subtracted
    ]
    expect(wf.computeNetAsset(balances)).toBe(5000)
  })

  it('returns 0 for empty balances', () => {
    const wf = makeWalletFile([])
    expect(wf.computeNetAsset([])).toBe(0)
  })
})

// ── computeSummary ────────────────────────────────────────────────────────────

describe('computeSummary', () => {
  it('sums only expense transactions', () => {
    const wf = makeWalletFile([])
    const txs: Transaction[] = [
      { date: '04/01', type: 'expense', wallet: 'Cash', category: 'food', note: '', amount: 200 },
      { date: '04/02', type: 'expense', wallet: 'Cash', category: 'transport', note: '', amount: 50 },
    ]
    expect(wf.computeSummary(txs)).toEqual({ income: 0, expense: 250, netAsset: 0 })
  })

  it('sums only income transactions', () => {
    const wf = makeWalletFile([])
    const txs: Transaction[] = [
      { date: '04/01', type: 'income', wallet: 'Bank', category: 'salary', note: '', amount: 50000 },
    ]
    expect(wf.computeSummary(txs)).toEqual({ income: 50000, expense: 0, netAsset: 0 })
  })

  it('excludes transfer from totals', () => {
    const wf = makeWalletFile([])
    const txs: Transaction[] = [
      { date: '04/01', type: 'transfer', fromWallet: 'Bank', toWallet: 'Cash', note: '', amount: 1000 },
      { date: '04/02', type: 'transfer', category: 'credit_card_payment', fromWallet: 'Bank', toWallet: 'Card', note: '', amount: 500 },
    ]
    expect(wf.computeSummary(txs)).toEqual({ income: 0, expense: 0, netAsset: 0 })
  })

  it('always returns netAsset: 0', () => {
    const wf = makeWalletFile([])
    const { netAsset } = wf.computeSummary([])
    expect(netAsset).toBe(0)
  })

  it('negative expense (refund) reduces monthly expense total', () => {
    const wf = makeWalletFile([BANK])
    const txs: Transaction[] = [
      { date: '04/01', type: 'expense', wallet: 'Bank', category: 'food', note: '', amount: 300 },
      { date: '04/02', type: 'expense', wallet: 'Bank', category: 'food', note: '退款', amount: -100 },
    ]
    expect(wf.computeSummary(txs)).toEqual({ income: 0, expense: 200, netAsset: 0 })
  })
})

// ── groupByCategory ───────────────────────────────────────────────────────────

describe('groupByCategory', () => {
  const wf = makeWalletFile([])

  it('sums amounts for the same category', () => {
    const txs: Transaction[] = [
      { date: '04/01', type: 'expense', wallet: 'Cash', category: 'food', note: '', amount: 100 },
      { date: '04/02', type: 'expense', wallet: 'Cash', category: 'food', note: '', amount: 200 },
    ]
    const map = wf.groupByCategory(txs, 'expense')
    expect(map.get('food')).toBe(300)
  })

  it('falls back to "" for undefined category', () => {
    const txs: Transaction[] = [
      { date: '04/01', type: 'expense', wallet: 'Cash', note: '', amount: 50 },
    ]
    const map = wf.groupByCategory(txs, 'expense')
    expect(map.get('')).toBe(50)
  })

  it('excludes transactions of the wrong type', () => {
    const txs: Transaction[] = [
      { date: '04/01', type: 'income', wallet: 'Bank', category: 'salary', note: '', amount: 10000 },
      { date: '04/02', type: 'expense', wallet: 'Cash', category: 'food', note: '', amount: 100 },
    ]
    const map = wf.groupByCategory(txs, 'expense')
    expect(map.has('salary')).toBe(false)
    expect(map.get('food')).toBe(100)
  })

  it('returns empty map for no matching transactions', () => {
    const txs: Transaction[] = [
      { date: '04/01', type: 'income', wallet: 'Bank', category: 'salary', note: '', amount: 1000 },
    ]
    const map = wf.groupByCategory(txs, 'expense')
    expect(map.size).toBe(0)
  })

  it('filters by currency when currency argument is provided', () => {
    const usdWallet: Wallet = { name: 'USD Bank', type: 'bank', currency: 'USD', initialBalance: 1000, status: 'active', includeInNetAsset: true }
    const kztWallet: Wallet = { name: 'Kaspi KZT', type: 'bank', currency: 'KZT', initialBalance: 100000, status: 'active', includeInNetAsset: true }
    const multiWf = makeWalletFile([usdWallet, kztWallet])
    const txs: Transaction[] = [
      { date: '04/01', type: 'expense', wallet: 'USD Bank', category: 'Coffee', note: '', amount: 5 },
      { date: '04/02', type: 'expense', wallet: 'Kaspi KZT', category: 'Coffee', note: '', amount: 2500 },
    ]
    expect(multiWf.groupByCategory(txs, 'expense', 'USD').get('Coffee')).toBe(5)
    expect(multiWf.groupByCategory(txs, 'expense', 'KZT').get('Coffee')).toBe(2500)
  })
})

describe('multi-currency & cross-currency transfers', () => {
  const USD_BANK: Wallet = { name: 'USD Bank', type: 'bank', currency: 'USD', initialBalance: 1000, status: 'active', includeInNetAsset: true }
  const KZT_BANK: Wallet = { name: 'Kaspi KZT', type: 'bank', currency: 'KZT', initialBalance: 100000, status: 'active', includeInNetAsset: true }
  const KZT_CARD: Wallet = { name: 'KZT Card', type: 'creditCard', currency: 'KZT', initialBalance: 20000, status: 'active', includeInNetAsset: true }

  it('cross-currency transfer debits fromWallet by amount and credits toWallet by toAmount', () => {
    const wf = makeWalletFile([USD_BANK, KZT_BANK])
    const txs: Transaction[] = [
      { date: '04/10', type: 'transfer', fromWallet: 'USD Bank', toWallet: 'Kaspi KZT', note: 'Exchange', amount: 100, toAmount: 50000 },
    ]
    const balances = wf.computeWalletBalances(txs)
    expect(balances.find(b => b.wallet.name === 'USD Bank')?.balance).toBe(900)
    expect(balances.find(b => b.wallet.name === 'Kaspi KZT')?.balance).toBe(150000)
  })

  it('cross-currency credit card payment reduces card debt by toAmount', () => {
    const wf = makeWalletFile([USD_BANK, KZT_CARD])
    const txs: Transaction[] = [
      { date: '04/15', type: 'transfer', category: 'credit_card_payment', fromWallet: 'USD Bank', toWallet: 'KZT Card', note: 'Pay card', amount: 40, toAmount: 20000 },
    ]
    const balances = wf.computeWalletBalances(txs)
    expect(balances.find(b => b.wallet.name === 'USD Bank')?.balance).toBe(960)
    expect(balances.find(b => b.wallet.name === 'KZT Card')?.balance).toBe(0)
  })

  it('computeNetAssetsByCurrency separates USD and KZT net assets', () => {
    const wf = makeWalletFile([USD_BANK, KZT_BANK, KZT_CARD])
    const balances = wf.computeWalletBalances([])
    const netByCur = wf.computeNetAssetsByCurrency(balances)
    expect(netByCur.get('USD')).toBe(1000)
    expect(netByCur.get('KZT')).toBe(80000) // 100000 - 20000 debt
  })

  it('computeSummary filters by currency when currency is specified', () => {
    const wf = makeWalletFile([USD_BANK, KZT_BANK])
    const txs: Transaction[] = [
      { date: '04/01', type: 'income', wallet: 'USD Bank', category: 'salary', note: '', amount: 2000 },
      { date: '04/02', type: 'expense', wallet: 'USD Bank', category: 'Rent', note: '', amount: 500 },
      { date: '04/03', type: 'income', wallet: 'Kaspi KZT', category: 'salary', note: '', amount: 500000 },
      { date: '04/04', type: 'expense', wallet: 'Kaspi KZT', category: 'Groceries', note: '', amount: 45000 },
    ]
    expect(wf.computeSummary(txs, 'USD')).toEqual({ income: 2000, expense: 500, netAsset: 0 })
    expect(wf.computeSummary(txs, 'KZT')).toEqual({ income: 500000, expense: 45000, netAsset: 0 })
  })
})
