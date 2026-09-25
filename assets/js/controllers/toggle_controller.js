import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static targets = ['content']

  toggle(event) {
    event.preventDefault()
    this.contentTarget.hidden = !this.contentTarget.hidden
  }
}
