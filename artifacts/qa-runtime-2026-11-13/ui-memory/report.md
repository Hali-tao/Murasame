# 界面重复操作的内存增长（泄漏判定）

- 时间：2026-11-12T19:35:25.318Z

| 场景 | 起始总内存 | 结束总内存 | 增长 | 尾部增长 | 判定 | 空闲后变化 |
| --- | --- | --- | --- | --- | --- | --- |
| idle-control | 228.2MB | 234.1MB | 5.9MB | 5.9MB | OK | 2.2MB |
| navigation-240 | 228.5MB | 312.5MB | 84MB | -0.2MB | OK_BOUNDED | 1.5MB |
| pet-chat-toggle-150 | 225.2MB | 230MB | 4.8MB | 1.6MB | OK | 1.9MB |
| window-hide-show-150 | 225.8MB | 227.3MB | 1.5MB | 0.4MB | OK | 2.1MB |

## 发现
- 无