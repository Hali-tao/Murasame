# Memory Recall UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话上下文展示并持久保存最近已完成回复的实际记忆检索状态。
**Architecture:** 在原prompt调用JSON内保存枚举，经Conversation既有更新路径显示，旧记录保留unknown。
**Tech Stack:** TypeScript、React、Electron、SQLite、Vitest、Playwright；不加依赖。
**Spec:** docs/superpowers/specs/2026-10-29-memory-recall-ui-design.md

## Global Constraints

用户授权自主决定软件细节，原需求不简化；使用独立测试资料；角色制作暂停；不修改/关闭同事issue；仅通过检查后普通推送GitHub；不覆盖先前安装包。

## Review Focus

- 缺字段/未知状态的旧记录不得显示成完整检索。
- 请求失败或存储回滚不得覆盖上次已完成回复的状态。
- 正在发送与后台其他会话回复不得污染当前上下文。
- 已更正/删除记忆可隐藏条目，但不能抹掉历史检索受限的事实。
- 禁用记忆和工具分派不得被误报为模型故障；切换设置不篡改过去状态。

### Task 1: Persist and display per-reply recall status

**Files:** 修改src/shared/types.ts、src/main/core/services/conversation-service.ts、src/renderer/src/pages/ChatPage.tsx和styles.css；新增src/renderer/src/components/MemoryRecallStatus.tsx；测试沿用conversation-memory-maturity、chat-conversation-regression、memory-degraded-context、local-memory。

**Interfaces:** `MemoryRecallStatus = 'complete' | 'limited' | 'unavailable' | 'disabled' | 'not-used' | 'unknown'`；`Conversation.memoryRecallStatus?: MemoryRecallStatus`；`recordRecall(..., status: MemoryRecallStatus)`；`getRecall`增status字段；UI组件接收status、recorded、count。不新增IPC事件。

- [x] 写失败测试：成功/部分/异常/禁用/分派状态经过新service读取一致；旧/未知字段为unknown；失败模型请求和失败写入保留上一记录。UI以testid `memory-recall-status`区分状态，切换/删除/折叠正确。损坏模型E2E增加受限提示、刷新、新会话及返回原会话检查。
- [x] 运行定向Vitest及旧包E2E，期望新增状态断言失败，保存原始证据。
- [x] 实施上述接口和组件；在消息/提示记录同一事务内保存状态，缺少callback视作unavailable，现有正常及异常提示逻辑保持。
- [x] 定向测试通过；全仓`npm run verify`，期望0失败，旧追踪映射不是SRS全验收。
- [ ] 独立新目录打包，完整Playwright新包回归，期望全部通过无跳过；核对源资源、旧包哈希和真实截图。
- [ ] 一次新上下文独立审阅，处理阻塞项；归档证据与交付说明，只提交通过的代码并普通推送GitHub。

整个任务测试命令：`npm run verify`。原生桌面模型和三维工程不属于本计划。源代码、测试和验收报告为单个可独立审阅增量；不在未验证中途推送。
