import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function requirementIdsIn(source) {
  return [...source.matchAll(/\[(FR-\d+|UC-\d+|NFR-[A-Z]+\d+|IF-\d+|OR-\d+|CON-\d+|ASM-\d+)\]/g)].map((match) => match[1])
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ids = []
for (let i = 1; i <= 30; i += 1) ids.push(`FR-${String(i).padStart(2, '0')}`)
for (let i = 1; i <= 10; i += 1) ids.push(`UC-${String(i).padStart(2, '0')}`)
for (let i = 1; i <= 9; i += 1) ids.push(`IF-${String(i).padStart(2, '0')}`)
for (const code of ['P01', 'P02', 'P03', 'S01', 'S02', 'S03', 'R01', 'R02', 'R03', 'U01', 'U02', 'U03', 'C01', 'C02', 'M01', 'M02']) {
  ids.push(`NFR-${code}`)
}
for (let i = 1; i <= 3; i += 1) ids.push(`OR-${String(i).padStart(2, '0')}`)
for (let i = 1; i <= 5; i += 1) ids.push(`CON-${String(i).padStart(2, '0')}`)
ids.push('ASM-01')

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, acc)
    else if (entry.name.endsWith('.ts')) acc.push(path)
  }
  return acc
}

function writeTrace() {
const covered = new Map()
for (const file of walk(join(root, 'tests'))) {
  const text = readFileSync(file, 'utf8')
  for (const id of requirementIdsIn(text)) {
    const list = covered.get(id) ?? []
    list.push(file.slice(root.length + 1).replaceAll('\\', '/'))
    covered.set(id, list)
  }
}

const lines = ['| 需求 | 测试 |', '| --- | --- |']
const missing = []
for (const id of ids) {
  const files = [...new Set(covered.get(id) ?? [])]
  if (files.length === 0) missing.push(id)
  lines.push(`| ${id} | ${files.length ? files.join('<br>') : '未覆盖'} |`)
}

const docPath = join(root, 'docs', '03-TRACEABILITY.md')
const current = readFileSync(docPath, 'utf8')
const begin = '<!-- TRACE:BEGIN -->'
const end = '<!-- TRACE:END -->'
const block = `${begin}\n${lines.join('\n')}\n\n未覆盖：${missing.length ? missing.join('、') : '无'}\n${end}`
if (!current.includes(begin) || !current.includes(end)) {
  throw new Error('追溯文档缺少自动生成标记')
}
writeFileSync(docPath, current.replace(new RegExp(`${begin}[\\s\\S]*${end}`), block))
console.log(`trace: ${ids.length - missing.length}/${ids.length} covered, missing ${missing.length}`)
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) writeTrace()
