import { Download, FolderOpen, HelpCircle, Power, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DeleteScope, Permissions } from '@shared/types'
import { ClearScopeDialog } from '../components/dialogs'
import { OcrSettings } from '../components/OcrSettings'
import { Button, Card, CardHead, ConfirmDialog, Field, Input, Modal, Pill, ToggleRow } from '../components/ui'
import { StatusPill } from '../components/StatusPill'
import { PLATFORM_CAPABILITIES } from '@shared/platform'
import { downloadJson } from '../lib/utils'
import { useAppStore } from '../store'

export function SettingsPage(): React.JSX.Element {
  const data = useAppStore((state) => state.data)!
  const info = useAppStore((state) => state.info)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const notify = useAppStore((state) => state.notify)
  const [movingStorage, setMovingStorage] = useState(false)
  const changeStorage = async (): Promise<void> => {
    setMovingStorage(true)
    try { await window.murasame.app.changeStorageLocation() }
    catch (error) { notify(String(error), 'amber') }
    finally { setMovingStorage(false) }
  }
  const [clearOpen, setClearOpen] = useState(false)
  const [plainOpen, setPlainOpen] = useState(false)
  const [bundle, setBundle] = useState<null | { mode: 'export' | 'import'; path: string; passphrase: string }>(null)
  const [quitOpen, setQuitOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [busyClear, setBusyClear] = useState(false)
  const [hotkey, setHotkey] = useState('正在读取快捷键')
  const [screenHotkey, setScreenHotkey] = useState('正在读取快捷键')
  const [screenHotkeyDraft, setScreenHotkeyDraft] = useState(data.settings.screenHotkey)
  const [savingScreenHotkey, setSavingScreenHotkey] = useState(false)
  const [hotkeyDraft, setHotkeyDraft] = useState(data.settings.petHotkey)
  const [voiceDetail, setVoiceDetail] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const runningTasks = data.tasks.filter((task) => task.status === '执行中' || task.status === '等待批准')

  useEffect(() => {
    void window.murasame.app.screenHotkey().then(setScreenHotkey)
    void window.murasame.app.hotkey().then(setHotkey)
    void window.murasame.voice.readiness().then((ready) => setVoiceDetail(ready.detail))
  }, [])

  const update = async (patch: Parameters<typeof updateSettings>[0]): Promise<void> => {
    await updateSettings(patch)
  }

  const applyHotkeyDraft = async (): Promise<void> => {
    const wanted = hotkeyDraft.trim()
    await updateSettings({ petHotkey: wanted })
    const [status, current] = await Promise.all([window.murasame.app.hotkey(), window.murasame.settings.get()])
    setHotkey(status)
    if (current.petHotkey === wanted) notify('快捷键已更换', 'green')
    else {
      setHotkeyDraft(current.petHotkey)
      await updateSettings({ petHotkey: current.petHotkey })
      notify(status, 'amber')
    }
  }

  const applyScreenHotkeyDraft = async (): Promise<void> => {
    setSavingScreenHotkey(true)
    try {
      const wanted = screenHotkeyDraft.trim()
      const saved = await updateSettings({ screenHotkey: wanted })
      const status = await window.murasame.app.screenHotkey()
      setScreenHotkey(status)
      if (saved) {
        const current = await window.murasame.settings.get()
        setScreenHotkeyDraft(current.screenHotkey)
        notify(current.screenHotkey === wanted ? '屏幕辅助快捷键已更换' : status, current.screenHotkey === wanted ? 'green' : 'amber')
      }
    } finally { setSavingScreenHotkey(false) }
  }

  const updatePermission = async (key: keyof Permissions, value: boolean): Promise<void> => {
    const saved = await updateSettings({ permissions: { ...data.settings.permissions, [key]: value } })
    if (saved) notify(value ? '权限已授权' : '权限已撤销', value ? 'green' : 'amber')
  }

  const clearData = async (scopes: DeleteScope[]): Promise<void> => {
    setBusyClear(true)
    const failures: string[] = []
    let completed = 0
    const run = async (label: string, action: () => Promise<void>): Promise<void> => {
      try { await action(); completed++ }
      catch (error) { failures.push(`${label}：${error instanceof Error ? error.message : '操作失败，请重试'}`) }
    }
    // Only histories selected when clearing starts are in this operation.
    const histories = useAppStore.getState().data?.conversations ?? []
    try {
      if (scopes.includes('logs')) await run('运行日志', () => window.murasame.app.clearLogs())
      if (scopes.includes('memory')) await run('长期记忆', async () => {
        const result = await window.murasame.core.clearMemories()
        if (!result.ok) throw new Error(result.error)
        useAppStore.setState(state => ({ data: state.data ? { ...state.data, memories: result.data } : null }))
      })
      if (scopes.includes('cache')) await run('本地缓存', async () => {
        const result = await window.murasame.core.deleteConversation('none', ['cache'])
        if (!result.ok) throw new Error(result.error)
      })
      if (scopes.includes('history')) {
        for (const conversation of histories) {
          await run(`对话历史「${conversation.title}」`, async () => {
            const result = await window.murasame.core.deleteConversation(conversation.id, ['history'])
            if (!result.ok) throw new Error(result.error)
            useAppStore.setState(state => ({
              data: state.data ? { ...state.data, conversations: result.data } : null,
              selectedConversationId: result.data.some(item => item.id === state.selectedConversationId)
                ? state.selectedConversationId : result.data[0]?.id ?? null
            }))
          })
        }
      }
      if (failures.length) notify(`${completed ? '部分内容已清除。' : ''}清除未完成：${failures.join('；')}`, 'red')
      else { notify('已按所选范围清除本地数据'); setClearOpen(false) }
    } finally {
      setBusyClear(false)
    }
  }

  const exportData = (): void => {
    downloadJson(`murasame-export-${new Date().toISOString().slice(0, 10)}.json`, {
      exportedAt: new Date().toISOString(),
      settings: data.settings,
      character: data.character,
      conversations: data.conversations,
      memories: data.memories,
      tasks: data.tasks
    })
    setPlainOpen(false)
    notify('已导出未加密的 JSON。里面有完整对话和记忆，请自行保管。', 'amber')
  }

  const exportPackage = async (): Promise<void> => {
    const path = await window.murasame.app.pickSave({
      title: '保存加密数据包',
      defaultPath: `murasame-${new Date().toISOString().slice(0, 10)}.murapack`
    })
    if (!path) return
    setBundle({ mode: 'export', path, passphrase: '' })
  }

  const importPackage = async (): Promise<void> => {
    const path = await window.murasame.app.pickOpen({
      title: '选择数据包',
      filters: [{ name: 'Murasame 数据包', extensions: ['murapack'] }]
    })
    if (!path) return
    setBundle({ mode: 'import', path, passphrase: '' })
  }

  const submitBundle = async (): Promise<void> => {
    if (!bundle || bundle.passphrase.trim().length < 6) {
      notify('口令至少 6 位', 'amber')
      return
    }
    if (bundle.mode === 'export') {
      const result = await window.murasame.data.exportBundle(bundle.passphrase, bundle.path)
      if (!result.ok) {
        notify(result.error, 'red')
        return
      }
      notify(`已导出到 ${bundle.path}。数据包已加密，不含明文密钥。`, 'green')
    } else {
      const result = await window.murasame.data.importBundle(bundle.path, bundle.passphrase)
      if (!result.ok) {
        notify(result.error, 'red')
        return
      }
      // 导入只写了数据库；不重新拉取 bootstrap 的话，恢复的会话/记忆要重启才出现。
      await useAppStore.getState().reloadData()
      notify(`${result.data.note} 新会话 ${result.data.conversations} 个，新记忆 ${result.data.memories} 条`, 'green')
    }
    setBundle(null)
  }

  const checkUpdates = async (): Promise<void> => {
    setCheckingUpdate(true)
    try {
      const result = await window.murasame.updates.check()
      notify(result.message, result.status === 'error' ? 'red' : result.status === 'disabled' ? 'amber' : 'green')
    } catch {
      notify('更新检查失败，请稍后再试', 'red')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const openPath = async (kind: 'logs' | 'userData'): Promise<void> => {
    try {
      if (kind === 'logs') await window.murasame.app.openLogs()
      else await window.murasame.app.openUserData()
    } catch {
      notify('无法打开目录，请检查系统权限', 'red')
    }
  }

  return (
    <div className="page settings-page">
      <div className="runtime-banner">
        <div>
          <StatusPill status="app-running" />
          <strong>Murasame 正在运行</strong>
          <p>隐藏到托盘不会取消任务；退出前会说明运行中活动的状态。</p>
        </div>
        <div className="runtime-actions">
          <Button onClick={() => void window.murasame.app.hideToTray()} icon={<FolderOpen size={15} />}>隐藏到托盘</Button>
          <Button variant="danger" onClick={() => setQuitOpen(true)} icon={<Power size={15} />} data-testid="quit-app">退出应用</Button>
        </div>
      </div>

      <div className="settings-columns">
        <div className="settings-left">
          <Card>
            <CardHead title="运行行为" subtitle="开关与下拉选项修改后立即保存，无需额外点击保存" />
            <ToggleRow title="开机时启动" description="仅在登录后加载轻量控制台。" checked={data.settings.startAtLogin} onCheckedChange={(checked) => void update({ startAtLogin: checked })} />
            <ToggleRow title="最小化到托盘" description="隐藏后仍可从托盘重新唤醒。" checked={data.settings.minimizeToTray} onCheckedChange={(checked) => void update({ minimizeToTray: checked })} />
            <ToggleRow title="忙时免打扰" description="全屏应用或正在输入时暂停主动互动。" checked={data.settings.doNotDisturb} onCheckedChange={(checked) => void update({ doNotDisturb: checked })} />
            <ToggleRow title="回复时朗读" description="桌宠说出回复。关掉后只显示文字。声音不可用时会说明原因。" checked={data.settings.speakReplies} onCheckedChange={(checked) => void update({ speakReplies: checked })} />
            <ToggleRow title="任务完成通知" description="任务失败、需要批准或结束时分别展示。" checked={data.settings.taskNotifications} onCheckedChange={(checked) => void update({ taskNotifications: checked })} />
            <ToggleRow title="桌面小剧场" description="任务进入终态时在桌宠脚边演一句真实结果；可随时关闭，不弹独立窗口。" checked={data.settings.theaterEnabled} onCheckedChange={(checked) => void update({ theaterEnabled: checked })} />
            <Field label="关闭窗口时" className="settings-select-field">
              <select className="select" value={data.settings.closeBehavior} onChange={(event) => void update({ closeBehavior: event.target.value as 'tray' | 'ask' | 'quit' })}>
                <option value="tray">最小化到托盘</option>
                <option value="ask">每次询问</option>
                <option value="quit">询问后退出</option>
              </select>
            </Field>
          </Card>

          <Card>
            <CardHead title="系统权限" subtitle="拒绝授权后仍可使用不依赖该权限的功能" />
            <div className="permission-row">
              <div><strong>屏幕读取</strong><span>由你手动框选并确认，只分析选中区域</span></div>
              <StatusPill status={data.settings.permissions.screen ? 'granted' : 'denied'} />
              <Button size="sm" onClick={() => void updatePermission('screen', !data.settings.permissions.screen)}>{data.settings.permissions.screen ? '撤销' : '申请'}</Button>
            </div>
            <div className="permission-row">
              <div><strong>麦克风</strong><span>本地语音转写；不保留原始录音</span></div>
              <StatusPill status={data.settings.permissions.microphone ? 'granted' : 'denied'} />
              <Button size="sm" onClick={() => void updatePermission('microphone', !data.settings.permissions.microphone)}>{data.settings.permissions.microphone ? '撤销' : '申请'}</Button>
            </div>
            <div className="permission-row">
              <div><strong>辅助功能</strong><span>读取窗口信息与执行已批准操作</span></div>
              <StatusPill status={data.settings.permissions.accessibility ? 'granted' : 'denied'} />
              <Button size="sm" onClick={() => void updatePermission('accessibility', !data.settings.permissions.accessibility)}>{data.settings.permissions.accessibility ? '撤销' : '申请'}</Button>
            </div>
            <p className="fineprint">系统权限可在操作系统设置中撤销，撤销后应用会显示受限状态。日志默认保留 {data.settings.logRetentionDays} 天，不记录完整密钥和原始屏幕。</p>
            <Field label="写图片" className="settings-select-field">
              <select
                className="select"
                value={data.settings.fileApproval ?? 'ask'}
                onChange={(event) => void update({ fileApproval: event.target.value as 'ask' | 'allow' })}
              >
                <option value="ask">每次询问。写到桌面或图片文件夹之前要点允许</option>
                <option value="allow">写图免问。选定之后，画到桌面或图片文件夹不再询问</option>
              </select>
            </Field>

          </Card>
        </div>

        <div className="settings-right">
          <OcrSettings />
          <Card>
            <CardHead title="数据与隐私" subtitle="本地存储 · 清除范围明确" />
            <ToggleRow title="加密本地数据" description="数据库始终加密，不能关闭。" checked disabled onCheckedChange={() => undefined} />
            <ToggleRow title="允许把截图发给模型" description="用于隔离桌面等看图功能。屏幕辅助只发送 OCR 文字，不发送截图，不受此开关影响。" checked={data.settings.outboundImages} onCheckedChange={(checked) => void update({ outboundImages: checked })} />
            <Field label="运行日志保留" hint="日志不记录完整 API Key、原始截图或不必要个人信息。">
              <select className="select" value={data.settings.logRetentionDays} onChange={(event) => void update({ logRetentionDays: Number(event.target.value) })}>
                {[7, 14, 30, 90, 180].map((days) => <option key={days} value={days}>{days} 天</option>)}
              </select>
            </Field>
            <div className="data-actions">
              <Button variant="danger" onClick={() => setClearOpen(true)} icon={<Trash2 size={14} />} data-testid="clear-data">清除历史与记忆…</Button>
              <Button onClick={() => setPlainOpen(true)} icon={<Download size={14} />}>导出我的数据</Button>
              <Button onClick={() => void exportPackage()}>导出加密数据包</Button>
              <Button onClick={() => void importPackage()}>导入数据包</Button>
            </div>
            <p className="fineprint">导出不包含手动移出应用的文档；备份是否包含在清除范围内需单独确认。</p>
          </Card>

          <Card>
            <CardHead title="平台能力" subtitle="非 Windows 上不支持的能力标成不可用" />
            {PLATFORM_CAPABILITIES.map((item) => (
              <div className="permission-row" key={item.id}>
                <div><strong>{item.label}</strong><span>{item.note}</span></div>
                <Pill tone={item.windows === '可用' ? 'green' : 'amber'}>{item.windows}</Pill>
              </div>
            ))}
            <Button onClick={() => void update({ onboardingDone: false })}>重新查看使用说明</Button>
          </Card>

          <Card className="about-card">
            <CardHead title="关于与帮助" subtitle={`Murasame ${info?.version ?? '0.9.0'}`} />
            <div className="about-list">
              <div><span>版本</span><strong>{info?.version ?? '0.9.0'}</strong></div>
              <div><span>运行方式</span><strong>{info?.isPackaged ? '已安装应用' : '开发构建'}</strong></div>
              <div><span>当前模型</span><strong>{data.models.find((model) => model.default)?.name ?? '未配置'}</strong></div>
              <div><span>唤起桌宠</span><strong>{hotkey}</strong></div>
              <div>
                <span>换一个快捷键</span>
                <strong className="hotkey-edit">
                  <input className="input" value={hotkeyDraft} onChange={(event) => setHotkeyDraft(event.target.value)} aria-label="唤起桌宠的快捷键" placeholder="例如 Ctrl+Alt+M" />
                  <Button size="sm" onClick={() => void applyHotkeyDraft()} disabled={!hotkeyDraft.trim() || hotkeyDraft.trim() === data.settings.petHotkey}>应用</Button>
                </strong>
              </div>
              <div><span>屏幕辅助快捷键</span><strong>{screenHotkey}</strong></div>
              <div><span>修改屏幕辅助快捷键</span><strong className="hotkey-edit">
                <input className="input" value={screenHotkeyDraft} onChange={event => setScreenHotkeyDraft(event.target.value)} aria-label="屏幕辅助的快捷键" placeholder="例如 Ctrl+Alt+Q" maxLength={40} />
                <Button size="sm" onClick={() => void applyScreenHotkeyDraft()} disabled={savingScreenHotkey || !screenHotkeyDraft.trim() || screenHotkeyDraft.trim() === data.settings.screenHotkey}>应用屏幕快捷键</Button>
              </strong></div>
              <div><span>使用方式</span><strong>按快捷键开始框选屏幕区域，确认后分析；Esc 取消。未授权时会引导到设置。</strong></div>
              <div><span>语音</span><strong>{voiceDetail || '正在检查本地语音文件'}</strong></div>
              <div><span>数据位置</span><strong className="path-text">{info?.userDataPath ?? '加载中…'}</strong></div>
              <div><span>日志位置</span><strong className="path-text">{info?.logsPath ?? '加载中…'}</strong></div>
            </div>
            <p className="muted">可将应用数据移到其他磁盘，日志和下载的模型会随数据目录一起迁移，重启后生效。安装程序本身的位置不变。</p>
            {info?.previousStoragePath && <p className="muted storage-backup-note">旧数据备份：{info.previousStoragePath}。确认新位置使用正常后，可在文件管理器中清理旧数据；请保留默认目录中的 storage-location.json。</p>}
            <div className="about-actions">
              <Button size="sm" onClick={() => void changeStorage()} disabled={movingStorage}>{movingStorage ? '正在准备…' : '更改存储位置…'}</Button>
              {info?.previousStoragePath && <Button size="sm" onClick={() => void window.murasame.app.openStorageBackup().catch(error => notify(String(error), 'amber'))}>打开旧数据备份</Button>}
              <Button size="sm" onClick={() => void openPath('userData')}>打开数据目录</Button>
              <Button size="sm" onClick={() => void openPath('logs')}>打开日志</Button>
              <Button size="sm" onClick={() => setHelpOpen(true)} icon={<HelpCircle size={14} />}>使用说明</Button>
              <Button size="sm" onClick={() => void checkUpdates()} disabled={checkingUpdate}>{checkingUpdate ? '检查中…' : '检查更新'}</Button>
            </div>
            <div className="security-line"><ShieldCheck size={14} />对话、记忆和截图只在你允许时才会发给当前模型。密钥不会出现在日志里。</div>
          </Card>
        </div>
      </div>

      <ClearScopeDialog open={clearOpen} onOpenChange={setClearOpen} onConfirm={clearData} busy={busyClear} title="清除本地数据" description="应用会严格按勾选范围执行；取消不会产生任何更改。" confirmLabel="执行清除" />
      <ConfirmDialog
        open={plainOpen}
        onOpenChange={setPlainOpen}
        title="导出未加密的 JSON？"
        description="这个文件不加密，里面有完整对话、记忆和任务。请自行保管，不要发到不受信任的地方。"
        confirmLabel="仍然导出"
        tone="red"
        onConfirm={exportData}
      />
      <Modal
        open={bundle !== null}
        onOpenChange={(open) => { if (!open) setBundle(null) }}
        title={bundle?.mode === 'import' ? '输入数据包口令' : '设置导出口令'}
        description="口令至少 6 位。数据包加密，不含明文密钥。"
        footer={<Button variant="primary" onClick={() => void submitBundle()}>确定</Button>}
      >
        <Field label="口令">
          <Input type="password" value={bundle?.passphrase ?? ''} onChange={(event) => setBundle((current) => current ? { ...current, passphrase: event.target.value } : current)} />
        </Field>
      </Modal>

      <ConfirmDialog
        open={quitOpen}
        onOpenChange={setQuitOpen}
        title="退出 Murasame？"
        description="退出会关闭控制台与桌宠窗口，并结束当前本地进程。"
        confirmLabel="退出应用"
        tone="red"
        onConfirm={async () => { await window.murasame.app.quit() }}
      >
        <div className="quit-summary">
          {runningTasks.length ? (
            <>
              <p><strong>{runningTasks.length} 个任务仍在运行或等待批准。</strong></p>
              <p>退出后任务会中断，不会自动标记为完成。已完成步骤与产物仍可查看。</p>
            </>
          ) : (
            <p>当前没有运行中的任务。退出不会删除对话、记忆或设置。</p>
          )}
          <div className="inline-note">若只是暂时离开，可取消并选择「隐藏到托盘」，任务会继续保留。</div>
        </div>
      </ConfirmDialog>

      <Modal
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Murasame 使用说明"
        description="模型、对话、记忆和任务都保存在这台电脑上。做不到的事情会直接说明，不会显示成已经完成。"
        footer={<Button variant="primary" onClick={() => setHelpOpen(false)}>知道了</Button>}
      >
        <div className="help-copy">
          <p><strong>模型：</strong>在模型服务里填写地址和密钥，验证通过后才会用于对话、看图和任务。</p>
          <p><strong>形象：</strong>可以换内置形象，也可以导入 Cubism 目录或 zip。加载失败的形象不会被当成当前形象。</p>
          <p><strong>记忆和历史：</strong>历史是对话原文。长期记忆是单独保存的偏好。清除历史不会自动清掉全部记忆。</p>
          <p><strong>任务：</strong>涉及写文件或执行命令时会先请求批准。拒绝或超时都不会执行，也不会记成成功。</p>
          <p><strong>自主活动：</strong>只在隔离桌面里进行。Docker 或镜像没准备好时不会去操作你正在用的窗口，也不会编造活动记录。</p>
          <p><strong>桌宠：</strong>单击打开对话，按住拖动。右键可以隐藏或退出。回复默认朗读，可以在设置里关掉。</p>
        </div>
      </Modal>
    </div>
  )
}
