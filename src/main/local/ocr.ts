import { runCommandAsync, type DockerRunner } from '../isolation/docker-runtime'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const script = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
if ($env:MURASAME_OCR_STDIN -eq '1') {
  $null = [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.DataWriter,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
  $writer.WriteBytes([Convert]::FromBase64String([Console]::In.ReadToEnd()))
  $null = Await ($writer.StoreAsync()) ([uint32])
  $null = $writer.DetachStream()
  $writer.Dispose()
  $stream.Seek(0)
} else {
  $path = $env:MURASAME_OCR_IMAGE
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
}
try {
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Text
} finally { if ($bitmap) { $bitmap.Dispose() }; $stream.Dispose() }
`

export function recognizeImage(imagePath: string, run: (command: string, args: string[], env: NodeJS.ProcessEnv) => string = defaultRun): string {
  return run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { ...process.env, MURASAME_OCR_IMAGE: imagePath }).trim()
}

function defaultRun(command: string, args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 20000, env })
}

export async function recognizeImageAsync(imagePath: string, run: DockerRunner = runCommandAsync, signal?: AbortSignal): Promise<string> {
  return (await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MURASAME_OCR_IMAGE: imagePath }, timeoutMs: 20000, signal
  })).trim()
}

/** Send screenshot bytes through stdin; never create an OCR image on disk. */
export async function recognizePngAsync(png: Buffer, run: DockerRunner = runCommandAsync, signal?: AbortSignal): Promise<string> {
  return (await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MURASAME_OCR_STDIN: '1' }, input: png.toString('base64'), timeoutMs: 20000, signal
  })).trim()
}
