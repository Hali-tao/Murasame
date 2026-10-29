# Directory Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本任务已核验的文件新增不再使目录观察检查点误判失败。
**Architecture:** 保留原检查点，按兼容的依赖后续步骤计算恢复时预期目录成员；新增文件核对实际哈希，其他步骤和条件仍独立复核，记录恢复证据。
**Tech Stack:** TypeScript、Node文件系统、SQLite、Vitest、Playwright、Electron；不增加依赖。
**Spec:** docs/superpowers/specs/2026-10-30-directory-checkpoint-design.md

## Global Constraints

原需求不改；角色暂停；仅合成资料；原审批/文件保护/未知副作用停止规则保持；验证与打包串行；保留失败与旧包；只普通推送已检查代码；不评论/关闭issue。

## Review Focus

- 依赖关系及计划/步骤哈希失配不得把旧产物认作新任务的合法新增。
- 外部新增/删除、已完成产物改写、读取来源变化仍阻止继续。
- 嵌套路径、step.workspace和检查点乱序仍正确限定真实目录。
- 未知/失败/未完成影响和移动/删除不作为新增白名单。
- 恢复后的历史Worker输出不变，单次批准仍只有一次新调用；服务重启后规则一致。

### Task 1: Reconcile directory observations with verified additions

**Files:** 新增src/main/task/directory-observation.ts；修改src/main/agent/executor.ts；新增tests/unit/task-directory-checkpoints.test.ts、tests/e2e/task-directory-checkpoints.spec.ts；新增交付记录与独立证据。

**Interfaces:** `expectedDirectoryListing(root: string, directory: string, observed: string, effects: readonly FileEffect[]): string | undefined`返回可独立对照的排序JSON，仅接受当前哈希匹配的文件新增；executor筛选当前图中的兼容已完成后续检查点。独立核验可接受可选目录预期，其他路径不变。

- [x] 编写真实执行器/SQLite测试，先证明连续三次批准、重启恢复、嵌套/workspace/乱序时旧代码失败；检查反例保持停止、无重放、原回执不变。
- [x] 新增旧包真实IPC/页面三次批准场景及外部新增反例，保存失败证据。
- [x] 实施目录预期计算、依赖筛选和恢复Critic证据；运行定向测试，期望全部通过。
- [x] 完整`npm run verify`通过后本地提交；一次新上下文只读审阅，阻塞项RED→GREEN修正。
- [x] 串行独立打包、资源核对及最终包完整Playwright，0失败0跳过；目视实际截图。
- [ ] 归档失败/通过证据和限制，普通推送并核对远端SHA。

源码任务完成门为`npm run verify`；发布另须最终包与归档门完成。执行者在当前已授权分支完成，不重复创建自动任务或角色稿。
