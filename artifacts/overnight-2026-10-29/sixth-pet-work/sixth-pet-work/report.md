# 第六轮桌宠真实工作状态映射

初版冻结时间：2026-10-29 06:36:21 +08:00。部分完成补丁已于 06:42:15 +08:00 核对最新冻结指纹。

仅新增 `src/shared/pet-work.ts` 和 `tests/unit/pet-work.test.ts`。未改其他生产文件，未构建 out，未提交。

## 接口和行为

导出 `PetWorkState`、`derivePetWork({ tasks, dismissed, sending, autonomy })`，以及 `PetActivityMotion`、`petWorkMotion(work, presetId, imported)`。均为纯函数，不读取时钟、网络或 UI。

优先级：待确认/等待批准 → 聊天等待 → 正在停止/执行中/规划中/已确认任务 → 隔离活动 → 未收起的失败/中断/已完成/部分完成任务。活动与确认不受终态收起列表影响。同类保持输入顺序。任务链接使用编码后的 focus id。

隔离活动以真实生命周期和 creation.phase 为准：准备/草稿等待、实际执行、核对、待保存、失败、停止中。stopped/idle 始终忽略残留 creation，ready 必须有 artifact，缺产物不会宣称核验成功。成功仅表述“产物已核验，待保存”，不宣称已导出。部分任务只说“做了一部分”。浏览/视频/手动活动保留真实 reason，不编造正在编程。

任务 key 包含 task.id 与 phase；隔离 key 包含可选 activityId 与 phase，ready 额外包含 artifact.id。旧状态没有 activityId 时使用 kind 作为兼容回退。

动作映射：奶龙 WorkingLoop 为实际工作循环，Think 为 waiting/reviewing 的中性循环，Agree/Confused 为单次终态；tororo 持续态仅 Idle、终态使用已有 FlickUp/FlickDown；鲸鱼娘 idle 配问号等待、aidale 配开心兴奋完成、idle 配悲伤失败。导入模型、未知预设、stopping 和空状态不输出内置动作。

## 红绿和验证

- `red.txt`：缺模块时的初始红。
- `business-red.txt`：仅接口占位时 18 项业务断言失败、1 项空状态检查通过。
- `green-final.txt`：最终 19/19 通过，2026-10-29 06:36:09 开始。
- 用例直接读取三个模型的实际 model3.json，确认每个输出动作组和表情存在；包括原生代理新增的 WorkingLoop。
- `lint.txt`：仅两新增文件 ESLint 退出 0。
- `typecheck-web.txt`：web TypeScript 检查退出 0。
- `typecheck-node.txt`：包含新增测试的 Node TypeScript 检查退出 2；唯一报错来自并行集成中的 `Live2DPet.tsx:217` 调用 protected `ExpressionManager.loadExpression`（TS2445）。已立即告知 root，未修改其文件；新增映射和测试无报错。

实际宠物播放、循环调度和聊天瞬态优先级由 root 集成并验证，本任务只负责纯映射。

## 部分完成动作补充

2026-10-29 06:39 补充 root 指定的窄修：任务“部分完成”仍使用 ready 反馈与“做了一部分”文案，但三个预设都改为中性单次 Idle/idle、无表情，不再播放完整成功庆祝，也不改称失败。`partial-red.txt` 为三个预设的失败回归；`partial-green.txt` 最终 22/22 通过，`partial-lint.txt` 退出 0。该补丁已通知 root 冻结。

## 冻结指纹

`pet-work.ts` SHA256：`07C7E0006DE564E615B8774BA81117E2BD1465DD737B719B0BE2E70F96A8A740`

`pet-work.test.ts` SHA256：`54E1A88F10EA4916D087C034320857C0BDA7D29259337055670D352355C73D27`
