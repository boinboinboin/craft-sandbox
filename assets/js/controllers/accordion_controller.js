import { Controller } from '@hotwired/stimulus';

export default class extends Controller {
  static targets = [
    'icon',
    'contentContainer',
    'content'
  ]

  static values = {
    openRotateClass: Number
  }

  connect() {
    this.setContentContainerHeight()
    window.addEventListener('resize', (e) => {
      this.refresh()
    })
  }

  // Refreshes the accordion, triggered by events on dynamic pages to force accordion to refresh
  refresh() {
    this.setContentContainerHeight()
    this.setActualContainerHeight();
  }

  setContentContainerHeight() {
    this.contentContainerTarget.setAttribute('data-height',this.contentTarget.offsetHeight)
  }

  toggle(event) {
    event.preventDefault()
    if(this.contentContainerTarget.classList.contains('open')) {
      this.closeAccordion()
      event.currentTarget.setAttribute("aria-expanded", 'false');
    } else {
      this.openAccordion()
      event.currentTarget.setAttribute("aria-expanded", 'true');
    }
  }

  openAccordion() {
    this.contentContainerTarget.classList.add('open')
    this.setActualContainerHeight();
    this.iconRotate()
  }

  closeAccordion() {
    this.contentContainerTarget.classList.remove('open')
    this.contentContainerTarget.style.height = '0px'
    this.iconRotate()
  }

  setActualContainerHeight() {
    if(this.contentContainerTarget.classList.contains('open')) {
      this.contentContainerTarget.setAttribute('style','height:'+this.contentContainerTarget.dataset.height+'px')
    }
  }

  iconRotate() {
    if(this.iconTarget.classList.contains('rotate-180')) {
      this.iconTarget.classList.remove('rotate-180')
      this.iconTarget.classList.add('rotate-0')
    } else {
      this.iconTarget.classList.remove('rotate-0')
      this.iconTarget.classList.add('rotate-180')
    }
  }
}
