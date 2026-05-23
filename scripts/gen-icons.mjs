#!/usr/bin/env node
/*
 * Pure-Node PNG generator for PWA icons. Zero deps.
 *
 * Outputs three icons to public/icons/ — the sizes the manifest references.
 * Design mirrors public/icons/icon.svg: dark Obsidian background with three
 * horizontal ice-colored bars forming a task-list mark.
 *
 * Run: `node scripts/gen-icons.mjs`
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'icons')

const BG = [0x0a, 0x0b, 0x0e] // --background obsidian
const FG = [0xc8, 0xd2, 0xe2] // --accent ice

const TARGETS = [
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
]

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    pixels[i * 3] = BG[0]
    pixels[i * 3 + 1] = BG[1]
    pixels[i * 3 + 2] = BG[2]
  }
  const barH = Math.floor(size * 0.08)
  const gap = Math.floor(size * 0.08)
  const barW = Math.floor(size * 0.5)
  const totalH = 3 * barH + 2 * gap
  const startY = Math.floor((size - totalH) / 2)
  const startX = Math.floor((size - barW) / 2)
  for (let bar = 0; bar < 3; bar++) {
    const y0 = startY + bar * (barH + gap)
    for (let dy = 0; dy < barH; dy++) {
      const y = y0 + dy
      for (let dx = 0; dx < barW; dx++) {
        const x = startX + dx
        const idx = (y * size + x) * 3
        pixels[idx] = FG[0]
        pixels[idx + 1] = FG[1]
        pixels[idx + 2] = FG[2]
      }
    }
  }
  return pixels
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([len, typeAndData, crcBuf])
}

function encodePNG(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor (RGB)
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter: standard
  ihdr[12] = 0 // interlace: none

  const stride = width * 3
  const raw = Buffer.alloc(height * (1 + stride))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0 // filter byte: none
    rgb.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride)
  }
  const compressed = deflateSync(raw, { level: 9 })

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })
for (const { size, name } of TARGETS) {
  const pixels = drawIcon(size)
  const png = encodePNG(size, size, pixels)
  const out = join(OUT_DIR, name)
  writeFileSync(out, png)
  console.log(`wrote ${out} (${size}x${size}, ${png.length} bytes)`)
}
