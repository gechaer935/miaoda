# 秒答 Miaoda

AI 面试与笔试助手，包含 Windows 桌面客户端、Go 后端、手机网页和静态站点。

**开始使用：[简明配置说明](docs/简明配置说明.md)。**

默认需要 DeepSeek 和阿里云百炼两家的 API Key，填写在后端 `.env`。智谱 Key 为可选项；JWT 密钥和管理员初始密码由部署者自行生成。仓库只提供空白配置模板。

| 目录 | 内容 |
| --- | --- |
| `miaoda-desktop/` | Electron + React 桌面客户端 |
| `miaoda-go-server/` | Go + SQLite 后端 |
| `miaoda-mobile-web/` | 手机网页 |
| `miaoda-site/` | 静态站点及账户页 |
| `deploy/Caddyfile.example` | 独立服务器反向代理示例 |

开源版不附带托管服务。`example.invalid` 是不可解析的占位域名，发布自己的客户端前请配置自己的 API、网站和更新地址。个人运维资料、真实环境文件、截图、用户数据和旧发布历史不包含在本仓库中。

桌面端保留原有 [AGPL-3.0 许可证](miaoda-desktop/LICENSE)。依赖包保留各自许可信息。

维护者提交前请运行 `python scripts/check-public-source.py`，并使用 Gitleaks 复查暂存内容及历史。
