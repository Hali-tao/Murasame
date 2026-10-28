import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

// Diagnostic quality cases are reported honestly, not silently dropped to make
// a green score. Infrastructure/identity/offline failures stop this verifier.
const baseline = process.argv.includes('--legacy-mean')
const root = process.cwd()
const modelRoot = resolve(process.env.MURASAME_MODELS || 'build/bundled-models')
const output = resolve('previews/overnight-2026-10-29/real-memory')
const temp = resolve('previews/tmp'); mkdirSync(temp, { recursive: true }); mkdirSync(output, { recursive: true })
const userData = mkdtempSync(join(temp, 'memory-live-'))
const engine = join(userData, 'engine.mjs')
const entry = "export * from './src/main/local/embedding'; export {setBundledModelsRoot} from './src/main/local/model-env';" + (baseline ? '' : "export {MemoryService} from './src/main/core/services/memory-service'")
await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: engine,
  plugins: baseline ? [{ name: 'read-legacy-embedding', setup(builder) {
    builder.onLoad({ filter: /[\\/]embedding\.ts$/ }, () => ({ loader: 'ts', contents: execFileSync('git', ['show', '08b20bcb0e7b63d6660dea758af3bdb39d342706:src/main/local/embedding.ts'], { encoding: 'utf8' }) }))
  } }] : []
})
const api = await import(pathToFileURL(engine).href)
api.setBundledModelsRoot(modelRoot)
const sdkStarted = performance.now()
const { env } = await import('@huggingface/transformers')
const sdkLoadMs = performance.now() - sdkStarted
env.useFSCache = false; env.useBrowserCache = false
let networkAttempts = 0
globalThis.fetch = async () => { networkAttempts++; throw new Error('Offline verification forbids network access') }
const fixture = JSON.parse(readFileSync(resolve('tests/fixtures/memory-semantic.json'), 'utf8'))
const timings = [], entries = []
for (const fact of fixture.facts) {
  const start = performance.now(), vector = await api.embedLocally(fact.text, userData)
  if (!vector || vector.length !== 512) throw new Error('Actual local embedding unavailable')
  timings.push(performance.now() - start); entries.push({ ...fact, vector })
}
const cases = []
for (const item of fixture.cases) {
  const start = performance.now(), vector = await api.embedLocally(item.query, userData)
  if (!vector) throw new Error('Actual query embedding unavailable')
  const result = api.recallMemories(item.query, entries, vector)
  cases.push({ ...item, ids: result.ids, expectedHit: item.expected.every(id => result.ids.includes(id)), forbiddenHit: (item.forbidden || []).filter(id => result.ids.includes(id)), latencyMs: performance.now() - start,
    ranking: entries.map(fact => ({ id: fact.id, cosine: api.cosine(vector, fact.vector) })).sort((a,b)=>b.cosine-a.cosine) })
}

let recovery = null
if (!baseline) {
  const raw = new DatabaseSync(join(userData, 'synthetic.sqlite'))
  for (const name of ['001_init.sql', '002_memory.sql', '003_trace.sql']) raw.exec(readFileSync(resolve('src/main/data/migrations', name), 'utf8'))
  const db = { prepare: sql => raw.prepare(sql), exec: sql => { raw.exec(sql); return db }, pragma: () => undefined,
    transaction: work => () => { raw.exec('BEGIN'); try { const result = work(); raw.exec('COMMIT'); return result } catch(error) { raw.exec('ROLLBACK'); throw error } }, close: () => raw.close() }
  const now = new Date().toISOString(), legacyVector = JSON.stringify([1, ...Array(511).fill(0)])
  const insert = raw.prepare('INSERT INTO memories(id, category, text, source, created_at, updated_at, vector_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (let index = 0; index < 500; index++) { const fact = fixture.facts[index % fixture.facts.length]; insert.run(`synthetic-${index}`, fact.category, `独立测试条目 ${index}：${fact.text}`, 'synthetic-benchmark', now, now, legacyVector) }
  raw.prepare("INSERT INTO meta(key, value) VALUES ('embedding', 'bge-small-zh-v1.5:512')").run()
  const memory = new api.MemoryService(db, userData)
  if (memory.active().some(fact => fact.vector)) throw new Error('Legacy vectors survived profile migration')
  const progress = []; memory.subscribeIndex(status => progress.push({ atMs: performance.now(), ...status }))
  const started = performance.now(); const firstRecall = await memory.recall('推荐个菜'); const firstRecallMs = performance.now()-started
  const afterFirst = memory.indexStatus()
  const watchdog = performance.now()+35_000
  while (memory.indexStatus().state === 'rebuilding' && performance.now()<watchdog) await new Promise(done=>setTimeout(done,20))
  const elapsedMs = performance.now()-started, state = memory.indexStatus()
  if (state.state === 'rebuilding') { memory.configure({recallEnabled:false,extractionEnabled:false}); throw new Error('Background index job exceeded its deadline') }
  const remaining = raw.prepare('SELECT COUNT(*) AS count FROM memories WHERE vector_json IS NULL').get().count
  const stamp = raw.prepare("SELECT value FROM meta WHERE key = 'embedding'").get().value
  if (stamp !== `bge-small-zh-v1.5:512:${api.EMBEDDING_PROFILE}` || afterFirst.completed === 500) throw new Error('Profile or nonblocking recovery contract failed')
  const reopened = new api.MemoryService(db, userData)
  if (reopened.indexStatus().completed !== state.completed) throw new Error('Progress did not persist across restart')
  recovery = { total:500, firstRecallMs, firstRecallDegraded:firstRecall.degraded, afterFirst, elapsedMs, state, remaining, progressEvents:progress.length, stamp, restartCompleted:reopened.indexStatus().completed }
  raw.close()
}
if(networkAttempts) throw new Error('Verification attempted network access')
const positive = cases.filter(item=>item.expected.length)
const report = { at:new Date().toISOString(), mode:baseline?'legacy-mean':'current-production', actualLocalModel:true, networkAttempts, node:process.version, cpu:cpus()[0]?.model,
  modelFiles:api.EMBEDDING_FILES.map(file=>({file,sha256:createHash('sha256').update(readFileSync(join(modelRoot,api.EMBEDDING_MODEL_ID,file))).digest('hex')})),
  sdkLoadMs, firstInferenceMs:timings[0], coldStartMs:sdkLoadMs+timings[0], warmMedianMs:[...timings.slice(1)].sort((a,b)=>a-b)[Math.floor((timings.length-1)/2)],
  diagnostics:{positiveCases:positive.length,expectedHitCases:positive.filter(item=>item.expectedHit).length,qualityTargetsMet:cases.every(item=>item.expectedHit&&!item.forbiddenHit.length)}, cases, recovery }
const path=join(output,baseline?'legacy-mean.json':'current-production.json')
writeFileSync(path,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({report:path,sdkLoadMs,firstInferenceMs:report.firstInferenceMs,coldStartMs:report.coldStartMs,warmMedianMs:report.warmMedianMs,diagnostics:report.diagnostics,recovery,networkAttempts},null,2))
