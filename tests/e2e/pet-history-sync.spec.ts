import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp, startModelServer } from './helpers'

test('[FR-15] deleting the active history clears the open pet chat without restarting', async () => {
  const server = await startModelServer(), app = await launchApp()
  try {
    const main = await findMainPage(app), pet = await findPetPage(app)
    await configureTestModel(main, server.url)
    await main.getByTestId('nav-chat').click()
    await main.getByLabel('新建会话', { exact: true }).click()
    await main.getByTestId('chat-input').fill('这条历史删除后不应留在桌宠窗口')
    await main.getByTestId('chat-send').click()
    await expect(main.locator('.message-row.assistant').last()).toContainText('真实流式回复')
    await pet.locator('.pet-character').click({ button: 'right' })
    await pet.getByRole('button', { name: '打开对话', exact: true }).click()
    await expect(pet.locator('.pet-chat')).toContainText('这条历史删除后不应留在桌宠窗口')
    await main.getByTestId('nav-history').click()
    await main.getByTestId('clear-history').click()
    await main.getByRole('dialog').getByRole('button', { name: '按范围清除' }).click()
    await expect(main.getByTestId('history-item')).toHaveCount(0)
    await expect(pet.locator('.pet-chat')).not.toContainText('这条历史删除后不应留在桌宠窗口')
    await expect(pet.locator('.pet-chat')).not.toContainText('真实流式回复')
    await pet.screenshot({ path: test.info().outputPath('pet-history-cleared.png') })
  } finally { await closeApp(app); await server.close() }
})

test('[FR-02] body taps give tap feedback and the menu explicitly opens and closes chat', async () => {
  const app = await launchApp()
  try {
    await findMainPage(app)
    const pet = await findPetPage(app)
    await expect(pet.getByTestId('live2d-canvas')).toBeVisible()
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Idle')
    const point = await (async () => {
      // 画布读回（createImageBitmap）依赖合成器已产出新帧；窗口被遮挡或首帧尚未合成时
      // 会读到全透明位图。这不是渲染缺陷，重试并把桌宠窗口置前即可稳定采样。
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await pet.bringToFront()
        try {
          return await pet.evaluate(async () => {
            const canvas = document.querySelector<HTMLCanvasElement>('canvas')!
            const bitmap = await createImageBitmap(canvas), rect = canvas.getBoundingClientRect()
            const copy = new OffscreenCanvas(bitmap.width, bitmap.height), context = copy.getContext('2d')!
            context.drawImage(bitmap, 0, 0)
            const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
            const y = Math.floor(bitmap.height * 0.7), xs: number[] = []
            for (let x = 0; x < bitmap.width; x++) if (pixels[(y * bitmap.width + x) * 4 + 3] > 200) xs.push(x)
            if (!xs.length) throw new Error('No opaque body pixels in the real default model')
            return { x: rect.left + xs[Math.floor(xs.length / 2)] / bitmap.width * rect.width, y: rect.top + y / bitmap.height * rect.height }
          })
        } catch (error) {
          if (attempt === 19) throw error
          await pet.waitForTimeout(150)
        }
      }
      throw new Error('No opaque body pixels in the real default model')
    })()
    await pet.mouse.move(point.x, point.y)
    // Let the native mouse passthrough sampling interval complete before tapping.
    await pet.waitForTimeout(80)
    await pet.mouse.down(); await pet.mouse.up()
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Tap')
    await expect(pet.locator('.pet-chat')).toHaveCount(0)
    await pet.locator('.pet-character').click({ button: 'right' })
    await pet.getByRole('button', { name: '打开对话', exact: true }).click()
    await expect(pet.locator('.pet-chat')).toBeVisible()
    await pet.locator('.pet-character').click()
    await expect(pet.locator('.pet-chat')).toBeVisible()
    await pet.locator('.pet-character').click({ button: 'right' })
    await pet.locator('.pet-menu').getByRole('button', { name: '收起对话', exact: true }).click()
    await expect(pet.locator('.pet-chat')).toHaveCount(0)
    await pet.screenshot({ path: test.info().outputPath('pet-menu-controls-chat.png') })
  } finally { await closeApp(app) }
})
