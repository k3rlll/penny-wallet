import { Events, ItemView, WorkspaceLeaf } from 'obsidian'
import { WalletFile } from '../io/WalletFile'
import { t, formatMonthLabel, formatYearMonth } from '../i18n'
import { formatAmount, getWalletCurrency } from '../utils'
import { renderSharedHeader } from './SharedHeader'
import { Chart } from 'chart.js'
import { MonthData, drawNetChart, drawPie, getMonthRange } from './charts'
import { renderCard } from './components'
import type { Currency } from '../types'

export const ASSET_VIEW_TYPE = 'penny-wallet-asset'

export class AssetView extends ItemView {
  private walletFile: WalletFile
  private range: number = 6
  private selectedCurrency: Currency = 'USD'
  private charts: Chart[] = []

  private clearCharts() {
    this.charts.forEach(c => c.destroy())
    this.charts = []
  }

  constructor(leaf: WorkspaceLeaf, walletFile: WalletFile) {
    super(leaf)
    this.walletFile = walletFile
  }

  getViewType() { return ASSET_VIEW_TYPE }
  getDisplayText() { return t('asset.title') }
  getIcon() { return 'wallet' }

  async onOpen() {
    this.registerEvent(
      (this.app.workspace as Events).on('penny-wallet:refresh', () => { void this.render() })
    )
    this.registerEvent(
      (this.app.workspace as Events).on('css-change', () => { void this.render() })
    )
    await this.render()
  }

  onClose(): Promise<void> {
    this.clearCharts()
    this.contentEl.empty()
    return Promise.resolve()
  }

  async render() {
    const { contentEl } = this
    this.clearCharts()
    const savedScroll = contentEl.scrollTop
    contentEl.empty()
    contentEl.addClass('pw-asset')

    const months = getMonthRange(this.range)
    const currencies = this.walletFile.getActiveCurrencies(true)
    if (!currencies.includes(this.selectedCurrency)) {
      this.selectedCurrency = currencies[0] ?? 'USD'
    }

    const [walletBalances, summaries, netTimeline] = await Promise.all([
      this.walletFile.calculateAllWalletBalances(),
      this.walletFile.getMonthSummariesByCurrency(months, this.selectedCurrency),
      this.walletFile.getNetAssetTimeline(months, this.selectedCurrency),
    ])

    const netAssetsByCurrency = this.walletFile.computeNetAssetsByCurrency(walletBalances)
    const dp = this.walletFile.getConfig().decimalPlaces ?? 0

    renderSharedHeader(contentEl, {
      view: this,
      walletFile: this.walletFile,
      activeView: 'asset',
      yearMonth: null,
    })

    if (currencies.length > 1) {
      const curRow = contentEl.createDiv('pw-type-pills')
      for (const cur of currencies) {
        const btn = curRow.createEl('button', {
          text: t(`label.currency.${cur}`),
          cls: 'pw-pill pw-pill-color-neutral' + (this.selectedCurrency === cur ? ' is-active' : ''),
        })
        btn.addEventListener('click', () => {
          this.selectedCurrency = cur
          void this.render()
        })
      }
    }

    // ── 2-column grid ────────────────────────────────────────────────────────
    const grid = contentEl.createDiv('pw-grid-2 pw-asset-grid')

    // ── Left column ─────────────────────────────────────────────────────────
    const leftCol = grid.createDiv('pw-asset-left')

    // Wallet balances card
    const walletCard = renderCard(leftCol, { title: t('dash.walletBalances') })
    const walletList = walletCard.createDiv('pw-wallet-list')

    for (const { wallet, balance } of walletBalances) {
      if (wallet.status === 'archived') continue
      const wCurrency = getWalletCurrency(wallet)
      const row = walletList.createDiv('pw-asset-wallet-row')
      const left = row.createDiv('pw-wallet-left')
      left.createEl('span', {
        text: t(`label.walletType.${wallet.type}`),
        cls: `pw-wallet-badge pw-badge-${wallet.type}`,
      })
      left.createEl('span', {
        text: wCurrency,
        cls: 'pw-wallet-badge',
      })
      left.createEl('span', { text: wallet.name, cls: 'pw-wallet-name' })

      const displayBalance = wallet.type === 'creditCard' ? -balance : balance
      const prefix = displayBalance < 0 ? '-' : ''
      row.createEl('span', {
        text: prefix + formatAmount(Math.abs(displayBalance), dp, wCurrency),
        cls: 'pw-wallet-balance' + (displayBalance < 0 ? ' is-negative' : ''),
      })
    }

    for (const [cur, netAsset] of netAssetsByCurrency) {
      const netRow = walletCard.createDiv('pw-asset-wallet-row pw-net-asset-row')
      const labelSuffix = netAssetsByCurrency.size > 1 ? ` (${cur})` : ''
      netRow.createEl('span', { text: `${t('dash.netAsset')}${labelSuffix}`, cls: 'pw-net-label' })
      const prefix = netAsset < 0 ? '-' : ''
      netRow.createEl('span', {
        text: prefix + formatAmount(Math.abs(netAsset), dp, cur),
        cls: 'pw-net-value' + (netAsset < 0 ? ' is-negative' : ''),
      })
    }

    // Asset allocation pie (≥2 positive-balance non-credit wallets in selectedCurrency)
    const assetMap = new Map<string, number>()
    for (const { wallet, balance } of walletBalances) {
      if (wallet.status === 'archived') continue
      if (wallet.type === 'creditCard') continue
      if (getWalletCurrency(wallet) !== this.selectedCurrency) continue
      if (balance > 0) assetMap.set(wallet.name, balance)
    }
    const chartSuffix = currencies.length > 1 ? ` (${this.selectedCurrency})` : ''
    if (assetMap.size >= 2) {
      const assetCard = renderCard(leftCol, { title: `${t('dash.assetAllocation')}${chartSuffix}` })
      this.charts.push(drawPie(assetCard, assetMap, dp))
    }

    // ── Right column ─────────────────────────────────────────────────────────
    const rightCol = grid.createDiv('pw-asset-right')

    // Net asset trend card (with range picker inside)
    const netCard = renderCard(rightCol)  // no title — header row holds it
    const netCardHeader = netCard.createDiv('pw-card-header-row')
    netCardHeader.createEl('div', { text: `${t('asset.netAssetTrend')}${chartSuffix}`, cls: 'pw-card-title' })
    const rangeRow = netCardHeader.createDiv('pw-range-row')
    for (const r of [3, 6, 12]) {
      rangeRow.createEl('button', {
        text: t(`trend.${r}m` as 'trend.3m' | 'trend.6m' | 'trend.12m'),
        cls: 'pw-range-btn' + (this.range === r ? ' is-active' : ''),
      }).addEventListener('click', () => {
        this.range = r
        void this.render()
      })
    }

    const data: MonthData[] = months.map(ym => ({
      monthLabel: formatMonthLabel(ym),
      tooltipLabel: formatYearMonth(ym, 'short'),
      income: summaries.get(ym)?.income ?? 0,
      expense: summaries.get(ym)?.expense ?? 0,
      net: netTimeline.get(ym) ?? null,
    }))

    const netChartWrap = netCard.createDiv('pw-chart-wrap')
    this.charts.push(drawNetChart(netChartWrap, data, dp))
    contentEl.scrollTop = savedScroll
  }
}
