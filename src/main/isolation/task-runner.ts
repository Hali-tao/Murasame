import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveInside } from '../tools/filesystem'
import type { IsolatedRunner, IsolatedResult } from '../tools/terminal'
import { createStage, exportStage, inspectStage, loadStage, removeStage, stageWorkspace, type StageManifest } from '../task/staging'
import { containerPlan, runCommandAsync, runInContainerAsync, startContainerAsync, stopContainerAsync, type DockerRunner } from './docker-runtime'
/** Arbitrary code gets a private snapshot, never a writable host root. Only
 * explicitly approved output paths can pass the separate export boundary. */
export function createTaskRunner(run: DockerRunner = runCommandAsync): IsolatedRunner {
  return async (request) => {
    if (request.signal?.aborted) return { status: 'aborted', raw: '已取消，未启动隔离任务', outcomeKnown: true }
    const controller = new AbortController(); const abort = (): void => controller.abort(request.signal?.reason)
    request.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('任务执行超时')), request.timeoutMs)
    const gate = (boundary: 'execute' | 'export' = 'execute'): void => { if (controller.signal.aborted) throw new Error('任务已取消或超时'); request.assertAllowed?.(boundary) }
    let containerId = ''; let stage: StageManifest | undefined
    let outcome: IsolatedResult = { status: 'error', raw: '隔离任务没有执行', outcomeKnown: true }
    try {
      gate(); const root = resolveInside(request.root, '.')
      if (!statSync(root).isDirectory() || lstatSync(root).isSymbolicLink() || realpathSync(root).toLowerCase() !== resolve(root).toLowerCase()) throw new Error('授权根目录必须为真实目录，不能经过目录联接')
      if (request.resumeStageId) {
        stage = await loadStage(request.resumeStageId, root)
        await inspectStage(stage, controller.signal)
        const outputs = request.outputs ?? stage.changes.filter((change) => !change.exported).map((change) => ({ path: change.path, kind: change.kind, overwrite: change.baselineHash !== null, baselineHash: change.baselineHash, expectedHash: change.hash ?? undefined }))
        const exported = await exportStage(stage, outputs, () => gate('export'))
        outcome = { status: exported.error || exported.pending.length ? 'error' : 'ok', exitCode: exported.error || exported.pending.length ? undefined : 0, raw: exported.error ?? (exported.pending.length ? '仍有暂存变化待批准' : '已核验并导出批准的暂存产物；没有重放命令'), artifacts: exported.artifacts, effects: exported.effects, outcomeKnown: true, ...(exported.pending.length ? { awaitingExport: { stageId: stage.stageId, changes: exported.pending } } : {}) }
      } else {
        if (!request.readOnly) stage = await createStage(root, controller.signal)
        gate()
        const mount = stage ? stageWorkspace(stage.stageId) : root
        const sessionId = `task-${request.taskId ?? 'standalone'}-${request.ticketId ?? randomUUID()}`
        const started = await startContainerAsync({ ...containerPlan({ hostPath: mount, readOnly: request.readOnly === true, network: request.network ?? 'none' }), sessionId }, 0, run, { signal: controller.signal, readiness: 'process' })
        if ('failed' in started) { containerId = started.id ?? ''; throw new Error(started.failed) }
        containerId = started.id; gate()
        const marker = `MURASAME_EXIT_${randomUUID().replaceAll('-', '')}`
        const script = `cd /shared || exit 125; "$@"; result=$?; printf '\\n${marker}=%s\\n' "$result"; exit 0`
        const text = await runInContainerAsync(containerId, ['sh', '-c', script, 'task-command', request.executable, ...request.args], run, { signal: controller.signal, timeoutMs: request.timeoutMs })
        const match = new RegExp(`\\n${marker}=(\\d+)\\s*$`).exec(text)
        if (!match) throw new Error('隔离命令缺少可信退出码；宿主文件未交给代码写入')
        const exitCode = Number(match[1]); const raw = text.slice(0, match.index).trim()
        outcome = { status: exitCode === 0 ? 'ok' : 'error', raw: raw || `exit=${exitCode}`, exitCode, outcomeKnown: true }
        if (stage) {
          // Quiesce arbitrary/background code before host-side verification and export.
          if (!await stopContainerAsync(containerId, run)) { outcome.outcomeKnown = false; throw new Error(`隔离容器 ${containerId} 无法停止，未导出宿主文件`) }
          containerId = ''
          await inspectStage(stage, controller.signal)
          const exported = exitCode === 0 ? await exportStage(stage, request.outputs ?? [], () => gate('export')) : { artifacts: [], effects: [], pending: stage.changes }
          outcome = { ...outcome, artifacts: exported.artifacts, effects: exported.effects, ...('error' in exported && exported.error ? { status: 'error' as const, raw: `${outcome.raw}；${exported.error}` } : {}), ...(exported.pending.length ? { status: 'error' as const, awaitingExport: { stageId: stage.stageId, changes: exported.pending }, raw: `${outcome.raw}；变化保留于暂存 ${stage.stageId}，未声明的宿主变化尚未导出` } : {}) }
        }
      }
    } catch (error) {
      outcome = { ...outcome, status: controller.signal.aborted ? request.signal?.aborted ? 'aborted' : 'timeout' : 'error', raw: error instanceof Error ? error.message : String(error), outcomeKnown: outcome.outcomeKnown !== false }
      if (stage) { try { const changes = (await inspectStage(stage)).filter((change) => !change.exported); if (changes.length) outcome.awaitingExport = { stageId: stage.stageId, changes } } catch (failure) { outcome.raw += `；暂存 ${stage.stageId} 内容无法完整核验：${failure instanceof Error ? failure.message : String(failure)}` } }
    } finally {
      if (containerId && !await stopContainerAsync(containerId, run)) outcome = { ...outcome, status: 'error', outcomeKnown: false, raw: `${outcome.raw}；隔离容器 ${containerId} 清理失败，停止尚未核实` }
      if (stage && !outcome.awaitingExport && outcome.outcomeKnown && !/暂存 .*内容无法完整核验/.test(outcome.raw)) await removeStage(stage.stageId)
      clearTimeout(timer); request.signal?.removeEventListener('abort', abort)
    }
    if (controller.signal.aborted && outcome.status !== 'error') outcome.status = request.signal?.aborted ? 'aborted' : 'timeout'
    return outcome
  }
}
