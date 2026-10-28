import { app } from 'electron'

/** Respect Windows Known Folder redirection, including a relocated Desktop. */
export function taskSystemFolders(): string {
  const folders = [['桌面', 'desktop'], ['下载', 'downloads'], ['文档', 'documents']] as const
  return folders.map(([label, name]) => {
    try { return `${label}：${app.getPath(name)}` }
    catch { return `${label}：暂时无法获取，请用户通过目录选择器确认` }
  }).join('\n')
}
