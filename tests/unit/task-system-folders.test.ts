import { expect, it, vi } from 'vitest'
import { taskSystemFolders } from '../../src/main/agent/system-folders'

const getPath = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ app: { getPath } }))

it('[FR-16] 常用目录采用系统实际位置，支持迁移到其他盘符的桌面', () => {
  getPath.mockImplementation((name: string) => ({ desktop: 'E:\\桌面', downloads: 'F:\\Downloads', documents: 'D:\\文档' })[name])
  expect(taskSystemFolders()).toBe('桌面：E:\\桌面\n下载：F:\\Downloads\n文档：D:\\文档')
})

it('[FR-18] 无法查询系统目录时明确追问，不拼接一个可能不存在的用户目录', () => {
  getPath.mockImplementation(() => { throw new Error('unavailable') })
  expect(taskSystemFolders()).toBe('桌面：暂时无法获取，请用户通过目录选择器确认\n下载：暂时无法获取，请用户通过目录选择器确认\n文档：暂时无法获取，请用户通过目录选择器确认')
})
