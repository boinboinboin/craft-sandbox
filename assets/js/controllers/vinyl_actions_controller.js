import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static values = {
    entryId: Number,
    status: String
  }

  csrfToken() {
    return document.querySelector('meta[name="csrf-token"]').content
  }

  remove(event) {
    event.preventDefault()
    if (!confirm('Remove this vinyl?')) return

    fetch('/actions/discogs/vinyl/remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': this.csrfToken()
      },
      body: JSON.stringify({ entryId: this.entryIdValue })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) window.location.reload()
      })
  }

  move(event) {
    event.preventDefault()
    const newStatus = this.statusValue === 'owned' ? 'wanted' : 'owned'

    fetch('/actions/discogs/vinyl/move', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': this.csrfToken()
      },
      body: JSON.stringify({ entryId: this.entryIdValue, status: newStatus })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) window.location.reload()
      })
  }
}
