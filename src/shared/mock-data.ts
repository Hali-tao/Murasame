import type {
  AppSettings,
  BootstrapData,
  CharacterProfile,
  Conversation,
  MemoryEntry,
  ModelProfile,
  ScreenAnalysis,
  Task,
  ToolCapability,
  Tone
} from './types'
import { DEFAULT_PET_PRESET } from './pet-presets'

export interface ActivityItem {
  time: string
  category: string
  text: string
  ago: string
  tone: Tone
}

export interface ToolCallItem {
  time: string
  tool: string
  action: string
  result: string
  tone: Tone
}

export interface UsageStat {
  label: string
  value: string
  caption: string
  tone: Tone
}

export const initialSettings: AppSettings = {
  startAtLogin: false,
  minimizeToTray: true,
  doNotDisturb: true,
  taskNotifications: true,
  encryptLocalData: true,
  closeBehavior: 'tray',
  logRetentionDays: 30,
  memoryEnabled: true,
  memoryAutoExtract: true,
  petVisible: true,
  petScale: 0.9,
  petPreset: DEFAULT_PET_PRESET,
  permissions: {
    screen: true,
    microphone: false,
    accessibility: true
  }
}

const conversations: Conversation[] = [
  {
    id: 'chat-01',
    title: '修复数据清洗脚本的编码问题',
    time: '今天 18:42',
    preview: '第三列读出来一直是乱码……',
    count: 5,
    pinned: true,
    messages: [
      {
        id: 'c1-1',
        role: 'assistant',
        text: '晚上好，林澈。昨天那份数据清洗脚本还卡在 GBK 编码问题上吗？',
        time: '18:36'
      },
      {
        id: 'c1-2',
        role: 'user',
        text: '嗯，读取 CSV 时第三列总是乱码。我已经试过 utf-8 和 utf-8-sig 了。',
        time: '18:37'
      },
      {
        id: 'c1-3',
        role: 'assistant',
        text: '从你之前贴出的报错看，源文件很可能是 GB18030 编码，而脚本按 UTF-8 读取。先不要改原始文件，可以这样定位：\n\n1. 用二进制方式读取前 32 个字节，确认是否存在多字节字符。\n2. 依次尝试 gb18030、gbk，并记录失败位置。\n3. 在读取函数中显式传入 encoding=\'gb18030\'。',
        time: '18:39'
      },
      {
        id: 'c1-4',
        role: 'user',
        text: '帮我整理成可以直接改的步骤。',
        time: '18:41'
      },
      {
        id: 'c1-5',
        role: 'assistant',
        text: '可以。最小修改点在 load.py 的 read_csv 调用上：\n\nencoding = \'gb18030\'\ndf = pd.read_csv(path, encoding=encoding, dtype=str)\n\n随后对「公司名称」列做一次 strip，并补一个回归用例，确认车牌号列不再被错误转义。需要我把它整理成任务吗？',
        time: '18:42'
      }
    ]
  },
  {
    id: 'chat-02',
    title: '论文相关工作梳理',
    time: '今天 16:08',
    preview: '已经按主题聚类了 42 篇论文',
    count: 2,
    pinned: false,
    messages: [
      {
        id: 'c2-1',
        role: 'user',
        text: '把 D:\\Research\\papers 里的论文按主题整理一下，先做一个索引。',
        time: '15:52'
      },
      {
        id: 'c2-2',
        role: 'assistant',
        text: '我扫描到 42 篇 PDF，提取了标题、作者、年份和摘要。初步聚类为 5 个主题，其中「桌面智能体」与「长期记忆」重叠较多。',
        time: '16:08'
      }
    ]
  },
  {
    id: 'chat-03',
    title: '今天的学习计划',
    time: '昨天 21:14',
    preview: '把 90 分钟拆成了两个专注块',
    count: 2,
    pinned: false,
    messages: [
      {
        id: 'c3-1',
        role: 'user',
        text: '今晚只有 90 分钟，帮我把 Rust 异步那一章安排一下。',
        time: '21:10'
      },
      {
        id: 'c3-2',
        role: 'assistant',
        text: '建议拆成两个 40 分钟专注块：先读所有权与 Future 的关系，再用一个最小 TCP echo server 验证理解。中间留 10 分钟整理问题。',
        time: '21:14'
      }
    ]
  },
  {
    id: 'chat-04',
    title: 'Rust 所有权概念',
    time: '10 月 18 日',
    preview: '借用检查器真正阻止的是什么',
    count: 2,
    pinned: false,
    messages: [
      {
        id: 'c4-1',
        role: 'user',
        text: '借用检查器到底在防止什么问题？',
        time: '10 月 18 日'
      },
      {
        id: 'c4-2',
        role: 'assistant',
        text: '它主要阻止两类风险：悬垂引用和数据竞争。所有权规则让「谁负责释放」和「谁可以同时访问」在编译期就可判定。',
        time: '10 月 18 日'
      }
    ]
  },
  {
    id: 'chat-05',
    title: '周报初稿',
    time: '10 月 17 日',
    preview: '已生成三段式周报并保留原始链接',
    count: 2,
    pinned: false,
    messages: [
      {
        id: 'c5-1',
        role: 'user',
        text: '根据这几天的任务记录，写一个不夸张的周报。',
        time: '10 月 17 日'
      },
      {
        id: 'c5-2',
        role: 'assistant',
        text: '已整理为「完成事项 / 风险与阻塞 / 下周计划」三段，并把每个结论链接到对应任务记录。',
        time: '10 月 17 日'
      }
    ]
  }
]

const memories: MemoryEntry[] = [
  { id: 'm-01', category: '称呼', text: '希望被称呼为「林澈」，不使用敬语。', source: '来自 10 月 12 日交流', updated: '今天' },
  { id: 'm-02', category: '沟通偏好', text: '解释代码时先给结论，再给最小可运行示例。', source: '来自 10 月 14 日交流', updated: '今天' },
  { id: 'm-03', category: '工作节奏', text: '通常在 20:00 后处理个人项目，上午更适合阅读。', source: '来自 10 月 10 日任务', updated: '昨天' },
  { id: 'm-04', category: '项目', text: '正在开发 Murasame 桌面伙伴，使用 Electron + React 做产品壳。', source: '来自 10 月 20 日任务', updated: '今天' },
  { id: 'm-05', category: '工具', text: '主要使用 VS Code、Obsidian 和 Windows 11。', source: '来自 10 月 08 日交流', updated: '10 月 08 日' },
  { id: 'm-06', category: '阅读', text: '喜欢科幻与推理小说，不喜欢剧透。', source: '来自 10 月 02 日交流', updated: '10 月 02 日' },
  { id: 'm-07', category: '表达', text: '偏好克制、具体的语气，不需要过度鼓励。', source: '来自 9 月 28 日交流', updated: '9 月 28 日' },
  { id: 'm-08', category: '隐私', text: '屏幕内容仅用于当前问题，不希望默认保留截图。', source: '来自 10 月 18 日设置', updated: '10 月 18 日' }
]

const tasks: Task[] = [
  {
    id: 'T-20261020-03',
    title: '整理论文相关工作',
    status: '执行中',
    tone: 'blue',
    progress: 62,
    created: '今天 17:16',
    model: 'OpenAI · 主模型',
    scope: '本地目录 D:\\Research\\papers',
    summary: '扫描 42 篇论文，提取元数据，按主题聚类并生成可编辑的相关工作草稿。',
    steps: [
      { id: 's1', title: '扫描目录与提取元数据', detail: '42 篇 PDF，3 篇元数据缺失', state: '完成', tone: 'green', time: '17:18' },
      { id: 's2', title: '主题聚类与去重', detail: '形成 5 个主题，合并 7 个重复条目', state: '完成', tone: 'green', time: '17:24' },
      { id: 's3', title: '生成对比表', detail: '正在写入 related_work.md', state: '进行中', tone: 'blue', time: '17:31' },
      { id: 's4', title: '核验引用与产物', detail: '等待上一步完成', state: '待执行', tone: 'gray', time: '—' }
    ],
    artifacts: ['papers_index.csv', 'related_work.md', 'topic_map.json'],
    approval: null,
    result: '尚未结束。已完成索引与聚类，草稿正在生成。'
  },
  {
    id: 'T-20261020-02',
    title: '修复数据清洗脚本',
    status: '等待批准',
    tone: 'amber',
    progress: 45,
    created: '今天 16:52',
    model: 'OpenAI · 主模型',
    scope: 'D:\\Projects\\etl\\load.py',
    summary: '定位 CSV 编码问题，并准备一个最小补丁；写入文件前需要用户批准。',
    steps: [
      { id: 's1', title: '定位编码异常', detail: '确认源文件可能是 GB18030', state: '完成', tone: 'green', time: '16:58' },
      { id: 's2', title: '生成修复补丁', detail: '将修改 load.py 的读取参数', state: '等待批准', tone: 'amber', time: '17:02' },
      { id: 's3', title: '运行回归测试', detail: '等待补丁应用', state: '待执行', tone: 'gray', time: '—' }
    ],
    artifacts: ['patch.diff', 'diagnosis.md'],
    approval: {
      target: 'D:\\Projects\\etl\\load.py',
      impact: '修改 1 个文件，新增 encoding 参数并保留原文件备份。不会删除数据。',
      tool: '文件系统工具'
    },
    result: '等待批准，尚未修改用户文件。'
  },
  {
    id: 'T-20261018-07',
    title: '生成周报初稿',
    status: '已完成',
    tone: 'green',
    progress: 100,
    created: '10 月 17 日 21:03',
    model: 'Claude · 长文备选',
    scope: '任务记录与本地文档',
    summary: '根据本周任务与对话记录生成三段式周报，并附带原始链接。',
    steps: [
      { id: 's1', title: '汇总任务与产物', detail: '关联 9 条任务记录', state: '完成', tone: 'green', time: '21:08' },
      { id: 's2', title: '生成三段式草稿', detail: '完成 1,240 字', state: '完成', tone: 'green', time: '21:12' },
      { id: 's3', title: '核验链接与结论', detail: '5 个链接均可访问', state: '完成', tone: 'green', time: '21:15' }
    ],
    artifacts: ['weekly_2026-10-17.md'],
    approval: null,
    result: '已完成并核验。产物可查看，未发现失败步骤。'
  }
]

const tools: ToolCapability[] = [
  { id: 'filesystem', name: '文件系统', kind: '工具', ability: '读取与写入授权目录', permission: '读写', enabled: true, last: '今天 17:24', note: '需要目录授权' },
  { id: 'terminal', name: '终端命令', kind: '工具', ability: '在沙箱中执行命令', permission: '需确认', enabled: true, last: '今天 16:58', note: '敏感命令逐次审批' },
  { id: 'browser', name: '浏览器', kind: '插件', ability: '打开网页并读取可见内容', permission: '受限', enabled: true, last: '今天 15:31', note: '不共享登录状态' },
  { id: 'screen', name: '屏幕读取', kind: '内置', ability: '单次截取或持续观察', permission: '已授权', enabled: true, last: '今天 18:32', note: '仅当前问题使用' },
  { id: 'voice', name: '语音输入', kind: '内置', ability: '麦克风录音与本地转写', permission: '未授权', enabled: false, last: '从未', note: '授权后可启用' },
  { id: 'obsidian', name: 'Obsidian', kind: '插件', ability: '检索本地知识库', permission: '只读', enabled: true, last: '10 月 19 日', note: '限定 Vault 目录' },
  { id: 'git', name: 'Git', kind: '工具', ability: '查看状态与生成差异', permission: '只读', enabled: true, last: '今天 17:05', note: '不自动提交' },
  { id: 'calendar', name: '日历', kind: '插件', ability: '读取空闲时间', permission: '已停用', enabled: false, last: '10 月 12 日', note: '用户手动停用' },
  { id: 'isolated', name: '隔离桌面', kind: '内置', ability: '桌宠自主活动空间', permission: '已授权', enabled: true, last: '今天 14:10', note: '与宿主环境隔离' }
]

const models: ModelProfile[] = [
  {
    id: 'openai-main',
    name: 'OpenAI · 主模型',
    provider: 'OpenAI Compatible',
    endpoint: 'https://api.openai.com/v1',
    key: 'sk-demo-••••••••••••2f9a',
    hasKey: true,
    model: 'gpt-5.1',
    caps: ['文本', '图像', '工具调用'],
    status: '在线',
    tone: 'green',
    default: true,
    latency: '842 ms'
  },
  {
    id: 'claude-long',
    name: 'Claude · 长文备选',
    provider: 'Anthropic',
    endpoint: 'https://api.anthropic.com',
    key: 'sk-ant-••••••••••9c11',
    hasKey: true,
    model: 'claude-sonnet-4.5',
    caps: ['文本', '图像', '工具调用'],
    status: '在线',
    tone: 'green',
    default: false,
    latency: '1.2 s'
  },
  {
    id: 'qwen-local',
    name: '本地 Qwen · 隐私模式',
    provider: 'Ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    key: '',
    hasKey: false,
    model: 'qwen3:14b',
    caps: ['文本', '工具调用'],
    status: '未验证',
    tone: 'gray',
    default: false,
    latency: '—'
  }
]

const screenAnalysis: ScreenAnalysis = {
  title: 'UnicodeDecodeError · 编码不匹配',
  confidence: '高置信度',
  summary: '脚本按 UTF-8 读取，但源 CSV 中存在 GB18030 编码的中文字段。错误发生在第三列的首个非 ASCII 字节。',
  bullets: [
    '源文件大概率由 Windows 中文环境导出，包含 0xD6 开头的双字节字符。',
    '改动读取参数即可，不需要重写原始文件。',
    '建议补一个包含中文与车牌号列的回归用例。'
  ],
  action: '生成最小修复补丁'
}

const character: CharacterProfile = {
  name: '村雨',
  style: '简洁、可靠、少量俏皮',
  example: '先给结论。需要的话，我再把步骤拆小一点。',
  keywords: ['温柔克制', '冷静专业', '简洁'],
  proactive: true,
  memory: true
}

export const activity: ActivityItem[] = [
  { time: '18:42', category: '聊天', text: '村雨给出了编码问题的最小修复步骤', ago: '刚刚', tone: 'coral' },
  { time: '17:24', category: '任务', text: '「整理论文相关工作」完成主题聚类', ago: '1 小时前', tone: 'blue' },
  { time: '16:58', category: '审批', text: '「修复数据清洗脚本」等待文件写入批准', ago: '2 小时前', tone: 'amber' },
  { time: '16:08', category: '屏幕', text: '分析了 main.py 的 UnicodeDecodeError', ago: '3 小时前', tone: 'violet' },
  { time: '15:31', category: '插件', text: '浏览器插件读取了 3 个文献页面', ago: '4 小时前', tone: 'green' }
]

export const toolCalls: ToolCallItem[] = [
  { time: '17:24', tool: '文件系统', action: '写入 related_work.md', result: '成功', tone: 'green' },
  { time: '17:18', tool: '文件系统', action: '读取 42 个 PDF', result: '成功', tone: 'green' },
  { time: '16:58', tool: '终端命令', action: 'python diagnose_encoding.py', result: '成功', tone: 'green' },
  { time: '16:54', tool: '屏幕读取', action: '分析 main.py 报错', result: '成功', tone: 'green' },
  { time: '15:31', tool: '浏览器', action: '读取 3 个文献页面', result: '部分成功', tone: 'amber' }
]

export const usageStats: UsageStat[] = [
  { label: '今日对话', value: '12', caption: '条消息', tone: 'coral' },
  { label: '屏幕分析', value: '4', caption: '次', tone: 'blue' },
  { label: '任务调用', value: '9', caption: '次工具', tone: 'green' },
  { label: '记忆更新', value: '2', caption: '条', tone: 'violet' }
]

export const screenCode = [
  { number: '1', text: 'import pandas as pd', error: false },
  { number: '2', text: 'from pathlib import Path', error: false },
  { number: '3', text: '', error: false },
  { number: '4', text: 'def load_orders(path: Path):', error: false },
  { number: '5', text: '    df = pd.read_csv(path, dtype=str)', error: true },
  { number: '6', text: "    return df[['订单号', '公司名称', '车牌号']]", error: false },
  { number: '7', text: '', error: false },
  { number: '8', text: "if __name__ == '__main__':", error: false },
  { number: '9', text: "    load_orders(Path('orders.csv'))", error: false }
]

export function initialBootstrap(): BootstrapData {
  return {
    conversations: structuredClone(conversations),
    memories: structuredClone(memories),
    tasks: structuredClone(tasks),
    tools: structuredClone(tools),
    models: structuredClone(models),
    screenAnalysis: structuredClone(screenAnalysis),
    character: structuredClone(character),
    settings: structuredClone(initialSettings)
  }
}
