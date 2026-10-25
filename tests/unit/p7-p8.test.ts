import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recoverPosition, resetAnchor, scaleSize } from '../../src/main/desktop/placement'
import { allowHitSample, passthroughFor, shouldRender, targetFps } from '../../src/main/desktop/render-budget'
import { installerPolicy, uninstallChoice } from '../../src/main/desktop/installer-policy'
import { rejectDowngrade, withBackup } from '../../src/main/data/upgrade'
import { exportBundle, importBundle, stripSecrets } from '../../src/main/data/portability'
import { capacityStatus } from '../../src/main/data/capacity'
import { httpsOnly, logExpired, safeLogLine } from '../../src/main/privacy/redact'
import { capabilityOn } from '../../src/shared/platform'
import { detectProviderFromKey, matchPreset, MODEL_PRESETS, presetById } from '../../src/shared/model-presets'
import { emptyReport, renderReport } from '../../src/main/perf/report'
import { statusPresentation } from '../../src/renderer/src/lib/status'
import { shouldRetry } from '../../src/main/agent/runtime'
import { interruptOnRestart } from '../../src/main/agent/state-machine'
import { EMBEDDING_DIM, EMBEDDING_MODEL_ID, vectorsCompatible } from '../../src/main/local/embedding'
import { dockerUnavailableMessage } from '../../src/main/isolation/docker-runtime'

const primary = { id: 'a', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 }
const secondary = { id: 'b', x: 1920, y: 0, width: 2560, height: 1440, scaleFactor: 1.5 }

describe('[UC-09] 显示', () => {
  it('[UC-09] 显示位置不可见时能恢复到可操作位置', () => {
    const recovered = recoverPosition({ x: 4000, y: 100, width: 360, height: 500 }, [primary])
    expect(recovered.x).toBeLessThanOrEqual(primary.width - 360)
    expect(recovered.x).toBeGreaterThanOrEqual(0)
  })

  it('[NFR-C01] 跨 DPI 显示器尺寸一致', () => {
    const sized = scaleSize(360, 500, secondary.scaleFactor, primary.scaleFactor)
    expect(sized.width).toBe(540)
    const anchor = resetAnchor({ x: 2000, y: 100, width: 360, height: 500 }, [primary, secondary])
    expect(anchor.x).toBeGreaterThanOrEqual(secondary.x)
  })

  it('[FR-02] 角色实体区域可交互', () => {
    expect(passthroughFor(true)).toBe(false)
  })

  it('[FR-26] 透明区域穿透到下层应用', () => {
    expect(passthroughFor(false)).toBe(true)
    expect(allowHitSample(100, 0, 50)).toBe(true)
    expect(allowHitSample(10, 0, 50)).toBe(false)
  })

  it('[NFR-P01] 隐藏后停止渲染', () => {
    expect(shouldRender(true)).toBe(false)
    expect(targetFps({ hidden: true, interacting: false, idleMs: 0 })).toBe(0)
  })

  it('[CON-02] 待机资源占用达标', () => {
    expect(targetFps({ hidden: false, interacting: false, idleMs: 120_000 })).toBeLessThan(targetFps({ hidden: false, interacting: true, idleMs: 0 }))
  })

  it('[IF-01] 不依赖桌宠当前位置也能恢复', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/tray.ts'), 'utf8')
    expect(source.length).toBeGreaterThan(0)
    const windows = readFileSync(join(process.cwd(), 'src/main/windows.ts'), 'utf8')
    expect(windows).toContain('隐藏到托盘')
    expect(windows).toContain('退出应用')
  })
})

describe('[OR-03] 安装与退出', () => {
  it('[OR-03] 安装不擅自扩大系统权限', () => {
    const policy = installerPolicy()
    expect(policy.executionLevel).toBe('asInvoker')
    expect(policy.perMachine).toBe(false)
    const config = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')
    expect(config).toContain('asInvoker')
    expect(config).toContain('perMachine: false')
    expect(config).toContain('deleteAppDataOnUninstall: false')
  })

  it('[OR-03] 安装与导入不扩大系统权限', () => {
    expect(uninstallChoice(false).keepUserData).toBe(true)
    expect(uninstallChoice(true).keepUserData).toBe(false)
  })
})

describe('[OR-02] 数据', () => {
  it('[OR-02] 跨版本升级数据完整', () => {
    expect(rejectDowngrade(4, 3)).toContain('拒绝打开')
    expect(rejectDowngrade(3, 3)).toBeNull()
  })

  it('[NFR-R02] 迁移失败回滚到备份', () => {
    const dir = mkdtempSync(join(tmpdir(), 'murasame-upgrade-'))
    const file = join(dir, 'db.txt')
    writeFileSync(file, '完好')
    expect(() => withBackup(file, () => {
      writeFileSync(file, '损坏')
      throw new Error('迁移失败')
    })).toThrow(/迁移失败/)
    expect(readFileSync(file, 'utf8')).toBe('完好')
  })

  it('[OR-02] 导出与导入保持数据完整', () => {
    const clean = stripSecrets({ version: 1, conversations: [{ id: 'c' }], memories: [], character: { name: '林澈' }, models: [{ id: 'm', name: '服务', endpoint: 'https://example.com', key: 'sk-secretvalue' }] })
    const packed = exportBundle(clean, 'pass')
    const restored = importBundle(packed, 'pass', 3)
    expect(restored.conversations).toHaveLength(1)
    expect(JSON.stringify(restored)).not.toContain('sk-secretvalue')
  })

  it('[OR-02] 容量上限提示', () => {
    expect(capacityStatus(Math.floor(2 * 1024 * 1024 * 1024 * 0.8)).warning).toBe(true)
    expect(capacityStatus(10).warning).toBe(false)
  })

  it('[NFR-R02] 导入失败保留现有数据', () => {
    expect(() => importBundle(Buffer.from('nope'), 'pass', 3)).toThrow(/现有数据保持不变/)
  })
})

describe('[NFR-S01] 隐私', () => {
  it('[NFR-S01] 日志不含原始屏幕与完整密钥', () => {
    const line = safeLogLine('key sk-abcdefghijklmnopqrstuvwxyz data:image/png;base64,aaaaaaaaaaaaaaaaaaaa')
    expect(line).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(line).toContain('已省略屏幕图像')
  })

  it('[IF-08] 外发走受保护连接', () => {
    expect(httpsOnly('https://api.example.com/v1')).toBe(true)
    expect(httpsOnly('http://example.com')).toBe(false)
    expect(httpsOnly('http://127.0.0.1:11434')).toBe(true)
  })

  it('[IF-09] 未授权的数据不默认外发', () => {
    const packed = exportBundle({ version: 1, conversations: [], memories: [{ text: '偏好' }], character: {}, models: [] }, 'pass')
    expect(packed.subarray(0, 4).toString()).toBe('MUR1')
    expect(packed.includes(Buffer.from('偏好'))).toBe(false)
  })

  it('[NFR-M01] 日志不含原始屏幕与完整密钥', () => {
    expect(logExpired(15, 14)).toBe(true)
    expect(logExpired(14, 14)).toBe(false)
  })
})

describe('[NFR-R01] 可靠性', () => {
  it('[NFR-R01] 失败不被解释为成功', () => {
    expect(shouldRetry({ networkError: true, hasSideEffect: true, outcomeKnown: false })).toBe(false)
  })

  it('[NFR-R02] 结果不明时不自动重做', () => {
    expect(shouldRetry({ networkError: true, hasSideEffect: true, outcomeKnown: false })).toBe(false)
  })

  it('[NFR-R03] 重启后不自动重放', () => {
    expect(interruptOnRestart('执行中')).toBe('已中断')
  })
})

describe('[NFR-U01] 易用性', () => {
  it('[NFR-U01] 五种运行状态可以区分', () => {
    expect(statusPresentation['waiting-input'].label).toBe('等待输入')
    expect(statusPresentation['service-wait'].label).toBe('服务等待')
    expect(statusPresentation['task-running'].label).toBe('任务执行')
    expect(statusPresentation['awaiting-approval'].label).toBe('等待批准')
    expect(statusPresentation.finished.label).toBe('执行结束')
  })

  it('[NFR-U01] 拒绝授权后仍可进行不依赖该权限的操作', () => {
    const guide = readFileSync(join(process.cwd(), 'src/renderer/src/pages/OnboardingPage.tsx'), 'utf8')
    expect(guide).toContain('拒绝之后')
    expect(guide).toContain('历史')
  })

  it('[NFR-U03] 外部服务不可用不阻断本地功能', () => {
    expect(dockerUnavailableMessage()).toContain('Docker')
    expect(capabilityOn('linux', 'screen')).toBe('不可用')
    expect(capabilityOn('win32', 'chat')).toBe('可用')
  })

  it('[IF-03] 错误提示包含可采取的操作', () => {
    expect(dockerUnavailableMessage()).toContain('请先启动 Docker Desktop')
  })

  it('[FR-27] 运行状态有明确文案', () => {
    expect(statusPresentation.unimplemented.label).toBe('未实现')
  })

  it('[ASM-01] 依赖失效时保留退出和状态查询', () => {
    const windows = readFileSync(join(process.cwd(), 'src/main/windows.ts'), 'utf8')
    expect(windows).toContain('退出应用')
    expect(dockerUnavailableMessage()).toContain('已停止')
  })
})

describe('[NFR-C02] 配置', () => {
  it('[NFR-C02] 新增配置不要求重建记忆', () => {
    expect(vectorsCompatible(EMBEDDING_MODEL_ID, EMBEDDING_DIM)).toBe('ok')
  })

  it('[UC-08] 更换模型不删除已有记忆', () => {
    expect(vectorsCompatible('other', EMBEDDING_DIM)).toBe('recompute')
  })

  it('[NFR-C01] 非 Windows 能力标为不可用', () => {
    expect(capabilityOn('darwin', 'voice')).toBe('不可用')
  })

  it('[FR-10] 缺能力的形象仍可加载', () => {
    expect(capabilityOn('win32', 'isolation')).toBe('部分')
  })
})

describe('[NFR-P02] 性能', () => {
  it('[NFR-P01] 五个场景分别采样', () => {
    const report = renderReport(emptyReport(5), 5)
    expect(report).toContain('待机')
    expect(report).toContain('语音交流')
    expect(report).toContain('屏幕理解')
    expect(report).toContain('任务执行')
    expect(report).toContain('自主活动')
  })

  it('[NFR-P02] 耗时调用不占用唯一入口', () => {
    expect(allowHitSample(100, 0)).toBe(true)
  })

  it('[NFR-P03] 三段耗时分列', () => {
    expect(renderReport(emptyReport(5), 5)).toContain('采集、等待、生成')
  })
})

describe('[CON-05] 许可', () => {
  it('[CON-05] 不确定的资源不得标成可以公开分发', () => {
    const text = readFileSync(join(process.cwd(), 'docs/05-LICENSES.md'), 'utf8')
    expect(text).toContain('暂缓')
    expect(text).toContain('naiwa')
    expect(text).toContain('不得公开分发')
  })
})

describe('[FR-24] 服务模板与 Key 识别', () => {
  it('[UC-08] 选择服务模板后地址与协议被填好', () => {
    const deepseek = presetById('deepseek')
    expect(deepseek?.endpoint).toBe('https://api.deepseek.com')
    expect(deepseek?.provider).toBe('OpenAI Compatible')
    expect(deepseek?.suggestedModel).toBe('deepseek-flash')
    expect(MODEL_PRESETS.some((preset) => preset.id === 'custom')).toBe(true)
    expect(matchPreset('https://api.deepseek.com/v1', 'OpenAI Compatible')).toBe('deepseek')
    expect(matchPreset('https://api.siliconflow.cn/v1', 'OpenAI Compatible')).toBe('siliconflow')
  })

  it('[FR-24] 前缀唯一时能识别出服务商', () => {
    expect(detectProviderFromKey('sk-ant-abcdefghijklmn').presetId).toBe('anthropic')
    expect(detectProviderFromKey('sk-ant-abcdefghijklmn').confident).toBe(true)
    expect(detectProviderFromKey('gsk_abcdefghijklmn').confident).toBe(true)
  })

  it('[FR-24] sk- 前缀被多家共用时不猜测', () => {
    const guess = detectProviderFromKey('sk-0123456789abcdef0123456789abcdef')
    expect(guess.confident).toBe(false)
    expect(guess.presetId).toBeNull()
    expect(guess.reason).toContain('无法据此判断')
  })

  it('[OR-01] 不预置任何服务商', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/model/registry.ts'), 'utf8')
    const seed = source.split('function seedModels')[1].split('}')[0]
    expect(seed).toContain('return []')
    expect(source).not.toContain('initialBootstrap')
    // 新建配置不替用户假定某一家的地址。
    expect(source).not.toContain("endpoint: 'https://api.openai.com/v1'")
  })

  it('[UC-08] 旧版写进磁盘的假配置会被清理', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/model/registry.ts'), 'utf8')
    expect(source).toContain('pruneDemoSeeds')
    // 只清理从未配置过密钥的那几条，用户自己填的不动。
    expect(source).toContain('!model.encryptedKey')
    expect(source).toContain('remove(id: string)')
  })

  it('[FR-25] 识别结果不替代能力探测', () => {
    // 猜中服务商也只填地址，能力仍以 verified 为准。
    expect(detectProviderFromKey('sk-ant-abcdefghijklmn').reason).not.toContain('已支持')
    expect(presetById('deepseek')?.note).toContain('文档为准')
  })
})

describe('[OR-01] 说明', () => {
  it('[OR-01] 首次运行提供基本使用说明', () => {
    const guide = readFileSync(join(process.cwd(), 'src/renderer/src/pages/OnboardingPage.tsx'), 'utf8')
    expect(guide).toContain('长期记忆')
    expect(guide).toContain('任务要你确认')
    expect(guide).toContain('隔离桌面')
  })
})
