# 公众号操作台

面向微信公众号文章的语义结构导入、富文本排版、格式检查和复制工具。

- 桌面入口：`index.html`
- 移动入口：`mobile.html`
- 自定义主题仅保存在当前用户的浏览器本地存储中，不会上传到 GitHub。

GitHub Pages 使用 `.github/workflows/pages.yml` 自动发布。静态版支持排版、检查、Agent JSON 导入、剪贴板复制、本地主题和响应式移动端。

“直接读取公众号公开链接”采用端侧架构：GitHub Pages 只提供界面，用户电脑上的 `wechat-link-helper.mjs` 负责读取并净化公开文章。Mac 用户可通过 `启动公众号操作台.command` 启动。未运行端侧助手时，仍可粘贴带格式全文学习版式。

## 桌面端兼容性

- Windows 10/11：Chrome 或 Edge；如需读取公开链接，安装 Node.js 18+ 后双击 `启动公众号操作台-Windows.cmd`。
- macOS：Chrome 或 Safari；如需读取公开链接，安装 Node.js 18+ 后双击 `启动公众号操作台.command`。
- 无论系统，排版、JSON 导入、格式检查、富文本复制和本地主题都直接在浏览器内运行，不依赖 Node.js。
