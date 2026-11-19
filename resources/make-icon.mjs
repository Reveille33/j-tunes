// Generates the application icon: a PNG and a Windows .ico.
// Run with: node resources/make-icon.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICNS_SIZES = [...SIZES, 512, 1024]

/** The j-Tunes mark: a rounded square with a music note. */
function pixel(x, y, size) {
  const u = x / size
  const v = y / size

  // Rounded-square background with a subtle vertical gradient.
  const r = 0.22
  const inX = Math.min(u, 1 - u)
  const inY = Math.min(v, 1 - v)
  const cx = Math.max(0, r - inX)
  const cy = Math.max(0, r - inY)
  if (cx * cx + cy * cy > r * r) return null

  const bg = [
    Math.round(28 + u * 18),
    Math.round(45 + v * 30),
    Math.round(110 + u * 60)
  ]

  // The note: a filled ellipse (the head) plus a stem and a flag.
  const headCx = 0.4
  const headCy = 0.72
  const headRx = 0.16
  const headRy = 0.12
  const dx = (u - headCx) / headRx
  const dy = (v - headCy) / headRy
  if (dx * dx + dy * dy <= 1) return [255, 255, 255]

  const stemX = 0.52
  const stemX2 = 0.58
  if (u >= stemX && u <= stemX2 && v >= 0.24 && v <= 0.76) {
    return [255, 255, 255]
  }

  // The flag sweeping right from the top of the stem.
  if (u >= stemX2 && u <= 0.78 && v >= 0.24 && v <= 0.42) {
    const t = (u - stemX2) / (0.78 - stemX2)
    if (v <= 0.42 - t * 0.16) return [255, 255, 255]
  }

  return bg
}

/** Encodes an RGBA pixel buffer as a PNG. */
function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const chunks = []
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  chunks.push(signature)

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  chunks.push(chunk('IHDR', ihdr))
  chunks.push(chunk('IDAT', deflateSync(raw, { level: 9 })))
  chunks.push(chunk('IEND', Buffer.alloc(0)))

  return Buffer.concat(chunks)
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

function renderRgba(size) {
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = pixel(x, y, size)
      const i = (y * size + x) * 4
      if (c) {
        buf[i] = c[0]
        buf[i + 1] = c[1]
        buf[i + 2] = c[2]
        buf[i + 3] = 255
      }
    }
  }
  return buf
}

/** Builds an .ico containing PNG-encoded images (supported on Windows Vista+). */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + images.length * 16

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // palette size
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

/**
 * Builds a macOS .icns container.
 *
 * Each entry is a four-character type, a big-endian length and the PNG data.
 * The types below map to the PNG-based icon slots macOS understands.
 */
function buildIcns(entries) {
  const chunks = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })

  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

mkdirSync(here, { recursive: true })

const rendered = new Map(ICNS_SIZES.map((size) => [size, encodePng(renderRgba(size), size)]))

writeFileSync(join(here, 'icon.png'), rendered.get(256))
writeFileSync(join(here, 'icon.ico'), buildIco(SIZES.map((size) => ({ size, png: rendered.get(size) }))))
writeFileSync(
  join(here, 'icon.icns'),
  buildIcns([
    { type: 'icp4', png: rendered.get(16) },
    { type: 'icp5', png: rendered.get(32) },
    { type: 'icp6', png: rendered.get(64) },
    { type: 'ic07', png: rendered.get(128) },
    { type: 'ic08', png: rendered.get(256) },
    { type: 'ic09', png: rendered.get(512) },
    { type: 'ic10', png: rendered.get(1024) }
  ])
)

console.log(`Wrote icon.png, icon.ico (${SIZES.join(', ')} px) and icon.icns (${ICNS_SIZES.join(', ')} px)`)

