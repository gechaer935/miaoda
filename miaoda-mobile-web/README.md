# 秒答手机网页

React 19 + TypeScript + Vite 响应式手机网页。第一版采用每次扫码或输入 6 位码配对，不注册 Service Worker，也不缓存截图、卡密和答案。

本地开发先启动 Go 后端，再运行上级目录的 `start-mobile.cmd`，浏览器访问 `http://localhost:5174`。Vite 会将 `/api` 和 `/ws` 代理到 `http://127.0.0.1:3001`。

生产环境构建运行 `build-mobile.cmd`，产物位于 `dist`，由 Caddy/Nginx 与 Go API 同源部署。
