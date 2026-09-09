# 秒答桌面端

Electron + React + TypeScript 客户端。主流程通过自建 Go 后端完成账号登录、面试回答、语音识别、截图解题和手机配对。

配置与启动步骤见 [简明配置说明](../docs/简明配置说明.md)。

```sh
npm ci
npm run build:native
npm run app:dev
```

Windows 原生模块需要 Rust/MSVC、Python 3 和 Visual Studio C++ Build Tools。开发模式默认连接本机后端；正式包使用占位域名，部署者需自行配置。

验证命令：`npm run typecheck:electron`、`npm run build`、`npm run test:lite`。

许可证保留为 [AGPL-3.0](LICENSE)。本项目源于 Natively 桌面助手，保留上游源文件中的版权、署名和依赖许可。
