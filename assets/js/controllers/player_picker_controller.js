import { Controller } from '@hotwired/stimulus'

// A player name field with suggestions (an ARIA combobox): typing searches `url` (?q=<text>, which
// returns [{ id, name, club }]) and choosing a suggestion puts its id in the hidden `id` field.
// Typing again clears the id until a player is chosen. Arrow keys move through the suggestions,
// Enter chooses, Escape closes.
export default class extends Controller {
  static targets = ['input', 'id', 'list']
  static values = { url: String }

  connect() {
    this.results = []
    this.active = -1
    this.request = 0
  }

  search() {
    this.idTarget.value = ''
    clearTimeout(this.timer)
    const query = this.inputTarget.value.trim()
    if (query.length < 2) return this.close()
    this.timer = setTimeout(() => this.fetch(query), 150)
  }

  async fetch(query) {
    const request = ++this.request
    const response = await fetch(`${this.urlValue}?q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } })
    if (!response.ok || request !== this.request) return
    this.results = await response.json()
    this.active = this.results.length ? 0 : -1
    this.render()
  }

  render() {
    const list = this.listTarget
    list.replaceChildren(
      ...this.results.map((player, i) => {
        const option = document.createElement('li')
        option.id = `${list.id}-${i}`
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', i === this.active ? 'true' : 'false')
        option.className = 'px-3 py-2 cursor-pointer aria-selected:bg-gray-100'
        const club = document.createElement('span')
        club.className = 'block text-sm text-gray-600'
        club.textContent = player.club ?? ''
        option.append(player.name, club)
        // mousedown, not click: it comes before the input's blur closes the list
        option.addEventListener('mousedown', (event) => {
          event.preventDefault()
          this.choose(i)
        })
        return option
      }),
    )
    if (!this.results.length) {
      const empty = document.createElement('li')
      empty.className = 'px-3 py-2 text-gray-600'
      empty.textContent = 'No players found'
      list.append(empty)
    }
    list.hidden = false
    this.inputTarget.setAttribute('aria-expanded', 'true')
    this.inputTarget.setAttribute('aria-activedescendant', this.active >= 0 ? `${list.id}-${this.active}` : '')
  }

  key(event) {
    if (this.listTarget.hidden) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!this.results.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      this.active = (this.active + step + this.results.length) % this.results.length
      this.render()
    } else if (event.key === 'Enter' && this.active >= 0) {
      event.preventDefault()
      this.choose(this.active)
    } else if (event.key === 'Escape') {
      this.close()
    }
  }

  choose(i) {
    const player = this.results[i]
    this.inputTarget.value = player.name
    this.idTarget.value = player.id
    this.close()
  }

  close() {
    this.listTarget.hidden = true
    this.inputTarget.setAttribute('aria-expanded', 'false')
    this.inputTarget.removeAttribute('aria-activedescendant')
  }
}
