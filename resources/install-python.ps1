$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'Murasame\python'
$python = Join-Path $root 'python.exe'
if (Test-Path $python) {
  & $python -c "from misaki import zh" 
  if ($LASTEXITCODE -eq 0) {
    Write-Output '中文注音环境已存在'
    exit 0
  }
}
New-Item -ItemType Directory -Force -Path $root | Out-Null
$zip = Join-Path $env:TEMP 'python-embed.zip'
Write-Output '正在下载嵌入式 Python'
Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip' -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $root -Force
$pth = Get-ChildItem $root -Filter 'python*._pth' | Select-Object -First 1
if ($pth) {
  $text = Get-Content $pth.FullName -Raw
  $text = $text -replace '#import site', 'import site'
  if ($text -notmatch 'import site') { $text += "`r`nimport site`r`n" }
  Set-Content -Path $pth.FullName -Value $text -Encoding ascii
}
$getPip = Join-Path $root 'get-pip.py'
Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip
& $python $getPip
& $python -m pip install 'misaki[zh]'
if ($LASTEXITCODE -ne 0) { throw 'misaki 安装失败' }
[Environment]::SetEnvironmentVariable('MURASAME_PYTHON', $python, 'User')
Write-Output "中文注音已安装到 $python"
