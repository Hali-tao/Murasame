# 界面重复操作的内存增长（泄漏判定）

- 时间：2026-11-13T02:04:27.779Z

| 场景 | 起始总内存 | 结束总内存 | 增长 | 尾部增长 | 判定 | 空闲后变化 |
| --- | --- | --- | --- | --- | --- | --- |
| idle-control | 226.2MB | 231.2MB | 5MB | 5MB | OK | 2MB |
| navigation-240 | 231.6MB | 367.3MB | 135.7MB | 7MB | OK_BOUNDED | 1.1MB |
| pet-chat-toggle-150 | 226.3MB | 231.3MB | 5MB | 1.4MB | OK | 0.9MB |
| window-hide-show-150 | 226.2MB | 227.5MB | 1.3MB | 0.3MB | OK | 2.5MB |

## 发现
- 无