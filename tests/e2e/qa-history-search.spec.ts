import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

/**
 * 长历史搜索（端到端）：
 * 60 个会话下搜索仍可用；通配符 %/_ 不被当成「匹配全部」；无结果显示空而不是卡住或崩溃。
 * 同时记录搜索可见耗时，作为本地性能基线（不作硬性阈值）。
 */
test('[QA-SEARCH-10] 60 个会话下历史搜索可用，通配符不返回全部', async () => {
  test.setTimeout(180_000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const failures = await page.evaluate(async () => {
      let failed = 0
      for (let index = 0; index < 60; index += 1) {
        const created = await window.murasame.core.createConversation()
        if (!created.ok) failed += 1
      }
      return failed
    })
    expect(failures).toBe(0)
    await page.getByTestId('nav-history').click()
    const items = page.getByTestId('history-item')
    await expect(items).toHaveCount(60, { timeout: 20_000 })

    const search = page.getByLabel('搜索历史')
    const timeSearch = async (keyword: string): Promise<number> => {
      const started = Date.now()
      await search.fill(keyword)
      return Date.now() - started
    }

    // 标题关键词：60 个会话标题都是「新的对话」，应全部命中。
    const titleElapsed = await timeSearch('新的对话')
    await expect(items).toHaveCount(60, { timeout: 10_000 })

    // 无匹配关键词：结果为空，不阻塞后续输入。
    await timeSearch('绝对不会命中的关键词xyz')
    await expect(items).toHaveCount(0, { timeout: 10_000 })

    // 通配符查询按字面处理：% 和 _ 不能把全部历史当成命中。
    await timeSearch('%')
    await expect(items).toHaveCount(0, { timeout: 10_000 })
    await timeSearch('_')
    await expect(items).toHaveCount(0, { timeout: 10_000 })

    // 清空搜索恢复全部结果，页面仍可交互。
    const clearElapsed = await timeSearch('')
    await expect(items).toHaveCount(60, { timeout: 10_000 })
    await items.first().click()
    await expect(page.getByTestId('nav-history')).toHaveAttribute('aria-current', 'page')

    test.info().annotations.push({ type: 'perf', description: `标题关键词输入 ${titleElapsed}ms；清空 ${clearElapsed}ms（本地基线，非硬阈值）` })
  } finally {
    await closeApp(app)
  }
})
