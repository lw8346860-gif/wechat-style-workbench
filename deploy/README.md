# 图文读取服务

`wechat-image-helper.service` 运行项目中的 Node 助手，仅监听服务器回环地址 4318。
`mp-togma.nginx.conf` 为现有站点增加 `/api/` 转发和请求限制。部署前备份站点与 Nginx 配置，验证 `nginx -t` 后再 reload。

服务器文件：

- `/opt/wechat-workbench/wechat-link-helper.mjs`
- `/etc/systemd/system/wechat-image-helper.service`
- `/etc/nginx/sites-enabled/mp-togma`

服务管理：`systemctl status wechat-image-helper`；运行日志：`journalctl -u wechat-image-helper`。
读取服务只在内存中转送公开资源，不保存正文、图片或访问凭证，不转发浏览器登录 Cookie。
公开健康检查：`https://mp.togma.online/api/health`，期望 `version: 2`。

测试顺序：先 `node --test tests/link-helper.test.mjs`，然后在独立 Chrome CDP（9333）和本地静态服务（4319）环境中依次运行 `remote-images-regression.mjs`、`media-regression.mjs`、`docx-regression.mjs`。这三个脚本会操作同一测试标签页，不要并行运行。
