# 逐路由内存增长（每次挂载/卸载 120 轮）

| 场景 | 起始 | 结束 | 增长 | 尾部增长 | 判定 | 空闲后变化 |
| --- | --- | --- | --- | --- | --- | --- |
| route-nav-chat-120 | 225.4MB | 314.3MB | 88.9MB | 0.9MB | OK_BOUNDED | -6.1MB |
| route-nav-memory-120 | 225.1MB | 312MB | 86.9MB | -0.4MB | OK_BOUNDED | 0.7MB |
| route-nav-tasks-120 | 228.2MB | 309.4MB | 81.2MB | 0.5MB | OK_BOUNDED | 1.7MB |
| route-nav-character-120 | 228.5MB | 306.5MB | 78MB | -0.1MB | OK_BOUNDED | 1.4MB |
| route-nav-settings-120 | 225.5MB | 321.6MB | 96.1MB | 1.4MB | OK_BOUNDED | 2.1MB |

## 发现
- 无