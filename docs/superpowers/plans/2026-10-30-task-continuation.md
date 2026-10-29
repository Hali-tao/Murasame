# Task Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 任务取消和后续补充不被晚到的旧计划覆盖。
**Architecture:** 每任务请求标识配合等待后的有效性检查，计划准备与持久保存分离；保留原审批和恢复机制。
**Tech Stack:** TypeScript、Electron、SQLite、Vitest、Playwright；不加依赖。
**Spec:** docs/superpowers/specs/2026-10-30-task-continuation-design.md

## Global Constraints

原SRS不改；用户授权自主实施软件细节；角色暂停；独立测试资料；不评论/关闭issue；验证和打包串行；只普通推送已检查代码；保留旧安装包和失败证据。

## Review Focus

- 取消发生在计划生成或检查点预览期间，都不能恢复任务或保存新计划。
- 新请求先失败时旧请求不能重新生效。
- 旧请求先返回时不能清除新请求标识。
- 不同任务互不取消；显式重新补充仍可恢复。
- 计划准备失败保留之前计划、任务信息和已有产物，不重复执行检查点。

### Task 1: Guard and stage task continuations

**Files:** 修改src/main/core/services/task-service.ts；新增tests/unit/task-continuation-races.test.ts、tests/e2e/task-continuation.spec.ts；新增专项交付记录和独立证据目录。

**Interfaces:** 公开`continueTask(id, answer): Promise<Result<Task>>`不变；内部每任务Symbol标识，私有preparePlan(plan, root): TaskPlan与storePlan(id, plan): void分离；cancel使进行中补充失效。

- [x] 在真实SQLite任务服务中写延迟计划/检查点测试，断言取消后status仍已取消且plan/title/steps不被旧结果替换；双请求仅最新可保存（包括最新失败）；任务隔离和再次恢复通过。
- [x] 定向运行新文件，预期旧源码至少取消/逆序用例失败，保存完整失败日志；增加实际旧包IPC取消场景并保存失败证据。
- [x] 实施请求标识与每次等待后的检查，先prepare/preview再store，过期结果不广播。保存路径不新增异步间隙，不改变模型/审批约束。
- [x] 新旧任务相关测试与`npm run verify`全部通过，记录实际数量。源码检查通过后本地提交并进行一次新上下文只读审阅；阻塞发现以RED→GREEN修正。
- [x] 新目录串行打包并核对资源，运行最终包完整Playwright（新场景、旧任务、记忆、桌宠、真实隔离创作），预期0失败0跳过；目视新截图。
- [x] 归档失败/通过日志、指纹、审阅及剩余边界，普通推送并核对GitHub SHA。保持角色与真实数据不变。

整体检查命令`npm run verify`。一次独立可交付修复，不在未通过检查时推送。
