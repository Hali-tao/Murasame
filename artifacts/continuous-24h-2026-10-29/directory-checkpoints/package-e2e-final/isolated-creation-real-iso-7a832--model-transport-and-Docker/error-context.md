# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: isolated-creation.spec.ts >> real isolated creation >> office through actual UI, IPC, model transport and Docker
- Location: tests\e2e\isolated-creation.spec.ts:11:55

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByAltText('离线隔离桌面实时画面')
Expected: visible
Timeout: 70000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByAltText('离线隔离桌面实时画面') with timeout 70000ms
  - waiting for getByAltText('离线隔离桌面实时画面')

```

```yaml
- complementary:
  - text: m murasame 桌面伙伴
  - navigation "主导航":
    - text: 对话
    - link "交流":
      - /url: "#/chat"
    - link "历史":
      - /url: "#/history"
    - link "长期记忆":
      - /url: "#/memory"
    - link "任务":
      - /url: "#/tasks"
    - text: 角色
    - link "角色设置":
      - /url: "#/character"
    - text: 设置
    - link "运行与隐私":
      - /url: "#/settings"
    - link "模型服务":
      - /url: "#/models"
    - link "工具与插件":
      - /url: "#/tools"
    - link "屏幕辅助":
      - /url: "#/screen"
    - link "自主活动":
      - /url: "#/autonomy"
    - link "概览":
      - /url: "#/"
  - text: 未
  - strong: 未命名
  - text: 运行中 · 本地加密 v0.9.0 · 本机运行
- banner:
  - heading "自主活动" [level=1]
  - paragraph: 在隔离桌面中观察和创作，可随时停止
  - text: 02:07 · 10月30日 模型服务在线
  - button "隐藏桌宠"
  - button "隐藏到托盘"
- main:
  - strong: 隔离环境会在开始时自动准备
  - text: 开始活动时会准备隔离运行环境。
  - heading "这次活动" [level=2]
  - paragraph: 开始前先确认范围，活动中不会改到你正在用的窗口
  - text: 活动未开始
  - paragraph: 正在启动运行环境，第一次大约一两分钟。
  - text: 活动类型
  - combobox "活动类型 根据目标生成文字文档，用LibreOffice保存、回读和审阅，完成后可导出ODT。" [disabled]:
    - option "浏览网页"
    - option "看视频"
    - option "办公文档" [selected]
    - option "Python编程"
  - text: 根据目标生成文字文档，用LibreOffice保存、回读和审阅，完成后可导出ODT。 允许隔离桌面联网 关掉之后，隔离桌面连不上外网。
  - switch "允许隔离桌面联网" [disabled]
  - text: 我确认只在隔离桌面里活动 不会读取宿主文件。创作目标会发送给默认文字模型；隔离桌面联网另行控制。
  - switch "我确认只在隔离桌面里活动" [checked] [disabled]
  - button "停止活动"
  - button "开始活动" [disabled]
  - heading "在隔离桌面里做什么" [level=2]
  - paragraph: 活动开始后才能操作
  - text: 创作目标
  - textbox "创作目标 先生成，再真实执行和独立审阅，最多修订一次。Python仅使用标准库、不能启动子进程；这不是通用项目开发入口。 开始创作" [disabled]:
    - /placeholder: 例如：写一份三天的复习安排，包含每天目标和验收方法
  - text: 先生成，再真实执行和独立审阅，最多修订一次。Python仅使用标准库、不能启动子进程；这不是通用项目开发入口。
  - button "开始创作" [disabled]
  - button "让模型看一眼桌面" [disabled]
  - paragraph: 此按钮会发送截图，需先在设置中允许；下方实时画面仅在本机查看。
  - paragraph: 独立于任务
  - heading "隔离桌面画面" [level=2]
  - paragraph: 活动开始后显示真实隔离桌面
  - text: 活动开始后显示容器桌面。
  - heading "活动记录" [level=2]
  - paragraph: 网页里的文字只当作看到的内容，不会当成指令执行
  - text: 雨
  - strong: 还没有记录
  - paragraph: 它每看一眼、每动一下，都会在这里留下一条，并注明有没有用新画面核验过。
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { createHash } from 'node:crypto'
  3  | import { readFileSync, existsSync } from 'node:fs'
  4  | import { join } from 'node:path'
  5  | import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp, startModelServer, testUserData } from './helpers'
  6  |
  7  | // Opt in because these cases use real Docker/LibreOffice/code-server, never a
  8  | // host process substitute. All profiles and exports are independent fixtures.
  9  | test.describe('real isolated creation', () => {
  10 |   test.skip(process.env.MURASAME_E2E_ISOLATION !== '1', 'Requires the verified schema-3 Docker image')
  11 |   for (const kind of ['office', 'code'] as const) test(`${kind} through actual UI, IPC, model transport and Docker`, async () => {
  12 |     test.setTimeout(180_000)
  13 |     let drafts = 0; let reviews = 0
  14 |     const candidate = kind === 'office'
  15 |       ? { title: '合成验收文档', content: '第一步：准备  独立资料。\n\t第二步：执行测试。\n验收：检查结果和文件。', expectedOutput: '' }
  16 |       : { title: '平方和验收', content: 'print(sum(i*i for i in range(1, 11)))', expectedOutput: '385' }
  17 |     const server = await startModelServer({ toolResponse(tool, messages) {
  18 |       if (tool === 'get_color') return { color: '蓝色' }
  19 |       if (tool === 'create_isolated_artifact') { drafts++; return candidate }
  20 |       if (tool === 'review_isolated_artifact') {
  21 |         reviews++
  22 |         const input = JSON.parse(String(messages.filter(item => item.role === 'user').at(-1)?.content))
  23 |         expect(input.kind).toBe(kind); expect(input.evidence.text).toContain(kind === 'code' ? 'print' : '合成验收')
  24 |         return { accepted: true, reason: '受控模型边界：已检查实际文件和输出' }
  25 |       }
  26 |       return undefined
  27 |     } })
  28 |     const app = await launchApp()
  29 |     try {
  30 |       const page = await findMainPage(app)
  31 |       const pet = await findPetPage(app)
  32 |       await configureTestModel(page, server.url, '创作边界验收服务')
  33 |       await page.getByTestId('nav-autonomy').click()
  34 |       await page.getByRole('combobox').selectOption(kind === 'office' ? '办公' : '写代码')
  35 |       await page.getByRole('switch', { name: '允许隔离桌面联网', exact: true }).click()
  36 |       await page.getByRole('switch', { name: '我确认只在隔离桌面里活动', exact: true }).click()
  37 |       await page.getByTestId('autonomy-start').click()
  38 |       await expect(page.getByTestId('autonomy-create')).toBeDisabled()
> 39 |       await expect(page.getByAltText('离线隔离桌面实时画面')).toBeVisible({ timeout: 70_000 })
     |                                                     ^ Error: expect(locator).toBeVisible() failed
  40 |       expect(await page.getByAltText('离线隔离桌面实时画面').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  41 |       await page.getByRole('textbox', { name: '创作目标', exact: false }).fill(kind === 'office' ? '写一份独立测试安排' : '计算1到10的平方和')
  42 |       await page.getByTestId('autonomy-create').click()
  43 |       await expect(page.getByTestId('autonomy-export')).toBeEnabled({ timeout: 70_000 })
  44 |       // This pet state comes from the real service and container result, unlike
  45 |       // the separate stage-transition fixture in pet-work.spec.ts.
  46 |       await expect(pet.getByTestId('pet-isolation-progress')).toContainText('产物已核验，待保存')
  47 |       await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-source', 'autonomy')
  48 |       await pet.screenshot({ path: test.info().outputPath(`${kind}-real-result-pet.png`) })
  49 |       expect(drafts).toBe(1); expect(reviews).toBe(1)
  50 |       await page.getByTestId('nav-overview').click(); await page.getByTestId('nav-autonomy').click()
  51 |       await expect(page.getByRole('combobox')).toHaveValue(kind === 'office' ? '办公' : '写代码')
  52 |       await expect(page.getByTestId('autonomy-export')).toBeEnabled()
  53 |       await page.getByRole('button', { name: '让模型看一眼桌面', exact: true }).click()
  54 |       await expect(page.locator('.autonomy-status')).toContainText('需要先允许发送截图')
  55 |       await expect(page.getByTestId('autonomy-export')).toBeEnabled()
  56 |       const status = await page.evaluate(() => window.murasame.autonomy.status())
  57 |       expect(status.allowNetwork).toBe(false)
  58 |       const artifact = status.creation!.artifact!
  59 |       expect(artifact.preview).toBe(kind === 'office' ? `${candidate.title}\n${candidate.content}` : candidate.content)
  60 |       await page.getByAltText('离线隔离桌面实时画面').screenshot({ path: test.info().outputPath(`${kind}-offline-live-desktop.png`) })
  61 |       const destination = join(testUserData(app), artifact.name)
  62 |       // Only substitute the native picker result. Production handler/service
  63 |       // still validate the current artifact, read the container and write wx.
  64 |       await app.evaluate(({ dialog }, filePath) => {
  65 |         dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  66 |       }, destination)
  67 |       await page.getByTestId('autonomy-export').click()
  68 |       await expect(page.locator('.autonomy-status')).toContainText('已保存到', { timeout: 15000 })
  69 |       await expect(pet.getByTestId('pet-isolation-progress')).toContainText('产物已保存')
  70 |       await expect(pet.getByTestId('pet-isolation-progress')).toContainText(destination)
  71 |       await pet.screenshot({ path: test.info().outputPath(`${kind}-saved-result-pet.png`) })
  72 |       expect(existsSync(destination)).toBe(true)
  73 |       expect(createHash('sha256').update(readFileSync(destination)).digest('hex')).toBe(artifact.sha256)
  74 |       await page.getByTestId('autonomy-export').click()
  75 |       await expect(page.locator('.autonomy-status')).toContainText('没有覆盖', { timeout: 15000 })
  76 |       await page.screenshot({ path: test.info().outputPath(`${kind}-verified-export.png`), fullPage: true })
  77 |       await page.getByTestId('autonomy-stop').click()
  78 |       await expect(page.getByAltText('离线隔离桌面实时画面')).toHaveCount(0)
  79 |       await expect(pet.getByTestId('pet-isolation-progress')).toHaveCount(0)
  80 |       await expect(page.getByTestId('autonomy-export')).toBeDisabled()
  81 |       expect((await page.evaluate(id => window.murasame.autonomy.exportArtifact(id), artifact.id)).ok).toBe(false)
  82 |     } finally { await closeApp(app); await server.close() }
  83 |   })
  84 | })
  85 |
```
