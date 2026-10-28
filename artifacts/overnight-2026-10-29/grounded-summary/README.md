# 有来源摘要：第二轮交付证据

实现及使用说明：`docs/15-GROUNDED-SUMMARY.md`。本目录只含独立测试资料，没有用户真实来源文件、模型凭据或原始 SRS 附件。

- `verify-final.txt`：最终恢复修复后，45个测试文件、518项单元测试、Node/Web类型检查、ESLint、trace74/74全部通过。trace是需求到测试的映射，不代表所有需求已经完整人工验收。
- `e2e-full-before-review-fix.txt`：完整11项Electron回归通过；发生在最后一项窄范围恢复修复之前。
- `e2e-after-review.txt`：重新构建最终业务代码后，两个摘要Electron用例通过，涵盖两次批准、实际来源外发、精确文件保存、慢任务时聊天、隐藏继续和取消丢弃迟到结果。
- `e2e-artifact-action.txt`、`artifact-type-lint.txt`：补充验证成果按钮经真实IPC和主进程文件检查到达系统定位接口；测试替换最后的文件管理器调用，避免打开额外用户桌面窗口。专项1/1及两端类型检查、lint通过。
- `independent-review.md`：独立审查发现一项P2：未知摘要写入可能被改成普通计划而绕过核对。`recovery-regression-red.txt`保留修复前失败证据；根侧已在替换计划前检查持久检查点，最终518项验证包含该修复。
- `summary-source-approval.png`、`summary-draft-approval.png`、`summary-verified.png`：真实Electron页面截图。
- `fixture-summary.md`、`summary-verification.json`：由临时来源生成、经第二次批准后真实写出的Markdown及哈希回执。模型服务为本地可控HTTP测试服务，不代表外部模型的摘要语义质量。
- `build-final.txt`：最终业务代码构建结果；不是安装包，也不代表已更新用户正在运行的安装版本。

本轮流程固定为受控来源摘要，不宣称已经完成通用多智能体办公/编程。引用和字节核验是确定性核验，不是独立语言模型的语义审稿。奶龙资产本轮未改动，第一轮的9组原生动作与证据继续有效。

审查范围与处理决定另保存在 `execution-ledger.md`；所有可复现的重要审查问题均通过回归修复，无未处理的重要发现。
