import { deflateSync } from 'node:zlib'
import { crc32 } from 'node:zlib'

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const name = Buffer.from(type)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0, 0)
  return Buffer.concat([length, name, data, checksum])
}

/** 程序生成的纯色图，探测视觉能力时使用，不读取任何屏幕截图。 */
export function solidColorPng(width = 8, height = 8, rgb: [number, number, number] = [0, 0, 255]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const stride = 1 + width * 3
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const index = row + 1 + x * 3
      raw[index] = rgb[0]
      raw[index + 1] = rgb[1]
      raw[index + 2] = rgb[2]
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export function probeImageBase64(): string {
  return solidColorPng().toString('base64')
}
