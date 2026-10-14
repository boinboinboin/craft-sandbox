import { Controller } from '@hotwired/stimulus'

// Filters table rows by a search input. Each row carries its searchable text in data-search.
export default class extends Controller {
  static targets = ['input', 'row', 'count', 'empty']

  connect() {
    this.defaultCount = this.hasCountTarget ? this.countTarget.textContent : ''
  }

  filter() {
    const terms = this.inputTarget.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
    let shown = 0
    for (const row of this.rowTargets) {
      const match = terms.every((term) => row.dataset.search.includes(term))
      row.hidden = !match
      if (match) shown++
    }
    if (this.hasCountTarget) {
      this.countTarget.textContent = terms.length ? `${shown.toLocaleString()} of ${this.rowTargets.length.toLocaleString()} players` : this.defaultCount
    }
    if (this.hasEmptyTarget) this.emptyTarget.hidden = shown > 0
  }
}
