# 奶龙（官方形象）贴图来源

- 原始图：第七印象官网 IP 大明星页主形象 `https://www.nailoong.com/_ipx/q_85/img/ipStar/image_nailoong.png`（500×500）。
- 处理：去白底、去烘焙投影后，用 Lanczos 放大到 1000×1000 并轻锐化；未改角色造型。
- 抓取与处理记录：`artifacts/nailoong-official-2026-11-04/`（raw 原图、derived 透明底、索引与来源页）。
- 许可：官方版权素材，**仅用于本项目课程演示，不得公开分发**。与 `docs/05-LICENSES.md` 的 naiwa 条目同一口径。
- 使用方式：`src/shared/avatar/mesh-pose.ts` 的坐标以 500×500 记录，渲染层按贴图实际宽度自动换算 UV。
