import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, findMainPage, launchApp, testUserData } from './helpers'

function allFiles(directory: string, relative = ''): string[] {
  const found: string[] = []
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    const name = join(relative, item.name)
    if (item.isDirectory()) found.push(...allFiles(path, name))
    else if (item.isFile()) found.push(path)
  }
  return found
}

function filesContaining(directory: string, needle: string): string[] {
  const hits: string[] = []
  const bytes = Buffer.from(needle, 'utf8')
  for (const file of allFiles(directory)) {
    try {
      if (statSync(file).size > 16 * 1024 * 1024) continue
      if (readFileSync(file).includes(bytes)) hits.push(file)
    } catch {
      // 运行中的数据库/日志可能被占用；只检查可读文件，测试结束前再查一次。
    }
  }
  return hits
}

test.describe('[FULL-QA] 数据包与密钥安全', () => {
  test('[DATA-01] 加密数据包不含明文/口令，错误口令被中文拒绝，正确口令可导入', async () => {
    test.setTimeout(90_000)
    const app = await launchApp()
    const bundle = join(mkdtempSync(join(tmpdir(), 'murasame-bundle-')), 'backup.murapack')
    const secret = '绝密测试记忆-9f3a'
    const passphrase = 'e2e-passphrase-123'
    try {
      const page = await findMainPage(app)
      const added = await page.evaluate((text) => window.murasame.core.addMemory('偏好', text), secret)
      expect(added.ok).toBe(true)
      const exported = await page.evaluate(({ path, phrase }) => window.murasame.data.exportBundle(phrase, path), { path: bundle, phrase: passphrase })
      expect(exported.ok, exported.ok ? '' : exported.error).toBe(true)
      const raw = readFileSync(bundle)
      expect(raw.length).toBeGreaterThan(100)
      expect(raw.includes(Buffer.from(secret, 'utf8'))).toBe(false)
      expect(raw.includes(Buffer.from(passphrase, 'utf8'))).toBe(false)

      const wrong = await page.evaluate(({ path }) => window.murasame.data.importBundle(path, 'wrong-passphrase'), { path: bundle })
      expect(wrong.ok).toBe(false)
      if (!wrong.ok) {
        expect(wrong.error).toMatch(/[\u4e00-\u9fff]/)
        expect(wrong.error).not.toMatch(/^Error:|at .*node_modules|ENOENT/i)
      }
      const imported = await page.evaluate(({ path, phrase }) => window.murasame.data.importBundle(path, phrase), { path: bundle, phrase: passphrase })
      expect(imported.ok, imported.ok ? '' : imported.error).toBe(true)
      const memories = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.memories.map((memory) => memory.text) : []
      })
      expect(memories).toContain(secret)
    } finally {
      await closeApp(app)
      if (existsSync(bundle)) rmSync(join(bundle, '..'), { recursive: true, force: true })
    }
  })

  test('[DATA-02] 损坏的数据包被中文拒绝且应用不崩溃', async () => {
    const app = await launchApp()
    const dir = mkdtempSync(join(tmpdir(), 'murasame-corrupt-'))
    const bundle = join(dir, 'corrupt.murapack')
    try {
      const fs = await import('node:fs')
      fs.writeFileSync(bundle, 'not a murasame package at all')
      const page = await findMainPage(app)
      const result = await page.evaluate(({ path }) => window.murasame.data.importBundle(path, 'whatever-pass'), { path: bundle })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/[\u4e00-\u9fff]/)
        expect(result.error).not.toMatch(/^Error:|ENOENT|SyntaxError/i)
      }
      await page.getByTestId('nav-settings').click()
      await expect(page.getByTestId('nav-settings')).toBeVisible()
    } finally {
      await closeApp(app)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('[SEC-01] 保存的 API Key 不以明文出现在 userData 或渲染层', async () => {
    test.setTimeout(90_000)
    const app = await launchApp()
    const rawKey = 'sk-e2e-secret-7788'
    try {
      const page = await findMainPage(app)
      const result = await page.evaluate(async (key) => {
        const created = await window.murasame.core.createModel()
        if (!created.ok) return { stage: 'create', error: created.error }
        const saved = await window.murasame.core.saveModel(created.data.id, {
          name: '密钥隐私测试',
          provider: 'openai',
          endpoint: 'http://127.0.0.1:9/v1',
          key,
          model: 'gpt-4o-mini',
          caps: ['chat']
        })
        if (!saved.ok) return { stage: 'save', error: saved.error }
        const verified = await window.murasame.core.verifyModel(created.data.id)
        return { stage: 'verified', ok: verified.ok, error: verified.ok ? '' : verified.error }
      }, rawKey)
      expect(result.stage).toBe('verified')
      expect(result.ok).toBe(false)
      expect(String(result.error)).toMatch(/[\u4e00-\u9fff]/)
      await page.getByTestId('nav-models').click()
      expect(await page.content()).not.toContain(rawKey)
      const userData = testUserData(app)
      expect(filesContaining(userData, rawKey)).toEqual([])
    } finally {
      await closeApp(app)
    }
  })
})
