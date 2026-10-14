import { Controller } from '@hotwired/stimulus'

// Line chart of a player's weekly rating history, drawn as SVG.
// `from` is the Monday of the first week; ratings[i] is the rating at the end of week i.
// `clubs` is [[week index, club], ...]: the line is coloured by the club played for at the time.
const DAY = 86_400_000
const SVG_NS = 'http://www.w3.org/2000/svg'
// Club colours: categorical palette in fixed order, by first club played for. Clubs past the
// eighth share a neutral "other" colour.
const CLUB_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const OTHER_CLUB_COLOR = '#8a8984'
const COLORS = { series: CLUB_COLORS[0], grid: '#e7e5e4', axis: '#6b7280', text: '#111827', crosshair: '#9ca3af', surface: '#ffffff' }
const MARGIN = { top: 12, right: 52, bottom: 28, left: 48 }
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  return node
}

// Smallest round step that gives at most `max` intervals.
function niceStep(range, max = 5) {
  for (const step of [10, 25, 50, 100, 200, 250, 500, 1000]) if (range / step <= max) return step
  return 1000
}

export default class extends Controller {
  static values = { from: String, ratings: Array, clubs: Array }

  connect() {
    const start = Date.parse(`${this.fromValue}T00:00:00Z`)
    const colors = new Map()
    for (const [, club] of this.clubsValue) {
      if (!colors.has(club)) colors.set(club, CLUB_COLORS[colors.size] ?? OTHER_CLUB_COLOR)
    }
    this.clubColors = colors
    let period = -1
    this.points = this.ratingsValue.map((rating, i) => {
      while (this.clubsValue[period + 1]?.[0] <= i) period++
      const club = this.clubsValue[Math.max(period, 0)]?.[1] ?? null
      return { time: start + (i * 7 + 6) * DAY, rating, club, color: colors.get(club) ?? COLORS.series }
    })
    this.renderLegend()
    this.active = null

    this.tooltip = document.createElement('div')
    this.tooltip.className = 'absolute pointer-events-none bg-white border border-gray-200 shadow-sm px-3 py-2 text-sm whitespace-nowrap'
    this.tooltip.hidden = true
    this.element.append(this.tooltip)

    this.observer = new ResizeObserver(() => this.render())
    this.observer.observe(this.element)
  }

  disconnect() {
    this.observer?.disconnect()
    this.legend?.remove()
  }

  render() {
    const width = this.element.clientWidth
    const height = this.element.clientHeight
    if (!width || !height) return
    this.svg?.remove()

    const points = this.points
    const ratings = points.map((p) => p.rating)
    const min = Math.min(...ratings)
    const max = Math.max(...ratings)
    const step = niceStep(Math.max(max - min, 1))
    const yMin = Math.floor(min / step) * step
    const yMax = Math.max(Math.ceil(max / step) * step, yMin + step)
    const t0 = points[0].time
    const t1 = points.at(-1).time
    const plot = { left: MARGIN.left, right: width - MARGIN.right, top: MARGIN.top, bottom: height - MARGIN.bottom }
    this.x = (t) => plot.left + ((t - t0) / (t1 - t0)) * (plot.right - plot.left)
    this.y = (r) => plot.bottom - ((r - yMin) / (yMax - yMin)) * (plot.bottom - plot.top)
    this.plot = plot

    const last = points.at(-1)
    const svg = el('svg', {
      width,
      height,
      role: 'img',
      tabindex: 0,
      class: 'block outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
      'aria-label': `Rating history from ${dateFormat.format(t0)} to ${dateFormat.format(t1)}, from ${points[0].rating} to ${last.rating}. Use the arrow keys to read values.`,
    })

    // Gridlines and y-axis labels
    for (let r = yMin; r <= yMax; r += step) {
      svg.append(el('line', { x1: plot.left, x2: plot.right, y1: this.y(r), y2: this.y(r), stroke: COLORS.grid, 'stroke-width': 1 }))
      const label = el('text', { x: plot.left - 8, y: this.y(r), 'text-anchor': 'end', 'dominant-baseline': 'middle', fill: COLORS.axis, 'font-size': 12, style: 'font-variant-numeric: tabular-nums' })
      label.textContent = r.toLocaleString('en-GB')
      svg.append(label)
    }

    // x-axis: one label per year, thinned so labels don't collide
    const firstYear = new Date(t0).getUTCFullYear() + 1
    const lastYear = new Date(t1).getUTCFullYear()
    const yearStep = Math.max(1, Math.ceil((lastYear - firstYear + 1) / Math.max(1, Math.floor((plot.right - plot.left) / 56))))
    for (let year = firstYear; year <= lastYear; year += yearStep) {
      const x = this.x(Date.UTC(year, 0, 1))
      svg.append(el('line', { x1: x, x2: x, y1: plot.bottom, y2: plot.bottom + 4, stroke: COLORS.axis, 'stroke-width': 1 }))
      const label = el('text', { x, y: plot.bottom + 18, 'text-anchor': 'middle', fill: COLORS.axis, 'font-size': 12 })
      label.textContent = year
      svg.append(label)
    }

    // The line, one segment per club period. Each segment starts at the last point of the previous
    // one so the line stays connected.
    const segments = []
    points.forEach((p, i) => {
      if (!i || p.club !== points[i - 1].club) segments.push({ color: p.color, points: i ? [points[i - 1]] : [] })
      segments.at(-1).points.push(p)
    })
    for (const segment of segments) {
      const d = segment.points.map((p, i) => `${i ? 'L' : 'M'}${this.x(p.time).toFixed(1)},${this.y(p.rating).toFixed(1)}`).join('')
      svg.append(el('path', { d, fill: 'none', stroke: segment.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }))
    }

    // End marker with the current value as a direct label
    svg.append(el('circle', { cx: this.x(last.time), cy: this.y(last.rating), r: 4, fill: last.color, stroke: COLORS.surface, 'stroke-width': 2 }))
    const endLabel = el('text', { x: this.x(last.time) + 8, y: this.y(last.rating), 'dominant-baseline': 'middle', fill: COLORS.text, 'font-size': 12, 'font-weight': 600, style: 'font-variant-numeric: tabular-nums' })
    endLabel.textContent = last.rating.toLocaleString('en-GB')
    svg.append(endLabel)

    // Hover layer: crosshair, marker and tooltip at the nearest week
    this.crosshair = el('line', { y1: plot.top, y2: plot.bottom, stroke: COLORS.crosshair, 'stroke-width': 1, visibility: 'hidden' })
    this.marker = el('circle', { r: 4, fill: COLORS.series, stroke: COLORS.surface, 'stroke-width': 2, visibility: 'hidden' })
    const hit = el('rect', { x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top, fill: 'transparent' })
    svg.append(this.crosshair, this.marker, hit)

    hit.addEventListener('pointermove', (event) => this.show(this.nearest(event.offsetX)))
    hit.addEventListener('pointerleave', () => this.hide())
    svg.addEventListener('keydown', (event) => this.key(event))
    svg.addEventListener('blur', () => this.hide())

    this.svg = svg
    this.element.prepend(svg)
    if (this.active !== null) this.show(this.active)
  }

  nearest(px) {
    const t = this.points[0].time + ((px - this.plot.left) / (this.plot.right - this.plot.left)) * (this.points.at(-1).time - this.points[0].time)
    const i = Math.round((t - this.points[0].time) / (7 * DAY))
    return Math.min(this.points.length - 1, Math.max(0, i))
  }

  key(event) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, PageDown: -52, PageUp: 52, Home: -Infinity, End: Infinity }
    if (!(event.key in moves)) return
    event.preventDefault()
    const current = this.active ?? this.points.length - 1
    this.show(Math.min(this.points.length - 1, Math.max(0, current + moves[event.key])))
  }

  show(i) {
    this.active = i
    const p = this.points[i]
    const x = this.x(p.time)
    const y = this.y(p.rating)
    this.crosshair.setAttribute('x1', x)
    this.crosshair.setAttribute('x2', x)
    this.crosshair.setAttribute('visibility', 'visible')
    this.marker.setAttribute('fill', p.color)
    this.marker.setAttribute('cx', x)
    this.marker.setAttribute('cy', y)
    this.marker.setAttribute('visibility', 'visible')

    const value = document.createElement('strong')
    value.className = 'block text-base tabular-nums'
    value.textContent = p.rating.toLocaleString('en-GB')
    const date = document.createElement('span')
    date.className = 'text-gray-600'
    date.textContent = `Week ending ${dateFormat.format(p.time)}`
    const lines = [value, date]
    if (p.club) {
      const club = document.createElement('span')
      club.className = 'flex items-center gap-1.5 text-gray-600'
      club.append(this.swatch(p.color), p.club)
      lines.splice(1, 0, club)
    }
    this.tooltip.replaceChildren(...lines)
    this.tooltip.hidden = false

    // Keep the tooltip inside the chart: flip to the left of the crosshair near the right edge
    const width = this.tooltip.offsetWidth
    const left = x + 12 + width > this.element.clientWidth ? x - 12 - width : x + 12
    this.tooltip.style.left = `${Math.max(0, left)}px`
    this.tooltip.style.top = `${Math.max(0, Math.min(y - 24, this.element.clientHeight - this.tooltip.offsetHeight))}px`
  }

  swatch(color) {
    const swatch = document.createElement('span')
    swatch.className = 'inline-block w-3 h-1 rounded-full'
    swatch.style.background = color
    return swatch
  }

  // Legend of the clubs below the chart, in the order the player played for them. A single club
  // has no legend; the page names the club.
  renderLegend() {
    if (this.clubColors.size < 2) return
    const legend = document.createElement('ul')
    legend.className = 'flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-gray-700'
    legend.setAttribute('aria-label', 'Clubs')
    for (const [club, color] of this.clubColors) {
      const item = document.createElement('li')
      item.className = 'flex items-center gap-1.5'
      item.append(this.swatch(color), club)
      legend.append(item)
    }
    this.element.after(legend)
    this.legend = legend
  }

  hide() {
    this.active = null
    this.crosshair?.setAttribute('visibility', 'hidden')
    this.marker?.setAttribute('visibility', 'hidden')
    this.tooltip.hidden = true
  }
}
