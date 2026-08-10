#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "需要 Node.js 18 或更高版本" message "安装后重新双击本启动器。" as critical'
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  osascript -e 'display alert "Node.js 版本过低" message "公众号链接读取需要 Node.js 18 或更高版本。" as critical'
  exit 1
fi

if ! curl -fsS http://127.0.0.1:4318/health >/dev/null 2>&1; then
  nohup node "$SCRIPT_DIR/wechat-link-helper.mjs" >/tmp/wechat-style-link-helper.log 2>&1 &
fi

if ! curl -fsS http://127.0.0.1:4317/ >/dev/null 2>&1; then
  nohup python3 -m http.server 4317 --bind 127.0.0.1 >/tmp/wechat-style-static-server.log 2>&1 &
fi

sleep 0.6
open "http://127.0.0.1:4317/index.html?view=desktop"
