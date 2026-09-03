# 远程工作台参考说明

## 结论

`/workspace` 这条线的产品主路径是 SSH 目标接入：家庭中枢登记真实电脑/NAS，后续再打开终端流和文件系统。

`coder/code-server` 只保留为早期参考，不再作为产品主路径。

原因很直接：

1. SSH 是远程电脑/NAS 的真实主通道，适合家庭中枢长期运行。
2. code-server 天然覆盖浏览器终端、文件树、编辑器和工作区入口，适合作为可选侧车。
3. HomeSense 只需要做“登记、编排、上下文注入、独立认证”，不重复实现已经成熟的工作台内核。
4. 现在我们直接做源码级工作区内核，不再走容器包装。

参考：

- https://github.com/coder/code-server
- https://coder.com/docs/code-server/latest

## 在 HomeSense 里的分工

- `terminal-ssh-gateway`：主路径，负责真实 SSH 目标、终端流和连接探测。
- `code-server-workspace`：可选浏览器工作台侧车，需要完整编辑器视图时使用。
- `filesystem-gateway`：只做远程目录/预览/搜索能力，不负责编辑器本体。
- `message-gateway`：和工作台同级，不混在 Chat 里。
- `remote_workspace_target`：登记一个真实工作区目标，优先存到外部能力表里，不单独造新表。

## 当前接口

- `GET /api/remote-workspace/status`：探测登记状态、code-server `/healthz`、code-server CLI、SSH CLI、可选侧车启动命令。
- `GET /api/remote-workspace/targets`：列出当前可用的工作台目标，包括本机 code-server 和已登记远程主机。
- `POST /api/remote-workspace/targets`：登记一个新的 SSH / HTTP 工作区目标，保存的是目标声明，不是账号密码。
- `POST /api/remote-workspace/targets/:id/probe`：按需探测单个目标。SSH 目标走系统 OpenSSH，HTTP/code-server 目标走健康检查。
- `DELETE /api/remote-workspace/targets/:id`：删除登记的工作区目标。
- `POST /api/remote-workspace/start`：优先尝试本机 `code-server` CLI，最后才是 `npx --yes code-server`。下一阶段会把真正的源码级工作区内核接进来，逐步替换这条临时参考路径。
- `POST /api/remote-workspace/stop`：停止本轮由 HomeSense 启动的侧车进程。

默认启动命令绑定在 `127.0.0.1:8080`，避免直接暴露到局域网；以后可以通过 SSH tunnel 或反向代理开放访问。

可覆盖环境变量：

- `HOMESENSE_CODE_SERVER_COMMAND`
- `HOMESENSE_CODE_SERVER_BIND_ADDR`
- `HOMESENSE_CODE_SERVER_AUTH`
- `HOMESENSE_CODE_SERVER_USER_DATA_DIR`
- `HOMESENSE_REMOTE_WORKSPACE_ROOT`
- `HOMESENSE_CODE_SERVER_ALLOW_NPX`
- `HOMESENSE_SSH_COMMAND`

默认状态探测不会执行 `npx --yes code-server`，因为刷新页面不应该偷偷下载依赖。点击启动侧车时，启动顺序是：本机 `code-server` CLI、最后才是 `npx --yes code-server`。npx 兜底启动前必须先跑通真实 `code-server --version`；任何启动方式之后也要等 `/healthz` 返回可达，不能只因为进程发出去了就宣称已就绪。如果希望状态探测也显示 npx 候选，可设置 `HOMESENSE_CODE_SERVER_ALLOW_NPX=1`。

SSH 目标探测使用系统 OpenSSH，默认参数是 BatchMode、无交互密码提示、短超时。它只验证当前主机/agent/known_hosts 是否已经具备连接条件，不替 HomeSense 保存 SSH 密钥或密码。

## 认证边界

每个外部能力都保持独立认证：

- code-server 自己的密码或反向代理会话
- SSH key / agent
- SFTP / 文件服务凭据
- 消息平台 token

HomeSense 负责注册、发现、调度和展示，不接管外部系统自己的登录态。

## 下一步

1. 把 SSH 目标登记、探测、打开终端流做成主链路。
2. code-server 作为可选工作台侧车，保留启动/停止/打开入口。
3. 后续再拆独立文件系统网关，优先复用 SFTP 或成熟文件服务。
