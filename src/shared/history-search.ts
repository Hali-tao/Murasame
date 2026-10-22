export interface HistoryHit {
  id: string
  title: string
  preview: string
}

export type HistorySearchResult =
  | { status: 'ok'; items: HistoryHit[] }
  | { status: 'empty' }
  | { status: 'error'; message: string }

export function searchHistory(
  rows: readonly HistoryHit[],
  keyword: string,
  failed = false
): HistorySearchResult {
  if (failed) return { status: 'error', message: '历史读取失败，可以重试。' }
  const needle = keyword.trim().toLowerCase()
  const items = needle
    ? rows.filter((row) => `${row.title} ${row.preview}`.toLowerCase().includes(needle))
    : [...rows]
  if (needle && items.length === 0) return { status: 'empty' }
  return { status: 'ok', items }
}
