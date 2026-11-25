import { App, Modal, Notice } from 'obsidian'
import { Currency, SUPPORTED_CURRENCIES, Wallet, WalletType } from '../types'
import { t } from '../i18n'
import { getWalletCurrency } from '../utils'

export class WalletEditModal extends Modal {
  private wallet: Wallet
  private onSave: (patch: Partial<Wallet>) => void | Promise<void>
  private name: string
  private type: WalletType
  private currency: Currency
  private balance: number

  constructor(app: App, wallet: Wallet, onSave: (patch: Partial<Wallet>) => void | Promise<void>) {
    super(app)
    this.wallet = wallet
    this.onSave = onSave
    this.name = wallet.name
    this.type = wallet.type
    this.currency = getWalletCurrency(wallet)
    this.balance = wallet.initialBalance
  }

  onOpen() {
    const { contentEl, containerEl } = this
    containerEl.addClass('pw-wallet-edit-modal-container')
    contentEl.addClass('pw-modal')
    contentEl.createEl('h2', { text: t('ui.edit') })

    const formEl = contentEl.createDiv('pw-wallet-edit-form')
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches
    const syncKeyboardState = () => {
      if (!isTouchDevice) return
      const activeEl = document.activeElement
      const isEditingFieldFocused = !!activeEl && formEl.contains(activeEl)
      if (isEditingFieldFocused) {
        containerEl.setCssProps({ 'padding-bottom': '40vh' })
      } else {
        containerEl.style.removeProperty('padding-bottom')
      }
    }

    formEl.addEventListener('focusin', syncKeyboardState)
    formEl.addEventListener('focusout', () => window.requestAnimationFrame(syncKeyboardState))

    const nameRow = formEl.createDiv('pw-wallet-edit-field')
    nameRow.createEl('label', { text: t('settings.walletName'), cls: 'pw-wallet-edit-label' })
    const nameInput = nameRow.createEl('input', { type: 'text', cls: 'pw-field-input' })
    nameInput.value = this.name
    nameInput.setAttribute('enterkeyhint', 'done')
    nameInput.addEventListener('input', () => { this.name = nameInput.value.trim() })
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur() })

    const typeRow = formEl.createDiv('pw-wallet-edit-field')
    typeRow.createEl('label', { text: t('settings.walletType'), cls: 'pw-wallet-edit-label' })
    const typeSelect = typeRow.createEl('select', { cls: 'pw-field-input' })
    const walletTypes: WalletType[] = ['cash', 'bank', 'creditCard']
    for (const wt of walletTypes) {
      const opt = typeSelect.createEl('option', { value: wt, text: t(`label.walletType.${wt}`) })
      if (wt === this.type) opt.selected = true
    }
    typeSelect.value = this.type

    const currencyRow = formEl.createDiv('pw-wallet-edit-field')
    currencyRow.createEl('label', { text: t('settings.walletCurrency'), cls: 'pw-wallet-edit-label' })
    const currencySelect = currencyRow.createEl('select', { cls: 'pw-field-input' })
    for (const cur of SUPPORTED_CURRENCIES) {
      const opt = currencySelect.createEl('option', { value: cur, text: t(`label.currency.${cur}`) })
      if (cur === this.currency) opt.selected = true
    }
    currencySelect.value = this.currency
    currencySelect.addEventListener('change', () => { this.currency = currencySelect.value as Currency })

    const balanceRow = formEl.createDiv('pw-wallet-edit-field')
    balanceRow.createEl('label', { text: t('settings.initialBalance'), cls: 'pw-wallet-edit-label' })
    const balInput = balanceRow.createEl('input', { type: 'number', cls: 'pw-field-input' })
    balInput.value = String(this.balance)
    balInput.setAttribute('min', '0')
    balInput.setAttribute('enterkeyhint', 'done')
    balInput.addEventListener('input', () => { this.balance = parseFloat(balInput.value) || 0 })
    balInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') balInput.blur() })

    const hintEl = formEl.createEl('p', {
      text: this.type === 'creditCard'
        ? t('settings.creditBalanceHint')
        : t('settings.cashBankBalanceHint'),
      cls: 'pw-balance-hint pw-wallet-edit-hint',
    })
    typeSelect.addEventListener('change', () => {
      this.type = typeSelect.value as WalletType
      hintEl.textContent = this.type === 'creditCard'
        ? t('settings.creditBalanceHint')
        : t('settings.cashBankBalanceHint')
    })

    const btnRow = contentEl.createDiv('pw-btn-row')
    const saveBtn = btnRow.createEl('button', { text: t('ui.save'), cls: 'mod-cta' })
    saveBtn.dataset['action'] = 'save'
    saveBtn.addEventListener('click', () => {
      if (!this.name) { new Notice(t('err.walletNameEmpty')); return }
      if ((this.type === 'cash' || this.type === 'bank') && this.balance < 0) {
        new Notice(t('err.cashBankNegativeBalance')); return
      }
      if (this.type === 'creditCard' && this.balance < 0) {
        new Notice(t('err.creditNegativeBalanceShort')); return
      }
      void this.onSave({ name: this.name, type: this.type, currency: this.currency, initialBalance: this.balance })
      this.close()
    })
    const cancelBtn = btnRow.createEl('button', { text: t('ui.cancel') })
    cancelBtn.dataset['action'] = 'cancel'
    cancelBtn.addEventListener('click', () => this.close())
  }

  onClose() {
    this.containerEl.removeClass('pw-wallet-edit-modal-container')
    this.containerEl.style.removeProperty('padding-bottom')
    this.contentEl.empty()
  }
}
