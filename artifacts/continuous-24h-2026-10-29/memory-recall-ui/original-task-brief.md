### Task 1: Persist and display per-reply recall status

**Files:** 修改src/shared/types.ts、src/main/core/services/conversation-service.ts、src/renderer/src/pages/ChatPage.tsx；新增src/renderer/src/components/MemoryRecallStatus.tsx；测试沿用conversation-memory-maturity、chat-conversation-regression、memory-degraded-context、local-memory。

**Interfaces:** `MemoryRecallStatus = 'complete' | 'limited' | 'unavailable' | 'disabled' | 'not-used' | 'unknown'`；`Conversation.memoryRecallStatus?: MemoryRecallStatus`；`recordRecall(..., status: MemoryRecallStatus)`；`getRecall`增status字段；UI组件接收status、recorded、count。不新增IPC事件。

- [ ] 写失败测试：成功/部分/异常/禁用/分派状态经过新service读取一致；旧/未知字段为unknown；失败模型请求和失败写入保留上一记录。UI以testid `memory-recall-status`区分状态，切换/删除/折叠正确。损坏模型E2E增加受限提示、刷新、新会话及返回原会话检查。
- [ ] 运行定向Vitest及旧包E2E，期望新增状态断言失败，保存原始证据。
- [ ] 实施上述接口和组件；在消息/提示记录同一事务内保存状态，缺少callback视作unavailable，现有正常及异常提示逻辑保持。
- [ ] 定向测试通过；全仓`npm run verify`，期望0失败，旧追踪映射不是SRS全验收。
- [ ] 独立新目录打包，完整Playwright新包回归，期望全部通过无跳过；核对源资源、旧包哈希和真实截图。
- [ ] 一次新上下文独立审阅，处理阻塞项；归档证据与交付说明，只提交通过的代码并普通推送GitHub。

整个任务测试命令：`npm run verify`。原生桌面模型和三维工程不属于本计划。源代码、测试和验收报告为单个可独立审阅增量；不在未验证中途推送。
