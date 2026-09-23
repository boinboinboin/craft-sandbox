import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static targets = ['input', 'results', 'status']

  search(event) {
    event.preventDefault()
    const q = this.inputTarget.value.trim()
    if (!q) return

    this.statusTarget.textContent = 'Searching…'
    this.resultsTarget.innerHTML = ''

    fetch(`/actions/discogs/discogs/search?q=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/json' }
    })
      .then((r) => r.json())
      .then((data) => {
        this.statusTarget.textContent = ''
        this.renderResults(data.results || [])
      })
      .catch(() => {
        this.statusTarget.textContent = 'Search failed, try again.'
      })
  }

  renderResults(results) {
    if (results.length === 0) {
      this.resultsTarget.innerHTML = '<p class="base">No results found.</p>'
      return
    }

    this.resultsTarget.innerHTML = ''

    results.forEach((result) => {
      const row = document.createElement('div')
      row.className = 'flex items-center gap-4 py-4 border-b border-gray-200'
      row.innerHTML = `
        ${result.thumb ? `<img src="${result.thumb}" alt="" class="w-16 h-16 object-cover">` : ''}
        <div class="flex-1">
          <p class="font-semibold">${result.title}</p>
          ${result.year ? `<p class="text-gray-700">${result.year}</p>` : ''}
        </div>
        <button type="button" class="btn" data-action="click->discogs-search#add" data-discogs-id="${result.id}" data-status="wanted">Add to Wishlist</button>
        <button type="button" class="btn" data-action="click->discogs-search#add" data-discogs-id="${result.id}" data-status="owned">Add to Collection</button>
      `
      this.resultsTarget.appendChild(row)
    })
  }

  add(event) {
    const { discogsId, status } = event.currentTarget.dataset
    const csrfToken = document.querySelector('meta[name="csrf-token"]').content

    this.statusTarget.textContent = 'Adding…'

    fetch('/actions/discogs/discogs/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ discogsId, status })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          this.statusTarget.textContent = `Error: ${data.error}`
          return
        }
        window.location.reload()
      })
      .catch(() => {
        this.statusTarget.textContent = 'Add failed, try again.'
      })
  }
}
