# 强杀/重启韧性探测

- 时间：2026-11-13T02:01:25.313Z

| 场景 | 结论 | 关键证据 |
| --- | --- | --- |
| 首次启动早期强杀（Local State 未落盘） | OK_RECOVERED | 恢复标记=safe-storage-key-unreadable-and-local-state-missing, 备份文件=2, 重启={"bootstrapOk":true,"bootstrapError":null,"memoryPersisted":false,"writeAfterRestart":true,"exportOk":true,"quit":{"quitMs":227,"hung":false}} |
| 耐久化完成后强杀 | OK | Local State=true, 记忆保留=true |
| 连续强杀/重启 3 轮 | OK | 见 summary.json |

## 发现
- 无

## 已知限制
- 首次启动前约 10 秒内（Local State 未落盘）被强杀时，旧加密数据库在密码学上无法解密；现在的行为是**备份旧文件并明确告知用户后重新开始**，不是静默丢数据，但旧数据无法恢复。