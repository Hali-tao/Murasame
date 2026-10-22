import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'isolation')
const started = Date.now()
const result = spawnSync('docker', ['build', '-t', 'murasame-isolation:local', root], { stdio: 'inherit' })
if (result.status !== 0) {
  console.error('镜像没有建成。请确认 Docker Desktop 已启动后重试。应用其余功能不依赖这次构建。')
  process.exit(result.status ?? 1)
}
const inspect = spawnSync('docker', ['image', 'inspect', 'murasame-isolation:local', '--format', '{{.Size}}'], { encoding: 'utf8' })
const bytes = Number(inspect.stdout.trim() || 0)
console.log(`镜像大小 ${(bytes / 1024 / 1024).toFixed(0)} MB，构建耗时 ${Math.round((Date.now() - started) / 1000)} 秒`)
