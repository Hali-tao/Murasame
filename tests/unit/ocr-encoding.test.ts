import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { recognizeImage, recognizeImageAsync, recognizePngAsync } from '../../src/main/local/ocr'

it.skipIf(process.platform !== 'win32')('preserves recognized text through all Windows OCR paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'murasame-ocr-encoding-'))
  const image = join(directory, 'fixture.png')
  try {
    const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'Windows OCR has no recognizer for the current user profile.' }
$language = $engine.RecognizerLanguage.LanguageTag

# Match the recognizer selected by the production OCR paths.
$fontName = 'Arial'
$text = '8473 5269'
if ($language -like 'zh-*') {
  $fontName = 'Microsoft YaHei'
  $text = '中文文字 Enter Esc'
} elseif ($language -like 'en-*') {
  $text = 'Café Menu Enter Esc'
}

Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(900, 160)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$font = New-Object System.Drawing.Font($fontName, 32)
try {
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.DrawString($text, $font, [System.Drawing.Brushes]::Black, 20, 40)
  $bitmap.Save($env:MURASAME_OCR_IMAGE, [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
@{ language = $language; text = $text } | ConvertTo-Json -Compress
`
    const fixture = execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, MURASAME_OCR_IMAGE: image } })
    const { language, text } = JSON.parse(fixture) as { language: string; text: string }
    const results = {
      recognizeImage: recognizeImage(image),
      recognizeImageAsync: await recognizeImageAsync(image),
      recognizePngAsync: await recognizePngAsync(readFileSync(image))
    }
    for (const [path, result] of Object.entries(results)) {
      expect(result.replace(/\s/g, ''), `${path} with ${language} OCR`).toBe(text.replace(/\s/g, ''))
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 60000)
