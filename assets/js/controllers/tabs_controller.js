import { Controller } from '@hotwired/stimulus'

// Tabs: buttons (role="tab") that each show one panel (role="tabpanel"). The selected tab is kept
// in the URL hash (the panel's id), so a link can open a given tab, unless data-tabs-hash-value is
// false (for tabs inside tabs). Arrow keys, Home and End move between tabs.
export default class extends Controller {
  static targets = ['tab', 'panel']
  static values = { hash: { type: Boolean, default: true } }

  connect() {
    const fromHash = this.hashValue ? this.panelTargets.findIndex((panel) => `#${panel.id}` === window.location.hash) : -1
    this.select(Math.max(fromHash, 0), false)
  }

  choose(event) {
    this.select(this.tabTargets.indexOf(event.currentTarget))
  }

  key(event) {
    const current = this.tabTargets.indexOf(event.currentTarget)
    const last = this.tabTargets.length - 1
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: last }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const index = (next + last + 1) % (last + 1)
    this.select(index)
    this.tabTargets[index].focus()
  }

  select(index, updateHash = true) {
    this.tabTargets.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index))
      tab.tabIndex = i === index ? 0 : -1
    })
    this.panelTargets.forEach((panel, i) => (panel.hidden = i !== index))
    if (updateHash && this.hashValue) history.replaceState(null, '', `#${this.panelTargets[index].id}`)
  }
}
