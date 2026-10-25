$ErrorActionPreference = 'Stop'

# 退出码：0 装好了，2 现在连不上下载源（安装程序会温和提示而不是报错），其他为真失败。
# 国内直连 python.org 很慢（实测 20 秒只有 1.4MB），所以优先走阿里云镜像。
$sources = @(
  'https://mirrors.aliyun.com/python-release/windows/python-3.11.9-embed-amd64.zip',
  'https://registry.npmmirror.com/-/binary/python/3.11.9/python-3.11.9-embed-amd64.zip',
  'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip'
)

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
$got = $false
foreach ($url in $sources) {
  try {
    Write-Output "正在下载嵌入式 Python：$url"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 180
    if ((Get-Item $zip).Length -gt 5MB) { $got = $true; break }
  } catch {
    Write-Output "  这个源不通，换下一个"
  }
}
if (-not $got) {
  Write-Output '所有下载源都连不上，这次跳过中文朗读组件安装'
  exit 2
}

Expand-Archive -Path $zip -DestinationPath $root -Force
$pth = Get-ChildItem $root -Filter 'python*._pth' | Select-Object -First 1
if ($pth) {
  $text = Get-Content $pth.FullName -Raw
  $text = $text -replace '#import site', 'import site'
  if ($text -notmatch 'import site') { $text += "`r`nimport site`r`n" }
  Set-Content -Path $pth.FullName -Value $text -Encoding ascii
}

# get-pip.py 随安装包带着，省掉一次对 bootstrap.pypa.io 的下载。
$getPip = Join-Path $PSScriptRoot 'get-pip.py'
if (-not (Test-Path $getPip)) {
  $getPip = Join-Path $root 'get-pip.py'
  try {
    Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip -UseBasicParsing -TimeoutSec 120
  } catch {
    Write-Output 'pip 引导脚本下载失败，这次跳过'
    exit 2
  }
}
& $python $getPip --index-url https://pypi.tuna.tsinghua.edu.cn/simple
if ($LASTEXITCODE -ne 0) {
  Write-Output 'pip 没有装上，联网后可以重新运行安装程序'
  exit 2
}

# 国内直连 PyPI 经常超时，先走清华镜像，失败再回退官方源。
& $python -m pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple 'misaki[zh]'
if ($LASTEXITCODE -ne 0) {
  & $python -m pip install 'misaki[zh]'
}
if ($LASTEXITCODE -ne 0) {
  Write-Output 'misaki 没有装上，联网后可以重新运行安装程序'
  exit 2
}

[Environment]::SetEnvironmentVariable('MURASAME_PYTHON', $python, 'User')
Write-Output "中文注音已安装到 $python"
