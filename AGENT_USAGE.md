# 用 Agent 操作公众号操作台

本文是项目使用说明，不是已安装的 Skill。适用于具有浏览器操作、真实剪贴板和必要文件上传能力的 Agent；只有对话/JSON 输出能力的模型不能完成跨平台图文迁移。

## 可直接交给 Agent 的指令

> 在公众号操作台中新开一个工作标签页，将 https://mp.weixin.qq.com/s/1G4siApVYJjMs-L6ciBvCQ 导入正文大编辑区，等待图片收集和预览完成。本例应有 7 张有效图片，缺图数为 0。保留全部自然段、图文顺序和原图，按当前主题自动排版。不要把带图文章转成纯文字 JSON 后替换编辑器。
>
> 点击整篇“复制富文本”按钮，将内容粘贴到【目标平台】。以目标编辑器实际保留的正文、7 张已加载图片和图文顺序作为成功标准，不能只凭操作台“已复制”就结束。
>
> 如果接收端过滤整篇 HTML 中的图片，保留文字，使用工具的文件保存/上传能力取得原图，再按原位置逐图上传补齐；这些步骤由你完成。不要用预览缩略图或截图代替原图，不要把图片 Base64 大段贴进对话。不支持文件上传时，准确报告工具缺口。
>
> 完成后报告“导入图数、整篇复制图数、目标平台实际图数”。停留在目标编辑页面，不发布文章。

替换【目标平台】后使用。除测试例子外，图片数应从当前文章实测，不固定为 7。

## 操作顺序

1. 保留用户原来的标签页，在新标签页打开 `https://mp.togma.online/`。确认版本至少为 v1.0.9；需要移动布局可用 `index.html?view=mobile`。
2. 在新工作页中清除指导范文，在正文大编辑框粘贴单条公开链接。顶部“学习新格式”是样式学习入口，不承担正文导入。
3. 等待导入结束，检查有效图片数量、缺图标记及读取提示。存在缺图时先重试或补图，不把部分导入当作完成。文章库在当前页面内存中；取得原图后保持这个标签页打开，不刷新或跳转走。
4. 用“自动排版”及工具栏调整版式。带图文章直接在原编辑器中操作；`importArticle(JSON)` 是文字结构导入，会重新构建正文，不是保留现有图片的排版方法。
5. 点击整篇“复制富文本”。点击图片后按 Cmd/Ctrl+C 会走单图复制；不要把单图复制误当成全文复制。也不要直接复制编辑器 `innerHTML`：里面是仅在本页可用的 blob 预览和内部图片编号。
6. 在另一个标签页的目标正文编辑器中普通粘贴。等待目标平台完成图片处理，然后核对正文、图片数量、加载状态和前后位置。目标平台不接受图片时，按下面的兼容处理继续。

## 浏览器工具允许页面 JavaScript 时

先切换到含有 `#editor` 的工作台页面/iframe。可以调用真实存在的页面接口导入链接：

```js
await window.WeChatWorkbench.importLink(articleUrl);
```

如果 Agent 已在源文章页面读取了完整正文 HTML，可在工作台的主页面执行上下文中调用：

```js
await window.WeChatWorkbench.importHtml(articleHtml, articleUrl);
```

这个接口会收集原图、保留图文顺序并建立撤回记录；不要用 `editor.innerHTML = articleHtml` 代替。v1.0.9 的 `mediaDiagnostics()` 还提供当前 `documentImages` 和 `missingImages` 数量。

有些浏览器工具（例如本机 Chrome 155 的 Apple Events JavaScript）在隔离上下文中执行代码，看不到页面的 `window.WeChatWorkbench`。此时改用真实 UI 操作，或使用工具明确提供的主页面执行上下文；不要仅凭全局变量不可见就断定程序未启动。

接口返回或 `pendingImports` 归零不代表导入成功，必须继续检查：

```js
const editor = document.getElementById('editor');
({
  importing: window.WeChatWorkbench.mediaDiagnostics().pendingImports,
  previewing: window.WeChatWorkbench.mediaDiagnostics().pending,
  images: editor.querySelectorAll('img').length,
  missing: editor.querySelectorAll('img[data-image-missing]').length,
  message: document.getElementById('media-status').textContent
});
```

自动排版按钮：`#format-all`。整篇复制按钮：桌面 `#copy-rich`，移动端 `[data-mobile-action="copy"]`。使用浏览器工具真实点击复制按钮，保留浏览器的用户手势；不要用 `navigator.clipboard.writeText()` 代替富文本复制。

`mediaDiagnostics().count` 是原图库的去重资源数，可能还包含撤回记录中的图片，不等于当前文章的图片数量；当前图片数应从编辑器节点统计。

## 为什么单图能粘、整篇却可能不行

- 整篇复制：`text/html` + `text/plain`，所有图片的原始字节内嵌在 HTML 中。
- 单图复制：`text/html` + `image/png`；接收端的粘贴事件还会得到一个图片文件。

有的平台能处理 HTML 内嵌图片，有的平台只处理剪贴板图片文件。后者会出现文字能粘、单图能粘、整篇图片不进来的情况。这需要适配接收端，不能靠改提示词或重复点击“复制”改变。

有文件能力的 Agent 可以读取本次整篇复制的富文本数据，在工具侧把其中 `img src="data:image/..."` 还原为原图文件，再使用目标平台的图片上传入口按原位置补入。只读取本次文章的剪贴板，不读取无关历史内容。不要从工作台 `blob:` 预览下载并冒充原图。

若不能访问真实剪贴板或文件上传，Agent 应报告这项具体缺口。目标平台未指定时，先完成工作台内的导入和排版，询问目的地，不猜测要写入哪个账号或平台。

## 已验证与未验证的边界

用户示例文章在 v1.0.8 中可导入 7 张原图。真实浏览器 Clipboard API 写入后，执行受信任的粘贴事件，普通 contenteditable 接收器一次收到了 7 张图片；整篇粘贴事件中没有独立文件，单图粘贴事件有 `image/png` 文件。

v1.0.9 另行验证了用户实际关心的入口：真实 Chrome 打开公众号文章 → 全选正文 → Cmd+C → 工作台 Cmd+V。剪贴板中有 3 个普通图片节点、4 个 `imgurl` 图片链接和 22 个空残留；修复后在原位恢复为 7 张图片，逐张滚动后全部加载显示。这个入口与“粘贴文章链接导入”是不同的验收项。

这个测试不等同于某个微信公众号、飞书或其他平台已验收。最终以指定目标平台的实际接收结果为准。

浏览器剪贴板的 HTML 与 PNG 类型定义可参照 [W3C Clipboard API](https://www.w3.org/TR/clipboard-apis/#mandatory-data-types)；这是格式边界，并不表示所有接收端都会采用同一种粘贴处理方式。

测试入口：`tests/clipboard-roundtrip.mjs`。macOS 下通过 `tests/preserve-clipboard-macos.swift` 包装执行；包装器不输出用户剪贴板内容，测试若触碰系统剪贴板，会在确认仍是测试数据时恢复原内容。
