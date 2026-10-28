import { inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'

export interface DecodedFrame { width: number; height: number; pixels: Buffer; digest: string }

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}

/** scrot produces non-interlaced PNGs. Reject unsupported/corrupt images, including bad CRC/scanlines. */
export function decodeFrame(encoded: string): DecodedFrame | null {
  try {
    const raw = encoded.replace(/^data:image\/png;base64,/, '').trim()
    if (!raw || raw.length > 32 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null
    const file = Buffer.from(raw, 'base64')
    if (!file.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return null
    let offset = 8; let width = 0; let height = 0; let channels = 0; let ended = false
    const data: Buffer[] = []
    while (offset + 12 <= file.length) {
      const length = file.readUInt32BE(offset)
      if (length > 24 * 1024 * 1024 || offset + length + 12 > file.length) return null
      const kind = file.toString('ascii', offset + 4, offset + 8)
      const bytes = file.subarray(offset + 8, offset + 8 + length)
      if (crc32(file.subarray(offset + 4, offset + length + 8)) !== file.readUInt32BE(offset + length + 8)) return null
      if (kind === 'IHDR') {
        if (offset !== 8 || length !== 13) return null
        width = bytes.readUInt32BE(0); height = bytes.readUInt32BE(4)
        channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[bytes[9]] ?? 0
        if (!width || !height || width * height > 8_000_000 || bytes[8] !== 8 || bytes[10] || bytes[11] || bytes[12] || !channels) return null
      } else if (kind === 'IDAT') data.push(bytes)
      else if (kind === 'IEND') { if (length) return null; ended = true; offset += 12; break }
      offset += length + 12
    }
    if (!ended || offset !== file.length || !data.length || !channels) return null
    const stride = width * channels
    const scan = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * height })
    if (scan.length !== (stride + 1) * height) return null
    const pixels = Buffer.alloc(stride * height)
    for (let y = 0; y < height; y++) {
      const filter = scan[y * (stride + 1)]
      if (filter > 4) return null
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? pixels[y * stride + x - channels] : 0
        const up = y ? pixels[(y - 1) * stride + x] : 0
        const upperLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0
        let predictor = 0
        if (filter === 1) predictor = left
        if (filter === 2) predictor = up
        if (filter === 3) predictor = Math.floor((left + up) / 2)
        if (filter === 4) {
          const p = left + up - upperLeft
          const a = Math.abs(p - left); const b = Math.abs(p - up); const c = Math.abs(p - upperLeft)
          predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft
        }
        pixels[y * stride + x] = (scan[y * (stride + 1) + x + 1] + predictor) & 255
      }
    }
    return { width, height, pixels, digest: createHash('sha256').update(`${width}:${height}:${channels}:`).update(pixels).digest('hex') }
  } catch { return null }
}
