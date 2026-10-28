# 模型表单异步输入竞态修复

冻结时间：2026-10-29 06:07:58 +08:00。

## 根因与红证据

完整旧包的 task-directory 第二项在配置模型时得到 `新的模型配置端到端测试服务`。页面的 `addModel` 等待异步创建期间，名称输入框仍可编辑；创建返回后无条件回写默认名称。因此可能覆盖已输入文字，也可能在浏览器已经选中旧值、尚未插入文本时改变受控 input 的值和光标位置。

`baseline-race.test.ts` 在改生产代码前用受控 Promise 分开这两个时序，不添加任意等待：

1. 新增未返回 → 输入 `用户已经输入的名称` → 新增返回，实际名称变成 `新的模型配置`。
2. 新增未返回 → 聚焦并选中空名称（selection `[0,0]`）→ 新增返回，selection 变成 `[6,6]` → 插入 `端到端测试服务`，实际得到完全相同的 `新的模型配置端到端测试服务`。

原始输出：`baseline-race.txt`。这是使用真实页面和 store、受控 API 返回的 jsdom DOM 复现；实际 Electron 同样字符串的失败由 root 的完整包测试提供。历史红探针独立放在 previews 中，不加入常规测试套件。

新增永久回归的前 6 项在生产修改前全部失败：`unit-all-before.txt`。其中还证明点击“再测一次”会把已修改、尚未验证的名称恢复成旧保存值。基线 create 请求抛错还产生未处理 rejection。

## 修改

仅修改 `src/renderer/src/pages/ModelsPage.tsx`，新增 `tests/unit/model-form-lifecycle.test.ts`；store 未改。

- 新增本地完整事务锁，覆盖创建、验证、自动启用的全部 await 和最终草稿更新；新增、删除、启用、重测共用 try/catch/finally，异常也会解锁并显示错误。
- 原生 disabled fieldset 同时禁用字段、预设、显示密钥、模型列表和动作按钮。继承所有 `model:*` store busy，使操作期间离开再进入页面也不能编辑。
- 清空 fieldset 默认 border、margin、min-width，继续使用原 `.page` padding 和原网格，不增加外框。
- 未编辑表单直接派生自当前选中保存配置，只有用户编辑才保存本地 override。迟到的选择/配置结果会更新重入页面；本页未提交的 override 在请求失败时保留。
- 重测保存的当前服务只在草稿未修改时清除 override，保留已编辑名称等字段。
- 操作期间显示进度，完成后恢复原编辑流程。

## 绿证据

`npx vitest run tests/unit/model-form-lifecycle.test.ts`：10/10 通过，见 `unit-final.txt`，2026-10-29 06:07:31 开始。

覆盖新增完成前禁用所有字段/预设、新增失败保留草稿、验证与启用两阶段连续禁用、创建异常恢复、删除期间禁止选择别的模型、重测保留脏草稿，以及验证/删除/启用/重测异常后的解锁与再次新增。

`npx tsc --noEmit -p tsconfig.web.json`：退出 0，`typecheck-web.txt`。

`npx eslint src/renderer/src/pages/ModelsPage.tsx tests/unit/model-form-lifecycle.test.ts`：退出 0，`lint-final.txt`。

`git diff --check -- src/renderer/src/pages/ModelsPage.tsx tests/unit/model-form-lifecycle.test.ts`：通过。

没有构建 out，没有改 E2E 等待或清理 test-results。真实新包全量回归、截图和独立离页重入检查由 root 与 reviewer 接续。

## 冻结指纹

ModelsPage.tsx SHA256：`6FE9E38BA2183B56B3824E2383DE64C29E80959924D6BD1674D42E4117F57B46`

model-form-lifecycle.test.ts SHA256：`CBF1E6C97D791C2B6791459835E61C4CF7051C20E7CF657C704AE32CD7D85A7B`

没有提交或推送。
