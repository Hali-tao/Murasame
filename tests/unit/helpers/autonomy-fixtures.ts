import { deflateSync } from 'node:zlib'

/** Synthetic solid-color 1280x720 PNG; no desktop capture or user content. */
export function syntheticDesktopPng(red = 10): string {
  const crc = (b: Buffer): number => { let n = 0xffffffff; for (const byte of b) { n ^= byte; for (let j = 0; j < 8; j++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0) } return (n ^ 0xffffffff) >>> 0 }
  const chunk = (name: string, data: Buffer): Buffer => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(name, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b }
  const header = Buffer.alloc(13); header.writeUInt32BE(1280); header.writeUInt32BE(720,4); header[8]=8;header[9]=2
  const rows=Buffer.alloc((1280*3+1)*720)
  for(let y=0;y<720;y++)for(let x=0;x<1280;x++)rows[y*(1280*3+1)+1+x*3]=red
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]).toString('base64')
}
