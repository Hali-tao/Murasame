import type { LucideIcon } from 'lucide-react'
import {
  Brain,
  Cpu,
  History,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  Monitor,
  ShieldCheck,
  Sparkles,
  Wrench
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  subtitle: string
  icon: LucideIcon
  testId: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const navigation: NavGroup[] = [
  {
    label: '工作',
    items: [
      { to: '/', label: '概览', subtitle: '一屏掌握任务、服务与桌面运行状态', icon: LayoutDashboard, testId: 'nav-overview' },
      { to: '/chat', label: '交流', subtitle: '与村雨继续对话，或从上下文发起任务', icon: MessageCircle, testId: 'nav-chat' },
      { to: '/screen', label: '屏幕辅助', subtitle: '在授权范围内理解界面、文档与报错', icon: Monitor, testId: 'nav-screen' },
      { to: '/tasks', label: '任务', subtitle: '确认目标、跟踪进度并处理敏感操作审批', icon: ListChecks, testId: 'nav-tasks' }
    ]
  },
  {
    label: '资料',
    items: [
      { to: '/history', label: '历史', subtitle: '检索本地会话，明确清除范围', icon: History, testId: 'nav-history' },
      { to: '/memory', label: '长期记忆', subtitle: '查看、更正和停用跨会话的个人信息', icon: Brain, testId: 'nav-memory' },
      { to: '/tools', label: '工具与插件', subtitle: '管理可用能力、授权范围与调用状态', icon: Wrench, testId: 'nav-tools' }
    ]
  },
  {
    label: '系统',
    items: [
      { to: '/models', label: '模型服务', subtitle: '配置文本、图像与工具能力并验证连通性', icon: Cpu, testId: 'nav-models' },
      { to: '/character', label: '角色设置', subtitle: '选择预置形象并调整交流设定', icon: Sparkles, testId: 'nav-character' },
      { to: '/settings', label: '运行与隐私', subtitle: '控制权限、数据保留、托盘与退出行为', icon: ShieldCheck, testId: 'nav-settings' }
    ]
  }
]

export const pageMeta = navigation.flatMap((group) => group.items)
