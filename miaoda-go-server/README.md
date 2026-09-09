# 秒答 Go 后端

Go 1.24+ 和 SQLite，默认端口 3001。数据库首次启动时自动创建。

复制 `.env.example` 为 `.env`，填写自己的模型 API Key、随机 JWT 密钥和管理员初始密码，再从仓库根目录运行 `start-backend.cmd`。参数与启动步骤见 [简明配置说明](../docs/简明配置说明.md)。

服务进程从环境变量读取配置；根目录 Windows 启动脚本会加载 `.env`。在其他系统中需自行加载环境文件。

验证：`go test ./...`、`go vet ./...`。构建：`go build -o miaoda-server ./cmd/server`。
