# 浏览器端依赖

随项目静态分发，运行时不访问 CDN；无需 Node.js 或后端。

- `purify.min.js`：DOMPurify 3.4.15，用于清理 Word/外部富文本的脚本及事件属性。
  来源：https://unpkg.com/dompurify@3.4.15/dist/purify.min.js
  许可：`DOMPurify-LICENSE`（发行文件内也包含许可证声明）。
- `mammoth.browser.min.js`：Mammoth 1.12.3，按需加载的 DOCX 浏览器转换器。
  来源：https://unpkg.com/mammoth@1.12.3/mammoth.browser.min.js
  许可：`Mammoth-LICENSE`。

腾讯云手动部署和 GitHub Pages 部署必须同时带上本目录及 `media-library.js`。
