$ErrorActionPreference = 'Stop'
$ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
if (-not (Test-Path $ollama)) {
  $setup = Join-Path $env:TEMP 'OllamaSetup.exe'
  Write-Output '正在下载 Ollama'
  Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $setup
  Write-Output '正在安装 Ollama'
  $process = Start-Process -FilePath $setup -ArgumentList '/VERYSILENT','/NORESTART','/SUPPRESSMSGBOXES' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Ollama 安装失败，退出码 $($process.ExitCode)"
  }
}
if (-not (Test-Path $ollama)) {
  throw '安装结束后仍找不到 ollama.exe'
}
Write-Output '正在下载记忆模型 nomic-embed-text'
& $ollama pull nomic-embed-text
if ($LASTEXITCODE -ne 0) {
  throw '记忆模型下载失败'
}
Write-Output '记忆服务已准备好'
