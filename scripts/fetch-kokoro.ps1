$ErrorActionPreference = 'Continue'
$root = "$env:APPDATA\murasame-desktop\models"
$base = 'https://hf-mirror.com'
$repo = 'onnx-community/Kokoro-82M-v1.0-ONNX'

$files = @(
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
  'voices/zf_xiaoxiao.bin',
  'voices/zm_yunxi.bin',
  'voices/af_heart.bin'
)

function Test-Payload([string]$path, [string]$name) {
  if (-not (Test-Path $path)) { return $false }
  $size = (Get-Item $path).Length
  if ($size -lt 1024) {
    $head = Get-Content $path -Raw -ErrorAction SilentlyContinue
    if ($head -match 'rate limit|<html|Not Found|Entry not found') { return $false }
  }
  if ($name.EndsWith('.onnx') -and $size -lt 1000000) { return $false }
  return $true
}

foreach ($file in $files) {
  $dest = Join-Path $root ("kokoro\" + $file.Replace('/', '\'))
  New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
  if (Test-Payload $dest $file) {
    Write-Output ("{0,-30} 已存在 {1,12:N0}" -f $file, (Get-Item $dest).Length)
    continue
  }
  $ok = $false
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    curl.exe -L -s --fail --max-time 1200 -o $dest "$base/$repo/resolve/main/$file"
    if (Test-Payload $dest $file) { $ok = $true; break }
    Remove-Item $dest -ErrorAction SilentlyContinue
    Start-Sleep -Seconds (10 * $attempt)
  }
  if ($ok) {
    Write-Output ("{0,-30} 完成   {1,12:N0}" -f $file, (Get-Item $dest).Length)
  } else {
    Write-Output ("{0,-30} 失败" -f $file)
  }
}
