import { Controller } from '@hotwired/stimulus'
import { COLORS, DAY, MARGIN, PALETTE, createTooltip, dateFormat, drawGrid, drawYearAxis, el, formatNumber, placeTooltip, swatch, yDomain } from '../lib/chart.js'

// Line chart of a weekly rating history, drawn as SVG: a player's rating or a club's strength.
// `from` is the Monday of the first week; ratings[i] is the value at the end of week i, or null for
// a week without one (the line breaks there).
// `clubs` is [[week index, club], ...]: the line is coloured by the club played for at the time.
// `ranks` and `counts` (optional): rank that week out of `counts[i]`, shown in the tooltip as
// "#3 of 89 clubs" (`rankOf` names what is ranked). `label` names the value for screen readers.
// `decimals` and `signed` format the values, e.g. a combined score "+1.23".

// Clubs past the eighth share a neutral "other" colour.
const OTHER_CLUB_COLOR = '#8a8984'

export default class extends Controller {
  static values = {
    from: String,
    ratings: Array,
    clubs: Array,
    ranks: Array,
    counts: Array,
    rankOf: { type: String, default: 'clubs' },
    label: { type: String, default: 'Rating' },
    decimals: { type: Number, default: 0 },
    signed: Boolean,
  }

  connect() {
    const start = Date.parse(`${this.fromValue}T00:00:00Z`)
    // Club colours in fixed order, by first club played for
    const colors = new Map()
    for (const [, club] of this.clubsValue) {
      if (!colors.has(club)) colors.set(club, PALETTE[colors.size] ?? OTHER_CLUB_COLOR)
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
    this.tooltip = createTooltip(this.element)

    this.observer = new ResizeObserver(() => this.render())
    this.observer.observe(this.element)
  }

  disconnect() {
    this.observer?.disconnect()
    this.legend?.remove()
  }

  format(value) {
    return formatNumber(value, this.decimalsValue, this.signedValue)
  }

  render() {
    const width = this.element.clientWidth
    const height = this.element.clientHeight
    if (!width || !height) return
    this.svg?.remove()

    const points = this.points
    const ratings = points.map((p) => p.rating).filter((r) => r !== null)
    const domain = yDomain(Math.min(...ratings), Math.max(...ratings))
    const t0 = points[0].time
    const t1 = points.at(-1).time
    const plot = { left: MARGIN.left, right: width - MARGIN.right, top: MARGIN.top, bottom: height - MARGIN.bottom }
    this.x = (t) => plot.left + ((t - t0) / (t1 - t0)) * (plot.right - plot.left)
    this.y = (r) => plot.bottom - ((r - domain.yMin) / (domain.yMax - domain.yMin)) * (plot.bottom - plot.top)
    this.plot = plot

    const last = points.findLast((p) => p.rating !== null)
    const first = points.find((p) => p.rating !== null)
    const svg = el('svg', {
      width,
      height,
      role: 'img',
      tabindex: 0,
      class: 'block outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
      'aria-label': `${this.labelValue} history from ${dateFormat.format(t0)} to ${dateFormat.format(t1)}, from ${this.format(first.rating)} to ${this.format(last.rating)}. Use the arrow keys to read values.`,
    })
    drawGrid(svg, plot, this.y, domain, this.signedValue)
    drawYearAxis(svg, plot, this.x, t0, t1)

    // The line, one segment per club period. Each segment starts at the last point of the previous
    // one so the line stays connected; weeks without a value break it.
    const segments = []
    let previous = null
    for (const p of points) {
      if (p.rating === null) {
        previous = null
        continue
      }
      if (!previous || p.club !== previous.club) segments.push({ color: p.color, points: previous ? [previous] : [] })
      segments.at(-1).points.push(p)
      previous = p
    }
    for (const segment of segments) {
      const d = segment.points.map((p, i) => `${i ? 'L' : 'M'}${this.x(p.time).toFixed(1)},${this.y(p.rating).toFixed(1)}`).join('')
      svg.append(el('path', { d, fill: 'none', stroke: segment.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }))
    }

    // End marker with the current value as a direct label
    svg.append(el('circle', { cx: this.x(last.time), cy: this.y(last.rating), r: 4, fill: last.color, stroke: COLORS.surface, 'stroke-width': 2 }))
    const endLabel = el('text', { x: this.x(last.time) + 8, y: this.y(last.rating), 'dominant-baseline': 'middle', fill: COLORS.text, 'font-size': 12, 'font-weight': 600, style: 'font-variant-numeric: tabular-nums' })
    endLabel.textContent = this.format(last.rating)
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
    const i = Math.min(this.points.length - 1, Math.max(0, Math.round((t - this.points[0].time) / (7 * DAY))))
    // Snap to the closest week with a value
    for (let d = 0; d < this.points.length; d++) {
      if (this.points[i - d]?.rating != null) return i - d
      if (this.points[i + d]?.rating != null) return i + d
    }
    return i
  }

  key(event) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, PageDown: -52, PageUp: 52, Home: -Infinity, End: Infinity }
    if (!(event.key in moves)) return
    event.preventDefault()
    const current = this.active ?? this.points.length - 1
    let i = Math.min(this.points.length - 1, Math.max(0, current + moves[event.key]))
    // Skip weeks without a value, in the direction of the move
    const direction = moves[event.key] > 0 ? 1 : -1
    while (this.points[i]?.rating == null && i > 0 && i < this.points.length - 1) i += direction
    if (this.points[i]?.rating != null) this.show(i)
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
    value.textContent = this.format(p.rating)
    const date = document.createElement('span')
    date.className = 'text-gray-600'
    date.textContent = `Week ending ${dateFormat.format(p.time)}`
    const lines = [value, date]
    const rank = this.ranksValue[i]
    if (rank) {
      const standing = document.createElement('span')
      standing.className = 'block text-gray-600'
      standing.textContent = `#${rank} of ${this.countsValue[i] ?? '?'} ${this.rankOfValue}`
      lines.splice(1, 0, standing)
    }
    if (p.club) {
      const club = document.createElement('span')
      club.className = 'flex items-center gap-1.5 text-gray-600'
      club.append(swatch(p.color), p.club)
      lines.splice(1, 0, club)
    }
    this.tooltip.replaceChildren(...lines)
    this.tooltip.hidden = false
    placeTooltip(this.tooltip, this.element, x, y)
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
      item.append(swatch(color), club)
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
