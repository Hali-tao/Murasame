# 界面重复操作的内存增长（泄漏判定）

- 时间：2026-11-14T20:20:24.037Z

| 场景 | 起始总内存 | 结束总内存 | 增长 | 尾部增长 | 判定 | 空闲后变化 |
| --- | --- | --- | --- | --- | --- | --- |
| idle-control | 228.2MB | 231.8MB | 3.6MB | 3.6MB | OK | 1.4MB |
| navigation-240 | 226.4MB | 283.8MB | 57.4MB | 6.5MB | OK_BOUNDED | 0MB |
| pet-chat-toggle-150 | 226.4MB | 231.1MB | 4.7MB | 1.6MB | OK | 0.5MB |
| window-hide-show-150 | 226.1MB | 227.6MB | 1.5MB | 0MB | OK | 1.1MB |

## 发现
- 无