/*
 * Rasterise public/hupomnemata-mark-mono.svg into the menu bar template icon
 * (chunk 91, D8). No image tool is assumed: the mark is two round-capped
 * strokes and a dot, so it is drawn here by distance and written as a PNG with
 * node:zlib. macOS uses only the alpha channel of a template image.
 *
 *   node menubar/src-tauri/icons/make-tray-icon.mjs
 *
 * Geometry is the SVG's (viewBox 0 0 100 100, stroke-width 11). If the mark
 * changes, change the numbers below to match.
 *
 * Chunk 94 adds two more template icons, drawn the same way from the design
 * prototype's "Menu bar states" strip (viewBox 0 0 14 14): the break cup
 * (`tray-break.png`) and the paused bars (`tray-paused.png`). The focus ring
 * is not here — the shell draws it per step (`ring_rgba` in `pomodoro.rs`).
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 44 // 22pt @2x; the tray scales it to the bar's 18pt height
const SS = 6 // supersampling per axis
const STROKE_R = 5.5
// The mark spans x 18.5–81.6, y 15.5–84.5; show 9–91 so it fills the height.
const VIEW = { x: 9, y: 9, size: 82 }

function quad(p0, p1, p2, n = 24) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    pts.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ])
  }
  return pts
}

const polylines = [
  [[24, 21], [24, 79]],
  [
    ...quad([24, 53], [24, 36.5], [42, 36.5]),
    ...quad([42, 36.5], [60, 36.5], [60, 53]),
    [60, 79],
  ],
]
const dot = { x: 76, y: 74.5, r: 5.6 }

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function onStroke(x, y, lines, r) {
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      if (distToSegment(x, y, line[i], line[i + 1]) <= r) return true
    }
  }
  return false
}

function insideMark(x, y) {
  if (Math.hypot(x - dot.x, y - dot.y) <= dot.r) return true
  return onStroke(x, y, polylines, STROKE_R)
}

function arc(cx, cy, r, from, to, n = 24) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

// Break: a cup. The prototype's paths, stroke-width 1.6, round caps:
//   M2.5 5.5h7v3a3.5 3.5 0 0 1-7 0z   M9.5 6.5h1a1.5 1.5 0 0 1 0 3h-1
//   M5 1.5v2   M7.5 1.5v2
const cup = [
  [[2.5, 8.5], [2.5, 5.5], [9.5, 5.5], [9.5, 8.5], ...arc(6, 8.5, 3.5, 0, Math.PI)],
  [[9.5, 6.5], [10.5, 6.5], ...arc(10.5, 8, 1.5, -Math.PI / 2, Math.PI / 2), [9.5, 9.5]],
  [[5, 1.5], [5, 3.5]],
  [[7.5, 1.5], [7.5, 3.5]],
]
const insideCup = (x, y) => onStroke(x, y, cup, 0.8)

// Paused: two bars — rects 2.4 × 8 at x 3.5 and 8.1, y 3, corner radius 0.8.
const bars = [3.5, 8.1].map((x) => ({ x, y: 3, w: 2.4, h: 8, r: 0.8 }))
const insideBars = (x, y) =>
  bars.some((b) => {
    const dx = Math.max(b.x + b.r - x, 0, x - (b.x + b.w - b.r))
    const dy = Math.max(b.y + b.r - y, 0, y - (b.y + b.h - b.r))
    return Math.hypot(dx, dy) <= b.r
  })

const STATES_VIEW = { x: 0, y: 0, size: 14 }

function rasterise(view, inside) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4)
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = view.x + ((px + (sx + 0.5) / SS) / SIZE) * view.size
          const y = view.y + ((py + (sy + 0.5) / SS) / SIZE) * view.size
          if (inside(x, y)) hits++
        }
      }
      rgba[(py * SIZE + px) * 4 + 3] = Math.round((255 * hits) / (SS * SS))
    }
  }
  return rgba
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

function writePng(name, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const out = fileURLToPath(new URL(`./${name}`, import.meta.url))
  writeFileSync(out, png)
  console.log(`wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`)
}

writePng('tray.png', rasterise(VIEW, insideMark))
writePng('tray-break.png', rasterise(STATES_VIEW, insideCup))
writePng('tray-paused.png', rasterise(STATES_VIEW, insideBars))
