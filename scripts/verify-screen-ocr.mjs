// Explicit integration check: install verified cached assets, then compare real local OCR engines.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve('.ocr-build')
await mkdir(root, { recursive: true })
const bundle = join(root, 'verify-api.cjs')
await build({ stdin: { contents: "export * from './src/main/local/screen-ocr'; export {recognizePngAsync} from './src/main/local/ocr';", resolveDir: process.cwd() }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { LocalScreenOcr, recognizePngAsync } = createRequire(import.meta.url)(bundle)
const userData = process.argv[2] ? resolve(process.argv[2]) : join(root, '自定义数据位置')
const service = new LocalScreenOcr(userData, resolve('resources'), undefined,
  async (asset, destination) => copyFile(join(root, asset.file), destination))
const installed = await service.install()
if (installed.state !== 'ready') throw new Error(JSON.stringify(installed))
const python = join(installed.directory, 'runtime', 'python.exe')
const generate = `
import os, json, base64, io
from PIL import Image, ImageDraw, ImageFont
cases=[
 ('chinese-small',16,False,['屏幕辅助支持手动框选区域，确认后开始识别。','本地文字识别不会自动上传截图。']),
 ('mixed',22,False,['模型状态 Ready：CPU 运行正常。','版本 PP-OCRv5，按 Enter 确认，Esc 取消。']),
 ('code',22,True,['def bubble_sort(arr):','    for i in range(len(arr) - 1):','        if arr[i] > arr[i + 1]:','            arr[i], arr[i + 1] = arr[i + 1], arr[i]']),
 ('dark',18,True,['运行与隐私：数据保存在自定义目录。','识别文字：中文 English 12345。'])]
out=[]
for name,size,dark,lines in cases:
 im=Image.new('RGB',(1000,220),'#20232b' if dark else 'white')
 draw=ImageDraw.Draw(im)
 font=ImageFont.truetype(os.path.join(os.environ['SystemRoot'],'Fonts','consola.ttf' if name=='code' else 'msyh.ttc'),size)
 for i,line in enumerate(lines): draw.text((20,20+i*40),line,font=font,fill='#eeeeee' if dark else '#202020')
 buf=io.BytesIO();im.save(buf,format='PNG')
 out.append(dict(name=name,expected='\\n'.join(lines),png=base64.b64encode(buf.getvalue()).decode()))
print(json.dumps(out,ensure_ascii=True))
`
const cases = JSON.parse(execFileSync(python, ['-B', '-c', generate], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 }))
function distance(a, b) {
  a = [...a.replace(/\s/g, '')]; b = [...b.replace(/\s/g, '')]
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(previous[j] + 1, next[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = next
  }
  return { edits: previous[b.length], characters: a.length }
}
const report = { directory: installed.directory, runtime: installed, cases: [] }
for (const fixture of cases) {
  const png = Buffer.from(fixture.png, 'base64')
  const begin = Date.now()
  const result = await service.recognize(png)
  const ppMs = Date.now() - begin
  if (result.engine !== 'ppocrv5' || !result.text.trim()) throw new Error(`PP-OCRv5 failed: ${fixture.name}: ${result.detail}`)
  const startWindows = Date.now()
  const windows = await recognizePngAsync(png)
  report.cases.push({ name: fixture.name, expected: fixture.expected, ppocrv5: result.text, windows, ppMs, windowsMs: Date.now() - startWindows, ppError: distance(fixture.expected, result.text), windowsError: distance(fixture.expected, windows) })
}
await writeFile(join(root, 'verification.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ directory: report.directory, cases: report.cases.map(({ name, ppMs, windowsMs, ppError, windowsError }) => ({ name, ppMs, windowsMs, ppError, windowsError })) }, null, 2))
// Verify a new process/service discovers installed assets using only the supplied custom path.
const reopened = new LocalScreenOcr(userData, resolve('resources'))
if ((await reopened.check()).state !== 'ready') throw new Error('Reopened runtime did not load')
await readFile(join(installed.directory, 'installed.json'))
