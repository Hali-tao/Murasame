import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const base = 'https://npmmirror.com/mirrors/electron-builder-binaries'
const cache = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache')
const candidates = [
  resolve('node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
  join(process.env.ProgramFiles ?? '', '7-Zip', '7z.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', '7-Zip', '7z.exe')
]
const sevenZip = candidates.find((candidate) => existsSync(candidate))

if (!sevenZip) {
  console.error(`找不到 7-Zip，无法解压。已查找：\n${candidates.join('\n')}`)
  process.exit(1)
}

// electron-builder 的缓存布局是 <cache>/<name>/<version>/<解压内容>
const items = [
  { pkg: 'winCodeSign-2.6.0', dir: 'winCodeSign', version: '2.6.0' },
  { pkg: 'nsis-3.0.4.1', dir: 'nsis', version: '3.0.4.1' },
  { pkg: 'nsis-resources-3.4.1', dir: 'nsis', version: 'resources-3.4.1' }
]

function countFiles(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1
  }
  return total
}

for (const item of items) {
  const target = join(cache, item.dir, item.version)
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.log(`${item.pkg.padEnd(24)} 已存在`)
    continue
  }
  mkdirSync(target, { recursive: true })
  const archive = join(tmpdir(), `${item.pkg}.7z`)
  let ok = false
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      execFileSync('curl.exe', ['-L', '-s', '--fail', '--max-time', '900', '-o', archive, `${base}/${item.pkg}/${item.pkg}.7z`], {
        stdio: 'ignore'
      })
    } catch {
      // 失败后重试，下面按文件大小判断是否真的拿到了压缩包。
    }
    if (existsSync(archive) && statSync(archive).size > 100_000) {
      ok = true
      break
    }
  }
  if (!ok) {
    console.log(`${item.pkg.padEnd(24)} 下载失败`)
    continue
  }
  // winCodeSign 里 darwin/ 下有 macOS 符号链接，普通权限建不了，Windows 打包也用不到。
  try {
    execFileSync(sevenZip, ['x', archive, `-o${target}`, '-y', '-xr!darwin'], { stdio: 'ignore' })
  } catch (error) {
    if (countFiles(target) === 0) throw error
  }
  rmSync(archive, { force: true })
  console.log(`${item.pkg.padEnd(24)} 完成，${countFiles(target)} 个文件`)
}
