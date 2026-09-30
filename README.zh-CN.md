# CursorRemote

[English](README.md)

在本机 Cursor 上远程查看和控制 AI 代理：从手机、平板或其他电脑的浏览器，或通过 Telegram、飞书、QQ，查看会话、审批步骤、阅读完整计划并下达任务。Cursor 仍跑在你的机器上。

<div align="center">

| 手机网页 | Telegram |
|:-:|:-:|
| <img src="media/web-app.gif" alt="手机网页" width="300"> | <img src="media/telegram.gif" alt="Telegram" width="300"> |

<p><b>扩展界面</b> — CursorRemote 侧边栏：服务状态、CDP 连接、代理状态，以及启动 / 停止</p>
<img src="media/extension_tab.png" alt="CursorRemote 扩展侧边栏" width="380">

</div>

## 功能

- **手机网页** — 实时对话，沿用 Cursor 深色主题；审批按钮、完整计划弹层、计划模型选择、运行命令卡片、模式 / 模型切换
- **Telegram** — 对话自动同步到论坛话题，内联按钮审批，任意设备发送提示
- **飞书** — 长连接机器人，不需要公网 webhook。私聊控制当前 Cursor 窗口；审批和计划以卡片到达。在 Setup 面板扫绑定码。
- **QQ 官方机器人** — WebSocket 网关，同样由私聊控制。回复挂在你最近一条消息上，因为 QQ 限制主动推送。
- **多窗口监控** — 所有 Cursor 窗口用各自的 CDP 连接并行轮询（不切换界面）
- **自动建话题** — 新的聊天标签会自动在 Telegram 里建话题
- **VS Code 扩展** — 侧边栏显示服务状态、启动 / 停止、安装向导和设置
- **状态持久化** — 消息、话题、同步和授权在服务重启后仍在

## 怎么工作

```
┌─────────────────────────────────────────────────────────────────┐
│  Cursor 扩展（可选）                                            │
│  拉起服务、提供界面、管理生命周期                               │
│                                                                 │
│  Cursor IDE  ──CDP──>  中继服务   ──socket.io──>  浏览器        │
│  (Windows/Mac)          (Node.js)  ──Bot API───>  Telegram      │
│                                 ──WS──>  飞书 / QQ              │
└─────────────────────────────────────────────────────────────────┘
```

1. **Cursor IDE** 以 Chrome DevTools Protocol 启动（`--remote-debugging-port=9222`）
2. **中继服务** 通过 CDP 连接，从 DOM 提取代理聊天状态
3. **窗口监控** 用各自的 CDP 连接并行轮询所有窗口
4. **浏览器客户端** 在任意设备上实时显示对话
5. **Telegram 机器人**（可选）把数据镜像到自动创建的论坛话题
6. **飞书或 QQ**（可选）由本机向外连接平台。机器上不需要公网 webhook。私聊在一次性 `/bind` 之后控制当前 Cursor 窗口。

## 用哪种安装方式

| | 扩展（推荐） | 独立运行 |
|---|---|---|
| **适合** | 开发机上日常使用 | 无界面机器、CI，或手写配置 |
| **安装** | 一个 `.vsix` | 克隆仓库 + `npm install` |
| **配置** | VS Code 设置 + Setup 面板 | `.env` |
| **服务生命周期** | 自动启动，侧边栏 Start / Stop | 手动 `npm run dev` 或 `npm start` |
| **状态界面** | 侧边栏实时状态 | 终端日志 + `/health` |
| **密码** | 首次安装自动生成 | 在 `.env` 里手写 |
| **多窗口** | 单例：所有窗口共用一个服务 | 单进程 |

---

## 安装 A：扩展（推荐）

### 1. 安装扩展

从 [releases](https://github.com/len5ky/CursorRemote/releases) 下载最新 `.vsix`，然后安装：

```bash
cursor --install-extension cursor-remote-0.1.52.vsix
```

或在 Cursor 里打开命令面板（`Ctrl+Shift+P`），运行 **Extensions: Install from VSIX...**，选中该文件。

### 2. 输入许可证

在活动栏（左侧）打开 **CursorRemote** 面板。看到 “License Key Required” 后点击并输入密钥。密钥通过 VS Code Secrets API 存在操作系统凭据库里。

还没有密钥？到 [商店](https://cursor-remote.com/buy?utm_source=github&utm_medium=readme&utm_campaign=license) 获取。

### 3. 让 Cursor 打开 CDP

在 Cursor 快捷方式上加上 `--remote-debugging-port=9222`，或这样启动：

```powershell
# Windows
& "$env:LOCALAPPDATA\Programs\cursor\Cursor.exe" --remote-debugging-port=9222
```

```bash
# macOS
open -a Cursor --args --remote-debugging-port=9222
```

```bash
# Linux
cursor --remote-debugging-port=9222
```

**注意：** 加上参数后要完全退出再启动 Cursor。macOS 用 Cmd+Q（不要只关窗口）。验证：`http://localhost:9222/json` 应返回 JSON。

### 4. 服务自动启动

扩展在 Cursor 启动时自动拉起中继。在 **CursorRemote** 侧边栏看实时状态：

- **服务状态** — Running / Stopped / Disconnected
- **CDP 连接** — Connected / Disconnected，以及当前工作区名称
- **代理状态** — idle、正在跑工具等，以及当前模式和模型
- **已连接客户端** — 浏览器会话数量
- **Start / Stop** — 在侧边栏直接控制服务

如果没有自动启动，在侧边栏点 **Start Server**，或在命令面板运行 **CursorRemote: Start Server**。

### 5. 配置网络并连接

运行 **CursorRemote: Open Setup Panel**（或在侧边栏点 **Open Setup Panel**）：

- **网络** — Localhost（默认）、LAN（所有网卡），或指定 IP（Tailscale）
- **网页密码** — 首次安装自动生成；可复制，也可自己改
- **Telegram** — 分步向导：机器人 token、注册口令、用户状态
- **飞书 / QQ** — 应用凭证、轮换的 `/bind` 口令，以及该命令的二维码。见 [飞书接入](docs/zh/feishu_setup.md) 和 [QQ 接入](docs/zh/qq_setup.md)。

在手机、平板或其他电脑的浏览器打开 `http://<server-ip>:<port>`，输入密码。

> **多窗口：** 所有 Cursor 窗口只跑一个服务。最先启动的窗口是 owner；其他窗口作为 observer 挂上，owner 关闭后会自动接管。

### 扩展命令

| 命令 | 说明 |
|---------|-------------|
| `CursorRemote: Start Server` | 启动中继 |
| `CursorRemote: Stop Server` | 停止中继 |
| `CursorRemote: Restart Server` | 重启中继 |
| `CursorRemote: Open Web Client` | 打开浏览器客户端地址 |
| `CursorRemote: Open Setup Panel` | 打开网络、Telegram、飞书、QQ 安装向导 |
| `CursorRemote: Show Logs` | 在输出面板查看服务日志 |
| `CursorRemote: Enter License Key` | 输入并保存许可证 |
| `CursorRemote: Buy License` | 打开商店链接 |

### 扩展设置

都在 VS Code 设置的 `cursorRemote.*` 下。每项设置里有指向说明的链接。

| 设置 | 默认 | 说明 |
|---------|---------|-------------|
| `autoStart` | `true` | 启动时自动拉起服务 |
| `cdpUrl` | `http://127.0.0.1:9222` | Cursor 的 CDP 地址 |
| `serverPort` | `3000` | 网页端口 |
| `serverHost` | `127.0.0.1` | 绑定地址（默认只监听本机） |
| `pollIntervalMs` | `500` | DOM 轮询间隔（毫秒） |
| `debounceMs` | `300` | 广播间隔（毫秒） |
| `logLevel` | `info` | 服务日志级别 |
| `webappPassword` | *（自动生成）* | 网页密码 |
| `windowTitleQualifier` | `true` | 标题里包含远程限定符 |
| `telegram.enabled` | `false` | 启用 Telegram |
| `telegram.botToken` | -- | 已废弃。token 经 Setup 面板存在 SecretStorage |
| `telegram.allowedUsers` | -- | 允许的用户 ID，逗号分隔 |
| `feishu.enabled` | `false` | 启用飞书长连接机器人 |
| `feishu.appId` | -- | 飞书自建应用 ID（`cli_xxx`） |
| `feishu.appSecret` | -- | 存在 SecretStorage；设置项留空 |
| `feishu.allowedUsers` | -- | 跳过 `/bind` 的 open_id，逗号分隔 |
| `qq.enabled` | `false` | 启用 QQ 官方机器人 |
| `qq.appId` / `qq.appSecret` | -- | App ID 写在设置里；密钥在 SecretStorage |
| `qq.sandbox` | `false` | 审核通过前使用 QQ 沙箱网关 |
| `qq.allowedUsers` | -- | 跳过 `/bind` 的 `user_openid`，逗号分隔 |

---

## 安装 B：独立服务（不用扩展）

从命令行直接跑中继。适合无界面机器、远程服务器，或希望用 `.env` 管理配置。

### 前提

- Node.js 20+
- 带 `--remote-debugging-port=9222` 的 Cursor IDE
- 同一网络上的浏览器（网页客户端）

### 安装并运行

```bash
git clone https://github.com/len5ky/CursorRemote.git cursor-ide-remote
cd cursor-ide-remote
npm install
cp .env.example .env
npm run dev
```

首次运行会提示输入**许可证**。到 [商店](https://cursor-remote.com/buy?utm_source=github&utm_medium=readme_standalone&utm_campaign=license) 获取。密钥保存在 `data/license.key`。

编辑 `.env` 配置服务。Telegram 设置 `TELEGRAM_ENABLED=true` 和 `TELEGRAM_BOT_TOKEN`。飞书用 `FEISHU_*`，QQ 用 `QQ_*`（见 `.env.example`）。

### 独立运行配置

| 变量 | 默认 | 说明 |
|----------|---------|-------------|
| `CDP_URL` | `http://127.0.0.1:9222` | Cursor 的 CDP 地址 |
| `SERVER_PORT` | `3000` | 网页端口 |
| `SERVER_HOST` | `127.0.0.1` | 绑定地址 |
| `POLL_INTERVAL_MS` | `500` | DOM 轮询间隔（毫秒） |
| `DEBOUNCE_MS` | `300` | 广播间隔（毫秒） |
| `LOG_LEVEL` | `info` | 日志级别 |
| `WEBAPP_PASSWORD` | -- | 网页密码 |
| `TELEGRAM_ENABLED` | `false` | 启用 Telegram |
| `TELEGRAM_BOT_TOKEN` | -- | @BotFather 给的 token |
| `TELEGRAM_ALLOWED_USERS` | -- | 允许的用户 ID，逗号分隔 |
| `FEISHU_ENABLED` | `false` | 启用飞书长连接 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | -- | 飞书自建应用凭证 |
| `FEISHU_ALLOWED_USERS` | -- | 跳过 `/bind` 的 open_id，逗号分隔 |
| `QQ_ENABLED` | `false` | 启用 QQ 官方机器人 |
| `QQ_APP_ID` / `QQ_APP_SECRET` | -- | QQ 机器人凭证 |
| `QQ_SANDBOX` | `false` | 审核通过前使用沙箱网关 |
| `QQ_ALLOWED_USERS` | -- | QQ `user_openid`，逗号分隔 |
| `LICENSE_KEY` | -- | 环境变量里的许可证（覆盖文件） |
| `DATA_DIR` | `./data` | 持久化数据目录 |
| `LOG_FORMAT` | `text` | 设为 `json` 时输出结构化日志 |

### 生产运行

```bash
npm run build
npm start
```

运行 `npm start` 之前要已有 `data/license.key`（生产模式没有交互提示）。

> **WSL2：** 端口转发见 [安装指南](docs/zh/setup-guide.md)。

---

## 安全

默认就是收紧的：

- **只监听本机** — 默认绑定 `127.0.0.1`，除非你明确打开，否则不会暴露到网络。
- **自动生成密码**（扩展）— 首次安装生成随机密码，用来保护网页。
- **加密保存密钥**（扩展）— 许可证和密码通过 VS Code Secrets API 存在操作系统凭据库。

### 从另一台设备访问

**方式 A：Tailscale（推荐）** — 在电脑和手机上安装 [Tailscale](https://tailscale.com/)。服务走私有 WireGuard 网格，不需要端口转发。见 [Tailscale 说明](docs/tailscale-setup.md)（英文）。

**方式 B：局域网** — 打开 **Setup 面板**（扩展），或设置 `SERVER_HOST=0.0.0.0`（独立运行）。服务监听所有网卡，并要求密码。

两种可以一起用。

## 隐私

CursorRemote **完全自托管**。没有回传、没有遥测、没有分析、没有用量统计。软件不会连接我们的服务器——启动时不会，使用中不会，任何时候都不会。许可证在本地离线校验。我们看不到这些数据。

网页客户端留在你的机器和网络上。如果打开 Telegram、飞书或 QQ，经该机器人收发的消息也会经过对应平台的服务器。中继本身仍在本地运行，不需要公网 webhook。

## Telegram

最省事的做法是 **Setup 面板**：运行 **CursorRemote: Open Setup Panel**，切到 Telegram 页。向导会显示注册口令和已注册用户。

### 手动配置

1. **创建机器人**：给 `@BotFather` 发 `/newbot`，复制 token
2. **写入配置**：扩展在 VS Code 设置里填 `cursorRemote.telegram.botToken`，独立运行在 `.env` 里填 `TELEGRAM_BOT_TOKEN`，并启用 Telegram
3. **建群**：创建开启 Topics 的超级群，把机器人设为管理员，并给予 Manage Topics
4. **注册**：启动服务，在输出面板（扩展）或终端（独立运行）看到注册口令，在群里发送 `/register <token>`
5. **同步**：发送 `/sync` 打开自动同步。每个窗口 + 聊天标签会自动建话题。

### 机器人命令

| 命令 | 说明 |
|---------|-------------|
| `/register <token>` | 用服务输出里的口令注册 |
| `/sync` | 打开自动同步（活动标签建话题，并带最近 5 条消息） |
| `/sync_all` | 为所有窗口的全部标签建话题 |
| `/unsync` | 关闭同步并删除已跟踪的话题 |
| `/cleanup` | 删除过期、未跟踪的话题 |
| `/purge` | 删除全部话题（后台执行） |
| `/status` | 连接、同步、群 ID、代理信息 |
| `/history [N]` | 最近 N 条消息（默认 5），会滚动聊天以加载更多 |
| `/mode` | 查看 / 切换代理模式（切到该话题对应的窗口） |
| `/model` | 显示当前模型 |
| `/plan <text>` | 以 Plan 模式发送提示 |
| `/agent <text>` | 以 Agent 模式发送提示 |

任意话题里的普通文本会作为提示发给对应的 Cursor 代理。

## 飞书和 QQ

两者都可选，默认关闭。中继主动向平台建立 WebSocket，机器不需要公网 IP 或 ngrok。在 Setup 面板保存凭证并重启后，在私聊里发送轮换的 `/bind` 口令。该私聊随后控制**当前** Cursor 窗口。

| | 飞书 | QQ |
|---|---|---|
| 安装 | [docs/zh/feishu_setup.md](docs/zh/feishu_setup.md) | [docs/zh/qq_setup.md](docs/zh/qq_setup.md) |
| 会话 | 私聊。群可以绑定，但还不能驱动 Cursor。 | 仅私聊 |
| 审批 | 交互卡片，包括 Run / Skip 和计划 Build | 挂在你最近一条消息上的键盘按钮，或 `/do <id>` |
| 对话记录 | 状态，以及新增和被编辑的消息 | 不会完整镜像。发送 `/status`。QQ 限制主动推送。 |

尚未审核通过的 QQ 机器人需要 **Sandbox**（`qq.sandbox` / `QQ_SANDBOX=true`）和控制台的扫码聊天。如果控制台要求 IP 白名单，把这台机器的公网出口 IP 加进去。

## 脚本

| 命令 | 说明 |
|---------|-------------|
| `npm run dev` | 开发热重载（缺少许可证时会提示） |
| `npm run build` | 编译 TypeScript 并复制客户端 |
| `npm run build:ext` | 打包 VS Code 扩展 |
| `npm run watch:ext` | 扩展开发监视模式 |
| `npm run package` | 递增补丁版本，并把 .vsix 打进 `releases/` |
| `npm run release -- patch\|minor\|major` | 递增版本、更新变更记录、打 git 标签 |
| `npm start` | 运行编译后的服务 |
| `npm run discover` | DOM 发现工具 |

## 文档

- [中文索引](docs/zh/README.md)
- [安装指南](docs/zh/setup-guide.md) — 安装、网络、Telegram、飞书、QQ、排错
- [Tailscale](docs/tailscale-setup.md) — 不把服务暴露到公网的远程访问（英文）
- [产品需求](docs/zh/prd.md)
- [架构](docs/zh/architecture.md)
- [Telegram PRD](docs/telegram_prd.md) — 消息格式与命令（英文）
- [Telegram 架构](docs/telegram_architecture.md) — 多窗口、队列、生命周期（英文）
- [飞书接入](docs/zh/feishu_setup.md)
- [QQ 接入](docs/zh/qq_setup.md)
- [开发计划](docs/zh/product-plan.md)
- [扩展需求](docs/zh/extension_prd.md)
