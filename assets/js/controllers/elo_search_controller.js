import { Controller } from '@hotwired/stimulus'

// The search bar on every Elo page (an ARIA combobox): typing searches `url` (?q=<text>, which
// returns { players, clubs, tournaments, eliteserien }, each [{ name, detail?, club?, url, logo? }]) and lists
// the results in groups. Choosing one (click, or arrow keys and Enter) opens its page; Enter
// without moving opens the first result. Escape closes the list.
const GROUPS = { players: 'Players', clubs: 'Clubs', tournaments: 'Tournaments', eliteserien: 'Eliteserien' }

export default class extends Controller {
  static targets = ['input', 'list']
  static values = { url: String }

  connect() {
    this.results = []
    this.active = -1
    this.request = 0
  }

  search() {
    clearTimeout(this.timer)
    const query = this.inputTarget.value.trim()
    if (query.length < 2) return this.close()
    this.timer = setTimeout(() => this.fetch(query), 150)
  }

  async fetch(query) {
    const request = ++this.request
    const response = await fetch(`${this.urlValue}?q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } })
    if (!response.ok || request !== this.request) return
    const found = await response.json()
    this.groups = Object.entries(GROUPS).map(([key, label]) => ({ label, items: found[key] ?? [] })).filter((g) => g.items.length)
    this.results = this.groups.flatMap((g) => g.items)
    this.active = this.results.length ? 0 : -1
    this.render()
  }

  render() {
    const list = this.listTarget
    list.replaceChildren()
    let index = 0
    for (const group of this.groups) {
      const heading = document.createElement('li')
      heading.setAttribute('role', 'presentation')
      heading.className = 'px-3 pt-3 pb-1 text-xs uppercase tracking-wide text-gray-500'
      heading.textContent = group.label
      list.append(heading)
      for (const item of group.items) {
        const i = index++
        const option = document.createElement('li')
        option.id = `${list.id}-${i}`
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', i === this.active ? 'true' : 'false')
        option.className = 'flex items-center gap-2 px-3 py-2 cursor-pointer aria-selected:bg-gray-100'
        if (item.logo) {
          const logo = document.createElement('img')
          logo.src = item.logo
          logo.alt = ''
          logo.className = 'w-5 h-5 object-contain shrink-0'
          option.append(logo)
        }
        const text = document.createElement('span')
        const detail = document.createElement('span')
        detail.className = 'block text-sm text-gray-600'
        detail.textContent = item.detail ?? item.club ?? ''
        text.append(item.name, detail)
        option.append(text)
        // mousedown, not click: it comes before the input's blur closes the list
        option.addEventListener('mousedown', (event) => {
          event.preventDefault()
          this.go(i)
        })
        list.append(option)
      }
    }
    if (!this.results.length) {
      const empty = document.createElement('li')
      empty.className = 'px-3 py-2 text-gray-600'
      empty.textContent = 'Nothing found'
      list.append(empty)
    }
    list.hidden = false
    this.inputTarget.setAttribute('aria-expanded', 'true')
    this.inputTarget.setAttribute('aria-activedescendant', this.active >= 0 ? `${list.id}-${this.active}` : '')
  }

  key(event) {
    if (event.key === 'Escape') return this.close()
    if (this.listTarget.hidden || !this.results.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      this.active = (this.active + step + this.results.length) % this.results.length
      this.render()
    }
  }

  // The form's submit (Enter): open the highlighted result
  submit(event) {
    event.preventDefault()
    if (this.active >= 0) this.go(this.active)
  }

  go(i) {
    window.location.assign(this.results[i].url)
  }

  close() {
    this.listTarget.hidden = true
    this.inputTarget.setAttribute('aria-expanded', 'false')
    this.inputTarget.removeAttribute('aria-activedescendant')
  }
}
