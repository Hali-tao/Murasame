import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 数据包导入后的界面一致性（真实「从备份恢复」路径）：
 * 设备 A 导出数据包 → 设备 B（全新 userData）导入 → 控制台立即看到恢复的记忆，而不是
 * 「导入成功但页面还是空的、要重启才出现」。
 */
test('[QA-IPC-13] 在全新资料目录导入数据包后，记忆页立即出现恢复的记忆（无需重启）', async () => {
  const bundleDir = mkdtempSync(join(tmpdir(), 'murasame-qa-import-'))
  const path = join(bundleDir, 'backup.murapack')
  const restoredText = '导入后应立即出现的记忆'

  const source = await launchApp()
  try {
    const page = await findMainPage(source)
    await page.getByTestId('nav-memory').click()
    await page.getByTestId('add-memory').click()
    await page.getByTestId('memory-category').fill('偏好')
    await page.getByTestId('memory-text').fill(restoredText)
    await page.getByRole('button', { name: '添加记忆', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('memory-card').filter({ hasText: restoredText })).toBeVisible()
    const exported = await page.evaluate((target) => window.murasame.data.exportBundle('qa-pass-123', target), path)
    expect(exported.ok, exported.ok ? '' : exported.error).toBe(true)
  } finally {
    await closeApp(source)
  }

  const restored = await launchApp()
  try {
    const page = await findMainPage(restored)
    await page.getByTestId('nav-memory').click()
    await expect(page.getByTestId('memory-card')).toHaveCount(0)

    const imported = await page.evaluate((target) => window.murasame.data.importBundle(target, 'qa-pass-123'), path)
    expect(imported.ok, imported.ok ? '' : imported.error).toBe(true)

    // 不刷新、不重启：主进程重载记忆缓存并广播，记忆页立即出现恢复的条目。
    await expect(page.getByTestId('memory-card').filter({ hasText: restoredText })).toBeVisible()
  } finally {
    await closeApp(restored)
    rmSync(bundleDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
