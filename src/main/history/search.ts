export { searchHistory, type HistoryHit, type HistorySearchResult } from '../../shared/history-search'

export interface ClearReport {
  ok: boolean
  cleared: string[]
  failed: string[]
  message: string
}

export function reportClear(requested: readonly string[], succeeded: ReadonlySet<string>): ClearReport {
  const cleared = requested.filter((item) => succeeded.has(item))
  const failed = requested.filter((item) => !succeeded.has(item))
  if (failed.length > 0) {
    return { ok: false, cleared, failed, message: `未完成：${failed.join('、')}。这些范围仍保留，不能视为清除成功。` }
  }
  return { ok: true, cleared, failed, message: '所选范围已清除。缓存和检索索引包含在本次清除中，导出的备份不包含。' }
}
