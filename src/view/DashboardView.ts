import { Events, ItemView, WorkspaceLeaf } from 'obsidian'
import { WalletFile } from '../io/WalletFile'
import { t, formatMonthLabel, formatYearMonth } from '../i18n'
import { currentYearMonth } from '../utils'
import { createMetric, renderCard } from './components'
import { Currency, TransactionType } from '../types'
import { DETAIL_VIEW_TYPE } from './DetailView'
import { renderSharedHeader } from './SharedHeader'
import { Chart } from 'chart.js'
import { MonthData, drawIncExpChart, drawPie, getMonthRangeEndingAt } from './charts'

export const DASHBOARD_VIEW_TYPE = 'penny-wallet-dashboard'

export class DashboardView extends ItemView {
  private walletFile: WalletFile
  private currentYearMonth: string
  private selectedCurrency: Currency = 'USD'
  private charts: Chart[] = []

  private clearCharts() {
    this.charts.forEach(c => c.destroy())
    this.charts = []
  }

  constructor(leaf: WorkspaceLeaf, walletFile: WalletFile) {
    super(leaf)
    this.walletFile = walletFile
    this.currentYearMonth = currentYearMonth()
  }

  getViewType() { return DASHBOARD_VIEW_TYPE }
  getDisplayText() { return t('dashboard.title') }
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
    contentEl.empty()
    contentEl.addClass('pw-dashboard')

    const months = getMonthRangeEndingAt(this.currentYearMonth, 6)
    const currencies = this.walletFile.getActiveCurrencies(true)
    if (!currencies.includes(this.selectedCurrency)) {
      this.selectedCurrency = currencies[0] ?? 'USD'
    }

    const [transactions, summaries, netTimeline] = await Promise.all([
      this.walletFile.readMonth(this.currentYearMonth),
      this.walletFile.getMonthSummariesByCurrency(months, this.selectedCurrency),
      this.walletFile.getNetAssetTimeline(months, this.selectedCurrency),
    ])

    renderSharedHeader(contentEl, {
      view: this,
      walletFile: this.walletFile,
      activeView: 'dashboard',
      yearMonth: this.currentYearMonth,
      onMonthChange: (ym) => { this.currentYearMonth = ym; void this.render() },
    })

    const dp = this.walletFile.getConfig().decimalPlaces ?? 0

    // ── Separate monthly metrics per currency ────────────────────────────────
    for (const cur of currencies) {
      const summary = this.walletFile.computeSummary(transactions, cur)
      const monthIncome = summary.income
      const monthExpense = summary.expense
      const monthBalance = monthIncome - monthExpense
      const suffix = currencies.length > 1 ? ` (${cur})` : ''

      const metricsEl = contentEl.createDiv('pw-metrics')
      createMetric(metricsEl, `${t('dash.income')}${suffix}`,  monthIncome,  'income',  { dp, currency: cur })
      createMetric(metricsEl, `${t('dash.expense')}${suffix}`, monthExpense, 'expense', { dp, currency: cur })
      createMetric(metricsEl, `${t('dash.balance')}${suffix}`, monthBalance,
        monthBalance >= 0 ? 'positive' : 'negative',
        { dp, hero: true, currency: cur },
      )
    }

    // ── Currency selector for charts when multiple currencies exist ──────────
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

    // ── 6-month bar chart ────────────────────────────────────────────────────
    const data: MonthData[] = months.map(ym => ({
      monthLabel: formatMonthLabel(ym),
      tooltipLabel: formatYearMonth(ym, 'short'),
      income: summaries.get(ym)?.income ?? 0,
      expense: summaries.get(ym)?.expense ?? 0,
      net: netTimeline.get(ym) ?? null,
    }))

    // ── 2-column grid: bar chart left, pie charts right ─────────────────────
    const grid2 = contentEl.createDiv('pw-grid-2')
    const chartSuffix = currencies.length > 1 ? ` (${this.selectedCurrency})` : ''

    const incExpCard = renderCard(grid2, {
      title: `${t('trend.monthlyIncomeExpense')}${chartSuffix}`,
      className: 'pw-inc-exp-card',
    })
    const incExpChartWrap = incExpCard.createDiv('pw-chart-wrap')
    this.charts.push(drawIncExpChart(incExpChartWrap, data, dp))

    // ── Category pies ────────────────────────────────────────────────────────
    const gridRight = grid2.createDiv('pw-grid-right')

    const expenseMap = this.walletFile.groupByCategory(transactions, 'expense', this.selectedCurrency)
    const incomeMap  = this.walletFile.groupByCategory(transactions, 'income', this.selectedCurrency)

    const expCard = renderCard(gridRight, { title: `${t('dash.expenseByCategory')}${chartSuffix}` })
    if (expenseMap.size > 0) this.charts.push(drawPie(expCard, expenseMap, dp, (cat) => { void this.openDetailWithFilter('expense', cat) }, 200))
    else expCard.createEl('p', { text: t('dash.noData'), cls: 'pw-no-data' })

    const incCard = renderCard(gridRight, { title: `${t('dash.incomeByCategory')}${chartSuffix}` })
    if (incomeMap.size > 0) this.charts.push(drawPie(incCard, incomeMap, dp, (cat) => { void this.openDetailWithFilter('income', cat) }, 200))
    else incCard.createEl('p', { text: t('dash.noData'), cls: 'pw-no-data' })
  }

  private async openDetailWithFilter(type: TransactionType, category: string) {
    await this.openOrRevealView(DETAIL_VIEW_TYPE, {
      state: { yearMonth: this.currentYearMonth, filterType: type, filterCategory: category, resetFilters: true },
    })
  }

  private async openOrRevealView(type: string, options?: { state?: Record<string, unknown> }) {
    const existing = this.app.workspace.getLeavesOfType(type)
    const leaf = existing[0] ?? this.app.workspace.getLeaf('tab')

    await leaf.setViewState({
      type,
      active: true,
      state: options?.state,
    })

    void this.app.workspace.revealLeaf(leaf)
  }
}
