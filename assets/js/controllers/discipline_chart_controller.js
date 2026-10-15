import { Controller } from '@hotwired/stimulus'
import { COLORS, DAY, MARGIN, PALETTE, createTooltip, dateFormat, drawGrid, drawYearAxis, el, formatNumber, placeTooltip, swatch, yDomain } from '../lib/chart.js'

// Several weekly series on one chart, e.g. a club's strength in every discipline.
// `series` is [{ label, from, values, ranks?, counts? }, ...] in a fixed order (it decides the
// colours); `from` is the Monday of the series' first week and values[i] the value at the end of
// week i (null breaks the line). Ranks show in the tooltip as "#3 of 89".
const WEEK = 7 * DAY

export default class extends Controller {
  static values = { series: Array, label: { type: String, default: 'Strength' } }

  connect() {
    const starts = this.seriesValue.map((s) => Date.parse(`${s.from}T00:00:00Z`))
    this.start = Math.min(...starts)
    this.series = this.seriesValue.map((s, i) => ({
      ...s,
      color: PALETTE[i],
      offset: Math.round((starts[i] - this.start) / WEEK),
    }))
    this.weeks = Math.max(...this.series.map((s) => s.offset + s.values.length))
    this.active = null
    this.renderLegend()
    this.tooltip = createTooltip(this.element)

    this.observer = new ResizeObserver(() => this.render())
    this.observer.observe(this.element)
  }

  disconnect() {
    this.observer?.disconnect()
    this.legend?.remove()
  }

  time(week) {
    return this.start + (week * 7 + 6) * DAY
  }

  value(series, week) {
    return series.values[week - series.offset] ?? null
  }

  render() {
    const width = this.element.clientWidth
    const height = this.element.clientHeight
    if (!width || !height) return
    this.svg?.remove()

    const values = this.series.flatMap((s) => s.values).filter((v) => v !== null)
    const domain = yDomain(Math.min(...values), Math.max(...values))
    const t0 = this.time(0)
    const t1 = this.time(this.weeks - 1)
    const plot = { left: MARGIN.left, right: width - MARGIN.right, top: MARGIN.top, bottom: height - MARGIN.bottom }
    this.x = (t) => plot.left + ((t - t0) / (t1 - t0)) * (plot.right - plot.left)
    this.y = (v) => plot.bottom - ((v - domain.yMin) / (domain.yMax - domain.yMin)) * (plot.bottom - plot.top)
    this.plot = plot

    const svg = el('svg', {
      width,
      height,
      role: 'img',
      tabindex: 0,
      class: 'block outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
      'aria-label': `${this.labelValue} history in ${this.series.map((s) => s.label).join(', ')}, from ${dateFormat.format(t0)} to ${dateFormat.format(t1)}. Use the arrow keys to read values.`,
    })
    drawGrid(svg, plot, this.y, domain)
    drawYearAxis(svg, plot, this.x, t0, t1)

    // One line per series, broken where it has no value; an end marker on each
    for (const s of this.series) {
      let d = ''
      let drawing = false
      s.values.forEach((v, i) => {
        if (v === null) return (drawing = false)
        d += `${drawing ? 'L' : 'M'}${this.x(this.time(s.offset + i)).toFixed(1)},${this.y(v).toFixed(1)}`
        drawing = true
      })
      svg.append(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }))
      const last = s.values.findLastIndex((v) => v !== null)
      if (last >= 0) {
        svg.append(el('circle', { cx: this.x(this.time(s.offset + last)), cy: this.y(s.values[last]), r: 4, fill: s.color, stroke: COLORS.surface, 'stroke-width': 2 }))
      }
    }

    // Hover layer: crosshair with a marker per series and one tooltip listing every series
    this.crosshair = el('line', { y1: plot.top, y2: plot.bottom, stroke: COLORS.crosshair, 'stroke-width': 1, visibility: 'hidden' })
    svg.append(this.crosshair)
    this.markers = this.series.map((s) => {
      const marker = el('circle', { r: 4, fill: s.color, stroke: COLORS.surface, 'stroke-width': 2, visibility: 'hidden' })
      svg.append(marker)
      return marker
    })
    const hit = el('rect', { x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top, fill: 'transparent' })
    svg.append(hit)

    hit.addEventListener('pointermove', (event) => this.show(this.nearest(event.offsetX)))
    hit.addEventListener('pointerleave', () => this.hide())
    svg.addEventListener('keydown', (event) => this.key(event))
    svg.addEventListener('blur', () => this.hide())

    this.svg = svg
    this.element.prepend(svg)
    if (this.active !== null) this.show(this.active)
  }

  nearest(px) {
    const week = Math.round(((px - this.plot.left) / (this.plot.right - this.plot.left)) * (this.weeks - 1))
    return Math.min(this.weeks - 1, Math.max(0, week))
  }

  key(event) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, PageDown: -52, PageUp: 52, Home: -Infinity, End: Infinity }
    if (!(event.key in moves)) return
    event.preventDefault()
    const current = this.active ?? this.weeks - 1
    this.show(Math.min(this.weeks - 1, Math.max(0, current + moves[event.key])))
  }

  show(week) {
    this.active = week
    const x = this.x(this.time(week))
    this.crosshair.setAttribute('x1', x)
    this.crosshair.setAttribute('x2', x)
    this.crosshair.setAttribute('visibility', 'visible')

    const date = document.createElement('span')
    date.className = 'block text-gray-600 mb-1'
    date.textContent = `Week ending ${dateFormat.format(this.time(week))}`
    const rows = [date]
    let top = this.plot.bottom
    this.series.forEach((s, i) => {
      const v = this.value(s, week)
      const marker = this.markers[i]
      if (v === null) return marker.setAttribute('visibility', 'hidden')
      marker.setAttribute('cx', x)
      marker.setAttribute('cy', this.y(v))
      marker.setAttribute('visibility', 'visible')
      top = Math.min(top, this.y(v))

      // Value leads, label follows; the colour sits on the line key only
      const row = document.createElement('span')
      row.className = 'flex items-center gap-1.5'
      const value = document.createElement('strong')
      value.className = 'tabular-nums'
      value.textContent = formatNumber(v)
      const label = document.createElement('span')
      label.className = 'text-gray-600'
      const rank = s.ranks?.[week - s.offset]
      label.textContent = rank ? `${s.label} · #${rank} of ${s.counts?.[week - s.offset] ?? '?'}` : s.label
      row.append(swatch(s.color), value, label)
      rows.push(row)
    })
    this.tooltip.replaceChildren(...rows)
    this.tooltip.hidden = false
    placeTooltip(this.tooltip, this.element, x, top)
  }

  // Legend above the chart, in the series order (always shown: there are several series)
  renderLegend() {
    const legend = document.createElement('ul')
    legend.className = 'flex flex-wrap gap-x-5 gap-y-1 mb-3 text-sm text-gray-700'
    legend.setAttribute('aria-label', 'Disciplines')
    for (const s of this.series) {
      const item = document.createElement('li')
      item.className = 'flex items-center gap-1.5'
      item.append(swatch(s.color), s.label)
      legend.append(item)
    }
    this.element.before(legend)
    this.legend = legend
  }

  hide() {
    this.active = null
    this.crosshair?.setAttribute('visibility', 'hidden')
    for (const marker of this.markers ?? []) marker.setAttribute('visibility', 'hidden')
    this.tooltip.hidden = true
  }
}
