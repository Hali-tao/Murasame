import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConversationService } from '../../src/main/core/services/conversation-service'
import { copyVerifiedImage, drawIsolatedImage, imageWhereabouts, petSpeech, poseIntent, routeUtterance, solidPng, writeHostImage } from '../../src/main/agent/teammates'
import { findSkill, rememberSkill, skillFits } from '../../src/main/agent/skills'
import { MemoryDatabase } from '../helpers/memory-db'

const model = {
  id: 'model-1',
  name: '测试',
  provider: 'openai',
  endpoint: 'http://127.0.0.1:9/v1',
  key: '',
  hasKey: true,
  model: 'demo',
  caps: [],
  capabilities: [],
  probeNote: '',
  status: '在线' as const,
  tone: 'blue' as const,
  default: true,
  latency: '—',
  apiKey: 'test'
}

describe('队友分流', () => {
  it('生成图片不会交给闲聊', () => {
    const route = routeUtterance('你能不能帮我在桌面随便生成一张图片')
    expect(route.teammate).toBe('command')
    expect(route.kind).toBe('draw-image')
    expect(route.say).toContain('你的电脑')
  })

  it('整理文件、看屏幕、打开网页各走各的队友', () => {
    expect(routeUtterance('帮我把桌面的文件整理一下').teammate).toBe('files')
    expect(routeUtterance('看看我现在的屏幕').teammate).toBe('screen')
    expect(routeUtterance('打开 https://example.com').teammate).toBe('isolation')
    expect(routeUtterance('画图').kind).toBe('draw-image')
    expect(routeUtterance('图片在哪里').kind).toBe('draw-status')
    expect(routeUtterance('今天天气怎么样').kind).toBe('chat')
    expect(routeUtterance('你帮我在桌面生成一个太阳的照片好吗').kind).toBe('draw-image')
    expect(routeUtterance('今天天气怎么样').teammate).toBe('chat')
    expect(routeUtterance('不要放桌面，放到图片文件夹').kind).toBe('correct-draw')
    expect(poseIntent('fail')).toBe('否定')
    expect(poseIntent('wait')).toBe('困惑')
    expect(poseIntent('act')).toBe('惊讶')
    expect(petSpeech('有可能，但我不确定。后面还有很长的解释，桌宠不念。')).toBe('有可能，但我不确定。')
  })

  it('图片在哪里按任务单回答，不另编一句', () => {
    expect(imageWhereabouts([]).say).toContain('还没有写过')
    expect(imageWhereabouts([{
      status: '等待批准',
      summary: '等你确认',
      result: '还没有写文件。',
      approval: { tool: 'copy-image', target: 'C:\\Users\\a\\Desktop\\murasame-画.png' }
    }]).say).toContain('还没写')
    const done = imageWhereabouts([
      {
        status: '等待批准',
        summary: '新的还在等',
        result: '还没有写。',
        approval: { tool: 'copy-image', target: '桌面' }
      },
      {
        status: '已完成',
        summary: '已拷到桌面',
        result: '文件在 C:\\Users\\a\\Desktop\\murasame-画.png，120 字节。',
        approval: { tool: 'copy-image', target: '桌面' }
      }
    ])
    expect(done.say).toContain('还没写')
    expect(imageWhereabouts([{
      status: '已完成',
      summary: '已拷到桌面',
      result: '文件在 C:\\Users\\a\\Desktop\\murasame-画.png，120 字节。',
      approval: null
    }]).say).toContain('murasame-画.png')
  })

  it('对话模型不会抢答生成图片', async () => {
    const db = new MemoryDatabase()
    let called = false
    const gateway = {
      chat: async () => {
        called = true
        return '我没有这个能力'
      }
    }
    const service = new ConversationService(db, { getDefault: () => model, markOffline() {}, markVerified() {} }, gateway, {
      handleTeammate: async () => ({ say: '命令画好了，要拷到桌面再点允许。' })
    })
    const created = service.create()
    const sent = await service.send(created.id, '在桌面生成一张图片')
    expect(called).toBe(false)
    expect(sent.ok).toBe(true)
    if (sent.ok) expect(sent.data.messages.some((item) => item.text.includes('点允许'))).toBe(true)
  })
})

describe('写到这台电脑上的图', () => {
  it('批准后的文件写在指定路径，并且大小大于 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'murasame-host-'))
    const target = join(dir, 'murasame-画.png')
    try {
      const written = writeHostImage(target, solidPng(8, 8))
      expect(written.ok).toBe(true)
      if (written.ok) expect(statSync(written.path).size).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('隔离环境里的图', () => {
  it('容器没开时不说已经画好', () => {
    const drawn = drawIsolatedImage({ running: () => false, exec: () => '' })
    expect(drawn.ok).toBe(false)
  })

  it('核对者只相信文件大小，不相信命令自己的说法', () => {
    const png = solidPng(8, 8)
    let stored = Buffer.alloc(0)
    const drawn = drawIsolatedImage({
      running: () => true,
      exec: (command) => {
        if (command[0] === 'python3') {
          const hex = /fromhex\('([0-9a-f]+)'\)/.exec(command[2] ?? '')?.[1] ?? ''
          stored = Buffer.from(hex, 'hex')
          return ''
        }
        if (command[0] === 'stat') return '0'
        return ''
      }
    }, png)
    expect(stored.length).toBeGreaterThan(0)
    expect(drawn.ok).toBe(false)
  })

  it('大小对得上才算画好，拷贝后再核对宿主机上的文件', () => {
    const png = solidPng(8, 8)
    const drawn = drawIsolatedImage({
      running: () => true,
      exec: (command) => command[0] === 'stat' ? String(png.length) : ''
    }, png)
    expect(drawn.ok).toBe(true)
    const dir = mkdtempSync(join(tmpdir(), 'murasame-copy-'))
    const target = join(dir, 'murasame-画.png')
    try {
      const copied = copyVerifiedImage('/home/murasame/murasame-draw.png', target, (_from, to) => {
        writeFileSync(to, png)
      }, (path) => statSync(path).size)
      expect(copied.ok).toBe(true)
      if (copied.ok) expect(readFileSync(copied.path).length).toBe(png.length)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('技能', () => {
  it('记下的做法可以再读到，同一种只留还在用的那条', () => {
    const dir = mkdtempSync(join(tmpdir(), 'murasame-skill-'))
    const base = {
      kind: 'draw-image' as const,
      steps: '隔离环境里写 PNG',
      check: '非空',
      allowedTools: ['command'],
      workspace: 'isolation' as const,
      superseded: false,
      lastFailure: '',
      createdAt: 't0'
    }
    try {
      const verified = { taskId: 'verified-picture', status: '已完成' as const, evidence: [{ kind: 'fs-hash' as const, target: 'picture.png', expected: 'known-hash', actual: 'known-hash', matched: true }] }
      expect(() => rememberSkill(dir, { ...base, id: 'unverified' })).toThrow(/核验/)
      rememberSkill(dir, { ...base, id: 'old' }, verified)
      rememberSkill(dir, { ...base, id: 'new', createdAt: 't1' }, verified)
      expect(findSkill(dir, 'draw-image')?.id).toBe('new')
      expect(skillFits(findSkill(dir, 'draw-image')!, ['command'], { workspace: 'isolation' })).toBe(true)
      expect(skillFits({ ...base, verification: verified, id: 'wide', allowedTools: ['command', 'host-write'] }, ['command'], { workspace: 'isolation' })).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
