# IPC 错误形态审计

- 时间：2026-11-13T00:29:28.347Z
- 渠道数：69

| 通道 | 结果 | 形态 | 耗时(ms) |
| --- | --- | --- | --- |
| app:get-info | resolved | value | 1 |
| app:hide-to-tray | resolved | value | 0 |
| app:hotkey | resolved | value | 0 |
| core:active-changed | no-handler |  |  |
| core:add-memory | resolved | result | 0 |
| core:approve-task | resolved | result | 1 |
| core:cancel-task | resolved | result | 0 |
| core:clear-memories | resolved | result | 4 |
| core:continue-task | resolved | result | 0 |
| core:conversation-deleted | no-handler |  |  |
| core:conversation-updated | no-handler |  |  |
| core:create-conversation | resolved | result | 18 |
| core:create-model | resolved | result | 4 |
| core:create-task | resolved | result | 0 |
| core:daily-recap | resolved | result | 1 |
| core:delete-conversation | resolved | result | 0 |
| core:delete-memory | resolved | result | 0 |
| core:delete-model | resolved | result | 0 |
| core:deny-task | resolved | result | 0 |
| core:get-bootstrap | resolved | result | 3 |
| core:memories-updated | no-handler |  |  |
| core:memory-extraction-status | no-handler |  |  |
| core:memory-index-status | no-handler |  |  |
| core:memory-recall-sources | resolved | result | 1 |
| core:message-delta | no-handler |  |  |
| core:message-failed | no-handler |  |  |
| core:message-started | no-handler |  |  |
| core:models-updated | no-handler |  |  |
| core:save-character | resolved | result | 0 |
| core:save-model | resolved | result | 0 |
| core:save-recap-note | resolved | result | 0 |
| core:screen-updated | no-handler |  |  |
| core:search-history | resolved | result | 0 |
| core:send-message | resolved | result | 0 |
| core:set-active-conversation | resolved | result | 0 |
| core:set-default-model | resolved | result | 0 |
| core:set-tool-enabled | resolved | result | 0 |
| core:task-updated | no-handler |  |  |
| core:update-memory | resolved | result | 0 |
| core:verify-model | resolved | result | 0 |
| pet:get-affect | resolved | value | 0 |
| pet:get-affect-events | resolved | value | 0 |
| pet:get-bounds | resolved | value | 0 |
| pet:get-state | resolved | value | 0 |
| pet:hide | resolved | value | 7 |
| pet:mute-theater-today | resolved | value | 4 |
| pet:performance | no-handler |  |  |
| pet:reset-position | resolved | value | 17 |
| pet:set-chat-open | rejected | 请求参数无效 | 0 |
| pet:set-ignore-mouse-events | rejected | 请求参数无效 | 0 |
| pet:set-position | rejected | 请求参数无效 | 0 |
| pet:set-scale | rejected | 请求参数无效 | 0 |
| pet:show | resolved | value | 11 |
| pet:state-changed | no-handler |  |  |
| pet:theater | no-handler |  |  |
| pet:toggle | resolved | value | 8 |
| relationship:change-appearance | rejected | 请求参数无效 | 1 |
| relationship:changed | no-handler |  |  |
| relationship:get | resolved | value | 0 |
| relationship:reset | resolved | value | 2 |
| settings:changed | no-handler |  |  |
| settings:get | resolved | value | 5 |
| settings:update | rejected | 请求参数无效 | 1 |
| task:progress | no-handler |  |  |
| window:hidden | no-handler |  |  |
| window:hide-main | resolved | value | 0 |
| window:minimize | resolved | value | 19 |
| window:navigated | no-handler |  |  |
| window:show-main | resolved | value | 22 |

## 发现
- 无：业务通道均为结构化 Result，值通道均以中文错误拒绝，未发现挂起。