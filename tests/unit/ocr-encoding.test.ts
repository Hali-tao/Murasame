import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { recognizeImage, recognizeImageAsync, recognizePngAsync } from '../../src/main/local/ocr'

it.skipIf(process.platform !== 'win32')('preserves Chinese text through real Windows OCR in sync and async capture', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'murasame-ocr-encoding-'))
  const image = join(directory, 'chinese.png')
  try {
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(900, 160)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$font = New-Object System.Drawing.Font('Microsoft YaHei', 32)
try {
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.DrawString('中文测试 屏幕区域 Enter Esc', $font, [System.Drawing.Brushes]::Black, 20, 40)
  $bitmap.Save($env:MURASAME_OCR_IMAGE, [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
`
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 20000, env: { ...process.env, MURASAME_OCR_IMAGE: image } })
    for (const result of [recognizeImage(image), await recognizeImageAsync(image), await recognizePngAsync(readFileSync(image))]) {
      expect(result).not.toContain('\uFFFD')
      expect(result.replace(/\s/g, '')).toContain('中文测试')
      expect(result).toContain('Enter')
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 60000)
