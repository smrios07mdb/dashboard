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

function inside(x, y) {
  if (Math.hypot(x - dot.x, y - dot.y) <= dot.r) return true
  for (const line of polylines) {
    for (let i = 0; i + 1 < line.length; i++) {
      if (distToSegment(x, y, line[i], line[i + 1]) <= STROKE_R) return true
    }
  }
  return false
}

const rgba = Buffer.alloc(SIZE * SIZE * 4)
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let hits = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = VIEW.x + ((px + (sx + 0.5) / SS) / SIZE) * VIEW.size
        const y = VIEW.y + ((py + (sy + 0.5) / SS) / SIZE) * VIEW.size
        if (inside(x, y)) hits++
      }
    }
    rgba[(py * SIZE + px) * 4 + 3] = Math.round((255 * hits) / (SS * SS))
  }
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
const out = fileURLToPath(new URL('./tray.png', import.meta.url))
writeFileSync(out, png)
console.log(`wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`)
