import { deflateSync } from 'node:zlib'

/**
 * A small locally generated cover. No fonts and no network: a solid field
 * with a simple geometric mark so each invented show is distinguishable.
 */
export function artworkDataUrl(red: number, green: number, blue: number, mark: 'ring' | 'bars' | 'diamond' | 'cross'): string {
  const size = 96
  const raw = Buffer.alloc((size * 4 + 1) * size)

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const on = markAt(x, y, size, mark)
      const offset = row + 1 + x * 4
      raw[offset] = on ? 255 : red
      raw[offset + 1] = on ? 255 : green
      raw[offset + 2] = on ? 255 : blue
      raw[offset + 3] = 255
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

function markAt(x: number, y: number, size: number, mark: 'ring' | 'bars' | 'diamond' | 'cross'): boolean {
  const cx = size / 2
  const cy = size / 2
  const dx = x - cx
  const dy = y - cy
  if (mark === 'ring') {
    const distance = Math.hypot(dx, dy)
    return distance > 22 && distance < 30
  }
  if (mark === 'bars') {
    return x > 28 && x < 40 || x > 56 && x < 68
  }
  if (mark === 'diamond') {
    return Math.abs(dx) + Math.abs(dy) < 26 && Math.abs(dx) + Math.abs(dy) > 16
  }
  return (Math.abs(dx) < 6 && Math.abs(dy) < 28) || (Math.abs(dy) < 6 && Math.abs(dx) < 28)
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function crc32(buf: Buffer): number {
  let crc = ~0
  for (const byte of buf) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return ~crc >>> 0
}
