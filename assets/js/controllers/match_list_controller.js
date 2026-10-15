import { Controller } from '@hotwired/stimulus'

// A player's match table: shows the first `limit` rows, with a button to show all, and sorts the
// rows by date (newest first), biggest rating gain or biggest rating loss. Rows carry data-index
// (position by date, newest first) and data-change (rating change from the match).
export default class extends Controller {
  static targets = ['body', 'row', 'sort', 'toggle']
  static values = { limit: Number }

  connect() {
    this.expanded = false
  }

  sort(event) {
    const by = event.currentTarget.dataset.sort
    const index = (row) => Number(row.dataset.index)
    const change = (row) => Number(row.dataset.change)
    const compare = {
      date: (a, b) => index(a) - index(b),
      gain: (a, b) => change(b) - change(a) || index(a) - index(b),
      loss: (a, b) => change(a) - change(b) || index(a) - index(b),
    }[by]
    this.bodyTarget.append(...[...this.rowTargets].sort(compare))
    for (const button of this.sortTargets) button.setAttribute('aria-pressed', String(button === event.currentTarget))
    this.update()
  }

  toggle() {
    this.expanded = !this.expanded
    this.update()
  }

  // Show the first `limit` rows in their current order, or all of them when expanded
  update() {
    const rows = [...this.bodyTarget.querySelectorAll('[data-match-list-target="row"]')]
    rows.forEach((row, i) => (row.hidden = !this.expanded && i >= this.limitValue))
    if (this.hasToggleTarget) {
      this.toggleTarget.textContent = this.expanded ? this.toggleTarget.dataset.showFewer : this.toggleTarget.dataset.showAll
    }
  }
}
