/* murasame 产品愿景原型 · 演示数据
   全部为虚构演示数据，不来自真实用户，也不写回任何地方。
   字段结构对齐 docs/39-FEATURE-SPECS.md 中的 TS 草案（简化版）。 */

window.VISION_DATA = (function () {
  'use strict'

  var categories = [
    {
      id: 'user',
      title: '书桌便签',
      en: 'About you',
      desc: '称呼、偏好、知识背景',
      furniture: '✎',
      mark: 'i'
    },
    {
      id: 'feedback',
      title: '反馈盒',
      en: 'Feedback',
      desc: '要避免什么、要保持什么',
      furniture: '◈',
      mark: 'ii'
    },
    {
      id: 'project',
      title: '工作台',
      en: 'Projects',
      desc: '目标、进度、已做的决策',
      furniture: '▤',
      mark: 'iii'
    },
    {
      id: 'reference',
      title: '书架',
      en: 'Reference',
      desc: '链接、文档位置、工单号',
      furniture: '▥',
      mark: 'iv'
    }
  ]

  var memories = [
    {
      id: 'm-u1',
      category: 'user',
      text: '你习惯把需要集中注意力的工作放在上午，下午更适合开会和整理。',
      sourceLabel: '会话「周三评审准备什么」',
      sourceDetail: '「我一般上午写东西，下午脑子就转不动了。」',
      sourceKind: 'conversation',
      created: '2026-10-18',
      updated: '2026-11-12',
      lightCount: 2,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-u2',
      category: 'user',
      text: '你不吃辣。点外卖时会避开川菜和火锅。',
      sourceLabel: '会话「中午吃什么」',
      sourceDetail: '「随便，别辣的就行。」',
      sourceKind: 'conversation',
      created: '2026-10-21',
      updated: '2026-10-21',
      lightCount: 1,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-u3',
      category: 'user',
      text: '你喜欢先看结论，再看过程。',
      sourceLabel: '手动添加',
      sourceDetail: '你在记忆页手动补充的一条偏好。',
      sourceKind: 'manual',
      created: '2026-11-02',
      updated: '2026-11-02',
      lightCount: 0,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-u4',
      category: 'user',
      text: '回顾里可以保留失败项，但不要出现完成率。',
      sourceLabel: '会话「每日回顾想怎么看」',
      sourceDetail: '「别给我打分，失败写进去就行。」',
      sourceKind: 'conversation',
      created: '2026-11-13',
      updated: '2026-11-13',
      lightCount: 0,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-f1',
      category: 'feedback',
      text: '任务失败时，先直接说没做成，再解释原因。不要用「差不多」。',
      sourceLabel: '会话「任务结果怎么说」',
      sourceDetail: '「你直接告诉我就行，别绕。」',
      sourceKind: 'conversation',
      created: '2026-10-20',
      updated: '2026-10-20',
      lightCount: 3,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-f2',
      category: 'feedback',
      text: '开会时不要主动弹提示；可以等我休息时再说。',
      sourceLabel: '会话「又一堆会」',
      sourceDetail: '「我开会你别冒出来，回头再说。」',
      sourceKind: 'conversation',
      created: '2026-10-29',
      updated: '2026-10-29',
      lightCount: 0,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-p1',
      category: 'project',
      text: '周三前要交课程评审材料，参考 docs/00-OVERVIEW.md。',
      sourceLabel: '会话「周三评审准备什么」',
      sourceDetail: '「周三之前得把评审材料交了，头疼。」',
      sourceKind: 'conversation',
      created: '2026-11-11',
      updated: '2026-11-13',
      lightCount: 4,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-p2',
      category: 'project',
      text: '答辩时间在 12 月中旬，主题是证据驱动与陪伴体验。',
      sourceLabel: '会话「答辩主题」',
      sourceDetail: '「答辩得讲清楚为什么先做核验。」',
      sourceKind: 'conversation',
      created: '2026-11-06',
      updated: '2026-11-06',
      lightCount: 1,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-p3',
      category: 'project',
      text: '你之前说在学 Rust，后来改学 TypeScript。',
      sourceLabel: '会话「技术栈」',
      sourceDetail: '「Rust 先放放，最近都在写 TS。」（旧值已被新事实取代）',
      sourceKind: 'conversation',
      created: '2026-10-17',
      updated: '2026-10-28',
      validUntil: '2026-10-28',
      lightCount: 0,
      sensitive: false,
      status: 'invalid'
    },
    {
      id: 'm-r1',
      category: 'reference',
      text: 'SRS 文档：docs/00-OVERVIEW.md，30 条 FR / 10 个 UC。',
      sourceLabel: '手动添加',
      sourceDetail: '你让它在答辩前记住文档位置。',
      sourceKind: 'manual',
      created: '2026-10-15',
      updated: '2026-10-15',
      lightCount: 1,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-r2',
      category: 'reference',
      text: '隔离镜像构建脚本：isolation/Dockerfile，需要 Docker Desktop 先启动。',
      sourceLabel: '任务「准备自主活动环境」',
      sourceDetail: '任务核验结论：镜像存在，Docker 引擎未启动。',
      sourceKind: 'task',
      created: '2026-10-30',
      updated: '2026-11-02',
      lightCount: 2,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-r3',
      category: 'reference',
      text: '记忆召回验收数据：docs/22-MEMORY-RECALL-DIAGNOSTIC.md。',
      sourceLabel: '会话「召回怎么验收」',
      sourceDetail: '「那两份漏召回的报告放哪了？」',
      sourceKind: 'conversation',
      created: '2026-11-08',
      updated: '2026-11-08',
      lightCount: 1,
      sensitive: false,
      status: 'active'
    },
    {
      id: 'm-r4',
      category: 'reference',
      text: '桌宠形象素材说明：docs/37-NAILONG-MESH-PET.md（课程演示，不公开分发）。',
      sourceLabel: '手动添加',
      sourceDetail: '你提醒它别把课程演示素材当公开素材。',
      sourceKind: 'manual',
      created: '2026-11-05',
      updated: '2026-11-05',
      lightCount: 0,
      sensitive: false,
      status: 'active'
    }
  ]

  var litEvents = [
    {
      id: 'light-1',
      memoryId: 'm-p1',
      time: '今天 09:12',
      title: '周三前要交课程评审材料',
      reason: '你问「评审准备什么」，这条被注入本轮上下文',
      level: 'glow'
    },
    {
      id: 'light-2',
      memoryId: 'm-u1',
      time: '今天 08:42',
      title: '上午做需要专注的事',
      reason: '主动提醒时引用：现在是你状态最好的时段',
      level: 'spoken'
    },
    {
      id: 'light-3',
      memoryId: 'm-f1',
      time: '昨天 22:10',
      title: '失败先直接说结论',
      reason: '每日回顾生成时引用',
      level: 'glow'
    },
    {
      id: 'light-4',
      memoryId: 'm-r2',
      time: '昨天 16:05',
      title: '隔离镜像脚本位置',
      reason: '任务「准备自主活动环境」召回',
      level: 'silent'
    }
  ]

  var review = {
    localDate: '2026-11-13',
    dateLabel: '2026 年 11 月 13 日 · 周五',
    version: 1,
    generatedBy: 'local',
    meta: '本地生成 · 未外发 · 依据 14 条来源',
    conversations: [
      {
        text: '你问「周三评审要准备什么」。它把记忆里的评审材料清单列了出来，并建议先补证据链那一节。',
        source: '会话「周三评审准备什么」',
        time: '09:12'
      },
      {
        text: '你让它把下载文件夹按类型整理。它先给了计划，等你确认后才开始移动文件。',
        source: '会话「整理下载文件夹」',
        time: '11:40'
      },
      {
        text: '你们聊了 6 轮「离线模型和云端模型怎么选」。它没有替你下结论，只把取舍列清楚。',
        source: '会话「模型选择」',
        time: '15:05'
      }
    ],
    outcomes: [
      {
        title: '整理下载文件夹',
        status: '部分完成',
        tone: 'partial',
        summary: '4 个文件移到对应文件夹，2 个文件被占用，没有移动。',
        verdict: '核验：移动的 4 个位置正确；2 个仍在原处，未计入完成。',
        time: '11:52'
      },
      {
        title: '生成一张示意图',
        status: '失败',
        tone: 'fail',
        summary: '隔离环境没有启动，活动没有开始，也没有产生任何文件。',
        verdict: '核验：容器未运行；产物不存在。',
        time: '14:20'
      },
      {
        title: '复核评审材料的结构',
        status: '已完成',
        tone: 'ok',
        summary: '只读检查完成，没有修改任何文件。',
        verdict: '核验：读取 3 个文件，内容与预期一致。',
        time: '16:10'
      }
    ],
    memories: [
      {
        kind: '新增',
        text: '回顾里可以保留失败项，但不要出现完成率。',
        note: '来自会话「每日回顾想怎么看」 · 14:48'
      },
      {
        kind: '更正',
        text: '评审时间：周四 → 周三。旧值已失效，仍可追溯。',
        note: '来自会话「周三评审准备什么」 · 09:15'
      },
      {
        kind: '点亮',
        text: '「上午做需要专注的事」今天被想起 1 次（08:42）。',
        note: '只统计真实注入本轮上下文的召回'
      }
    ],
    observations: [
      {
        title: '它看到的',
        text: '在隔离环境里浏览了一个讲本地向量检索的页面，只读到正文前两屏。它想问你：离线召回和在线搜索怎么取舍。',
        limitation: '限制：没有登录、没有读取弹窗、没有碰你的桌面；只有静态页面文字。'
      }
    ],
    tomorrow: [
      { text: '周三评审材料：把 02 节的证据链补完', source: '来自项目记忆 · 3 天前' },
      { text: '问它：离线模型和云端模型怎么选', source: '来自今天的对话' },
      { text: '', source: '你手填' }
    ],
    sources: [
      'conversation:周三评审准备什么/09:12',
      'conversation:周三评审准备什么/09:15',
      'conversation:整理下载文件夹/11:40',
      'task:整理下载文件夹/11:52',
      'task:生成一张示意图/14:20',
      'task:复核评审材料的结构/16:10',
      'conversation:模型选择/15:05',
      'memory:m-p1',
      'memory:m-u4（新增）',
      'memory:m-p1（更正）',
      'light:m-u1/08:42',
      'autonomy:activity-1130',
      'memory:m-p2',
      'system:local-review'
    ],
    droppedFacts: 0,
    missingSources: []
  }

  var scenes = {
    morning: {
      key: 'morning',
      label: '早晨',
      range: '05:00–09:00',
      theme: 'theme-morning',
      presence: 'intervene',
      presenceLabel: '介入',
      title: '开机后，先说起你提过的事',
      text: '它读了 project 记忆里的日期，也看了昨天没做完的任务。只说了最要紧的一件，没有把记忆全念一遍。',
      bubble: '早。你上次说周三前要交评审，今天就是周三。要我先把它放到工作台上吗？',
      tags: [
        { text: '有真实理由：记忆里的日期', kind: 'allow' },
        { text: '距上次发言 13 小时', kind: '' }
      ],
      judgment: {
        speak: true,
        title: '可以说一句',
        detail: '有理由：评审就在今天。没有命中任何安静条件。'
      },
      checks: [
        { label: '有真实理由', state: 'ok' },
        { label: '非全屏', state: 'ok' },
        { label: '30 秒内无输入', state: 'ok' },
        { label: '频率未超限', state: 'ok' }
      ]
    },
    work: {
      key: 'work',
      label: '工作',
      range: '09:00–12:00',
      theme: 'theme-work',
      presence: 'present',
      presenceLabel: '在场',
      title: '工作时段：它在旁边，但不开口',
      text: '前台窗口在编辑器里，30 秒内有键盘输入。它保持待机，动作幅度降低；脚边最多只留一条任务状态。',
      bubble: '（安静地待机。它看见你在打字，没有开口。）',
      tags: [
        { text: '抑制：30 秒内有键盘输入', kind: 'blocked' },
        { text: '抑制：前台为全屏应用', kind: 'blocked' }
      ],
      judgment: {
        speak: false,
        title: '现在不开口',
        detail: '命中 2 条安静条件。它不会为了刷存在感而硬找话题。'
      },
      checks: [
        { label: '有理由', state: 'neutral' },
        { label: '30 秒内输入', state: 'block' },
        { label: '全屏应用', state: 'block' },
        { label: '频率未超限', state: 'ok' }
      ]
    },
    noon: {
      key: 'noon',
      label: '午休',
      range: '12:00–14:00',
      theme: 'theme-noon',
      presence: 'present',
      presenceLabel: '在场',
      title: '午休：它去里屋看看',
      text: '你离开座位超过 10 分钟。若已授权，它可以在隔离环境里浏览或看视频；画面只在控制台可见，不会碰你的桌面。',
      bubble: '你去吃饭吧，我去里屋看看。回来讲给你听。',
      tags: [
        { text: '授权：自主活动', kind: 'allow' },
        { text: '隔离环境 · 需要 Docker', kind: '' }
      ],
      judgment: {
        speak: false,
        title: '不需要对你开口',
        detail: '你不在，它不会用提示留住你。活动结束后，等你回来再讲见闻。'
      },
      checks: [
        { label: '空闲 ≥ 10 分钟', state: 'ok' },
        { label: '隔离环境可用', state: 'ok' },
        { label: '用户不在 · 不打扰', state: 'block' },
        { label: '不占用宿主', state: 'ok' }
      ]
    },
    afternoon: {
      key: 'afternoon',
      label: '下午',
      range: '14:00–17:00',
      theme: 'theme-work',
      presence: 'intervene',
      presenceLabel: '介入',
      title: '连续工作很久时，只提醒一次',
      text: '前台窗口标题显示你在代码与文档之间切换。它记录连续活跃时长，只在超过 2 小时时提醒一次，不重复。',
      bubble: '坐挺久了，起来走两步？没做完的留到明天也行。',
      tags: [
        { text: '理由：连续工作 1 小时 52 分', kind: 'allow' },
        { text: '若你正在输入则自动取消', kind: '' }
      ],
      judgment: {
        speak: true,
        title: '可以说一句',
        detail: '理由成立且当前没有输入；同类提醒今天只剩 1 次额度。'
      },
      checks: [
        { label: '理由成立', state: 'ok' },
        { label: '非全屏', state: 'ok' },
        { label: '30 秒内无输入', state: 'ok' },
        { label: '频率未超限', state: 'ok' }
      ]
    },
    evening: {
      key: 'evening',
      label: '傍晚',
      range: '17:00–21:00',
      theme: 'theme-evening',
      presence: 'intervene',
      presenceLabel: '介入',
      title: '傍晚：日签放桌上了',
      text: '今天的回顾在后台生成完毕。它不朗读全文，也不弹窗，只说一句邀请；看不看由你决定。',
      bubble: '今天的回顾放桌上了。要不要看看？没做成的也写进去了。',
      tags: [
        { text: '回顾已生成', kind: 'allow' },
        { text: '不弹窗 · 只说一次', kind: '' }
      ],
      judgment: {
        speak: true,
        title: '可以说一句',
        detail: '有真实内容可回顾；只说一次，不追问。'
      },
      checks: [
        { label: '有真实内容', state: 'ok' },
        { label: '非全屏', state: 'ok' },
        { label: '30 秒内无输入', state: 'ok' },
        { label: '频率未超限', state: 'ok' }
      ]
    },
    night: {
      key: 'night',
      label: '深夜',
      range: '21:00–24:00',
      theme: 'theme-night',
      presence: 'present',
      presenceLabel: '在场',
      title: '深夜：克制',
      text: '夜间模式。唤醒度降低，不开启新话题；只有一条未完成任务可以留到明天。',
      bubble: '快零点了。没做完的那个整理任务，要我留到明天吗？',
      tags: [
        { text: '理由：有未完成任务', kind: 'allow' },
        { text: '夜间模式：不展开新话题', kind: 'blocked' }
      ],
      judgment: {
        speak: true,
        title: '可以只说一句',
        detail: '夜间只允许一件与未完成任务有关的事；被拒绝后当夜不再提。'
      },
      checks: [
        { label: '理由成立', state: 'ok' },
        { label: '夜间模式 · 限制话题', state: 'block' },
        { label: '30 秒内无输入', state: 'ok' },
        { label: '今天只剩 1 次', state: 'ok' }
      ]
    }
  }

  var timeSlots = [
    { from: 300, to: 540, key: 'morning' },
    { from: 540, to: 720, key: 'work' },
    { from: 720, to: 840, key: 'noon' },
    { from: 840, to: 1020, key: 'afternoon' },
    { from: 1020, to: 1260, key: 'evening' },
    { from: 1260, to: 1440, key: 'night' }
  ]

  var weather = {
    mood: '多云',
    motion: '微风',
    posture: '蜷着',
    summary: '它现在有点安静，但不是难过。上午的问答很顺，下午的任务没做成，它把原因整理好了，等你决定。',
    causes: [
      { kind: 'task', text: '整理任务部分完成，2 个文件没移动', at: '11:52' },
      { kind: 'conversation', text: '你问评审，它答上了；评价为「相关、可应对」', at: '09:12' },
      { kind: 'rest', text: '午后没有交互，情绪已自然回落一档', at: '14:30' }
    ],
    updated: '2 分钟前'
  }

  var theater = {
    source: '任务 · 整理下载文件夹',
    time: '今天 11:52',
    lines: [
      '整理完了 4 个，2 个被占用，没动它们。',
      '核验说：移动的 4 个都在新位置，另外 2 个还在原处。',
      '要我换个方式再试吗？'
    ]
  }

  var relationship = {
    day: 30,
    stage: '默契',
    history: [
      { stage: '初识', date: '10-15', note: '第一次给它起名' },
      { stage: '熟悉', date: '10-20', note: '开始记得偏好' },
      { stage: '熟络', date: '10-26', note: '第一次听它讲见闻' },
      { stage: '默契', date: '11-08', note: '不用解释也懂你在忙' }
    ],
    stages: ['初识', '熟悉', '熟络', '默契']
  }

  var petBubbles = {
    memory: '我把你上次说的事都放在房间了。点卡片能看到它是从哪来的。',
    review: '今天的回顾放桌上了。没做成的也写进去了，我没挑好的说。',
    day: ''
  }

  var presenceModes = {
    present: { key: 'present', label: '在场' },
    reachable: { key: 'reachable', label: '可及' },
    intervene: { key: 'intervene', label: '介入' }
  }

  return {
    categories: categories,
    memories: memories,
    litEvents: litEvents,
    review: review,
    scenes: scenes,
    timeSlots: timeSlots,
    weather: weather,
    theater: theater,
    relationship: relationship,
    petBubbles: petBubbles,
    presenceModes: presenceModes,
    generatedAt: '2026-11-13'
  }
})()
