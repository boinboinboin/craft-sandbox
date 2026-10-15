// Shared pieces of the Elo charts (rating_chart and discipline_chart controllers).

export const DAY = 86_400_000
const SVG_NS = 'http://www.w3.org/2000/svg'

// Categorical palette in fixed order (validated: CVD and normal-vision separation pass on white;
// slots 3-5 are below 3:1 contrast, so charts using them carry a legend, tooltip and table).
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
export const COLORS = { series: PALETTE[0], grid: '#e7e5e4', axis: '#6b7280', text: '#111827', crosshair: '#9ca3af', surface: '#ffffff' }
export const MARGIN = { top: 12, right: 52, bottom: 28, left: 48 }
export const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  return node
}

// Smallest round step that gives at most `max` intervals.
export function niceStep(range, max = 5) {
  for (const step of [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 200, 250, 500, 1000]) if (range / step <= max) return step
  return 1000
}

// "2,569", "1.23", or with `signed` "+1.23" / "−0.40"
export function formatNumber(value, decimals = 0, signed = false) {
  const text = Math.abs(value).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  if (value < 0) return `−${text}`
  return signed && value > 0 ? `+${text}` : text
}

// y scale with round gridlines covering [min, max]
export function yDomain(min, max) {
  const step = niceStep(Math.max(max - min, 0.1))
  const yMin = Math.floor(min / step) * step
  const yMax = Math.max(Math.ceil(max / step) * step, yMin + step)
  return { yMin, yMax, step }
}

// Horizontal gridlines with labels on the left
export function drawGrid(svg, plot, y, { yMin, yMax, step }, signed = false) {
  const decimals = step < 1 ? (Number.isInteger(step * 10) ? 1 : 2) : 0
  for (let k = 0; yMin + k * step <= yMax + step / 1000; k++) {
    const value = yMin + k * step
    svg.append(el('line', { x1: plot.left, x2: plot.right, y1: y(value), y2: y(value), stroke: COLORS.grid, 'stroke-width': 1 }))
    const label = el('text', { x: plot.left - 8, y: y(value), 'text-anchor': 'end', 'dominant-baseline': 'middle', fill: COLORS.axis, 'font-size': 12, style: 'font-variant-numeric: tabular-nums' })
    label.textContent = formatNumber(value, decimals, signed)
    svg.append(label)
  }
}

// One label per year along the bottom, thinned so labels don't collide
export function drawYearAxis(svg, plot, x, t0, t1) {
  const firstYear = new Date(t0).getUTCFullYear() + 1
  const lastYear = new Date(t1).getUTCFullYear()
  const yearStep = Math.max(1, Math.ceil((lastYear - firstYear + 1) / Math.max(1, Math.floor((plot.right - plot.left) / 56))))
  for (let year = firstYear; year <= lastYear; year += yearStep) {
    const px = x(Date.UTC(year, 0, 1))
    svg.append(el('line', { x1: px, x2: px, y1: plot.bottom, y2: plot.bottom + 4, stroke: COLORS.axis, 'stroke-width': 1 }))
    const label = el('text', { x: px, y: plot.bottom + 18, 'text-anchor': 'middle', fill: COLORS.axis, 'font-size': 12 })
    label.textContent = year
    svg.append(label)
  }
}

// Short line key in a series colour, for legends and tooltips (text stays in text colours)
export function swatch(color) {
  const key = document.createElement('span')
  key.className = 'inline-block w-3 h-1 rounded-full shrink-0'
  key.style.background = color
  return key
}

// Positions a tooltip next to the crosshair at x, flipping left near the right edge
export function placeTooltip(tooltip, container, x, y) {
  const width = tooltip.offsetWidth
  const left = x + 12 + width > container.clientWidth ? x - 12 - width : x + 12
  tooltip.style.left = `${Math.max(0, left)}px`
  tooltip.style.top = `${Math.max(0, Math.min(y - 24, container.clientHeight - tooltip.offsetHeight))}px`
}

export function createTooltip(container) {
  const tooltip = document.createElement('div')
  tooltip.className = 'absolute z-10 pointer-events-none bg-white border border-gray-200 shadow-sm px-3 py-2 text-sm whitespace-nowrap'
  tooltip.hidden = true
  container.append(tooltip)
  return tooltip
}
