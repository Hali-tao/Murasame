const { app } = require('electron')
const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const uia = `
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$handle = [Fg]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 512
[void][Fg]::GetWindowText($handle, $title, $title.Capacity)
$element = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
$tree = @()
if ($element) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $walker.GetFirstChild($element)
  $count = 0
  while ($node -and $count -lt 12) {
    if ($node.Current.Name) { $tree += $node.Current.Name }
    $node = $walker.GetNextSibling($node)
    $count++
  }
}
Write-Output ("TITLE=" + $title.ToString())
Write-Output ("TREE=" + ($tree -join " | "))
`

function paint() {
  const path = join(tmpdir(), 'murasame-ocr-sample.png')
  const script = `
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 320, 80
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font "Arial", 28
$brush = [System.Drawing.Brushes]::Black
$graphics.DrawString("MURASAME", $font, $brush, 8, 16)
$bitmap.Save($env:MURASAME_OCR_IMAGE, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
`
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MURASAME_OCR_IMAGE: path },
    windowsHide: true
  })
  return path
}

app.whenReady().then(() => {
  try {
    const tree = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', uia], { encoding: 'utf8', windowsHide: true })
    const image = paint()
    const ocr = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$methods = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })
$asTask = $methods[0]
function Await($op, $type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:MURASAME_OCR_IMAGE)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Text
`], { encoding: 'utf8', windowsHide: true, env: { ...process.env, MURASAME_OCR_IMAGE: image } })
    if (!tree.includes('TITLE=') || !ocr.trim()) throw new Error(`感知结果不完整\n${tree}\n${ocr}`)
    console.log(tree.trim())
    console.log(`OCR=${ocr.trim()}`)
    console.log('PASS [FR-05] 原生感知能力可用性自检')
    app.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    app.exit(1)
  }
})
writeFileSync(join(tmpdir(), 'murasame-perception-touch'), '')
