@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [公众号操作台] 未找到 Node.js。
  echo 请安装 Node.js 18 或更高版本后重新双击。
  pause
  exit /b 1
)

for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 18 (
  echo [公众号操作台] Node.js 版本过低，需要 18 或更高版本。
  pause
  exit /b 1
)

curl.exe -fsS http://127.0.0.1:4318/health >nul 2>nul
if errorlevel 1 start "公众号链接读取助手" /min node "%~dp0wechat-link-helper.mjs"

timeout /t 1 /nobreak >nul
start "" "%~dp0index.html"
endlocal
