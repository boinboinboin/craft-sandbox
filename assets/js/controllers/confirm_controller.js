import { Controller } from '@hotwired/stimulus'

// Asks for confirmation before a form is submitted: data-action="submit->confirm#confirm"
export default class extends Controller {
  static values = { message: String }

  confirm(event) {
    if (!confirm(this.messageValue || 'Are you sure?')) event.preventDefault()
  }
}
