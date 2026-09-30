# 安装指南 — CursorRemote

[English](../setup-guide.md)

## 1. 在 Cursor 上打开 CDP

Cursor 必须以 Chrome DevTools Protocol 远程调试端口启动。扩展和独立运行都需要这一步。

### Windows：快捷方式（推荐）

1. 右键桌面上的 Cursor 快捷方式 > 属性
2. 在“目标”末尾加上 ` --remote-debugging-port=9222`
3. 确定

### macOS

```bash
open -a Cursor --args --remote-debugging-port=9222
```

或在 shell 配置里加别名：

```bash
alias cursor='open -a Cursor --args --remote-debugging-port=9222'
```

### Linux

```bash
cursor --remote-debugging-port=9222
```

### 注意

加上参数后要**完全退出再启动** Cursor。macOS 用 Cmd+Q（不要只关窗口），否则 Cursor 会留在后台。

### 验证

浏览器打开 `http://localhost:9222/json`。应看到一个 JSON 数组。不行的话，确认 Cursor 已经完全重启。

---

## 2A. 扩展安装（推荐）

扩展带状态界面、自动启动和配置向导。

### 安装

从 [releases](https://github.com/len5ky/CursorRemote/releases) 下载最新 `.vsix`：

```bash
cursor --install-extension cursor-remote-0.1.52.vsix
```

或在 Cursor 里：命令面板（`Ctrl+Shift+P`）> **Extensions: Install from VSIX...** > 选文件。

### 许可证

在活动栏（左侧）打开 **CursorRemote** 面板。点击 “License Key Required” 输入密钥。密钥存在操作系统凭据库。

到 [商店](https://cursor-remote.com/buy?utm_source=github&utm_medium=setup_guide&utm_campaign=license) 获取密钥。

### 服务生命周期

`cursorRemote.autoStart` 为 `true` 时，Cursor 启动会自动拉起服务。侧边栏显示：

- **Server: Running / Stopped** — 带 Start 和 Stop
- **CDP: Connected** — 以及当前工作区名称
- **代理状态** — 当前模式和模型
- **Clients** — 已连接的浏览器会话数

也可以用命令面板：**CursorRemote: Start Server**、**CursorRemote: Stop Server**。

### 网络和密码

运行 **CursorRemote: Open Setup Panel**：

1. **绑定地址** — Localhost（127.0.0.1）、LAN（0.0.0.0），或 Tailscale 的指定 IP
2. **网页密码** — 首次安装自动生成。在 Setup 面板复制，或在设置里找 `cursorRemote.webappPassword`。可以直接改。
3. 点 **Save & Restart** 使改动生效。

在手机、平板或其他电脑的浏览器打开 `http://<server-ip>:<port>`。

### 网页客户端 — 代码和 diff

助手**代码**和文件编辑 **diff** 不是把 Cursor 的 Monaco HTML 原样拷过来。中继发送结构化的 **`codeBlocks`** / **`diffBlock`**；界面显示一张紧凑卡片（卡片内大约 **七行**，可滚动，iOS 上有惯性滚动）。点**展开**打开**全屏**阅读（较大的关闭控件，点外部或 Escape 关闭）。长补丁在小屏幕上仍可读，又不会占满整段对话。

### 网页客户端 — 计划卡片和连接状态

计划卡片更接近远程操作流程：

- **View Plan** 打开网页弹层。有已保存的计划文件时加载全文，不只是卡片摘要。
- **计划模型** 打开网页选择器，选项来自 Cursor 里抓到的真实模型，选中后再写回 Cursor。
- **Build** 仍直接触发 Cursor 里的对应操作。

连接文案也更具体。手机仍连着中继，但 Cursor / CDP 提取卡住时，界面显示等待 / 提取器状态，而不是笼统的浏览器断开。macOS 上后台窗口会限制 CDP 执行，这时尤其有用。

### Telegram（扩展）

切到 Setup 面板的 **Telegram** 页：

1. **创建机器人** — 粘贴 @BotFather 的 token
2. **创建超级群** — 打开 Topics，把机器人设为管理员
3. **注册** — 面板显示可复制的 `/register <token>`
4. **同步** — 在群里发送 `/sync`

面板也会显示已注册用户和用户名。

### 飞书（扩展）

切到 **Feishu** 页。粘贴自建应用的 App ID 和密钥，然后重启。面板显示 6 位 `/bind` 口令（大约 60 秒、只用一次）和二维码。在私聊里发送该口令。该私聊控制**当前** Cursor 窗口。

在飞书控制台保存**使用长连接接收事件**之前，长连接必须已经在线。完整步骤：[飞书接入](feishu_setup.md)。

### QQ（扩展）

切到 **QQ** 页。粘贴官方机器人的 App ID 和密钥。审核通过前打开 **Sandbox**，用控制台的扫码聊天打开会话，再发送面板上的 `/bind`。完整步骤和 IP 白名单：[QQ 接入](qq_setup.md)。

### 多窗口

所有 Cursor 窗口只跑一个服务：

- 最先启动的窗口成为 **owner**，并拉起服务进程。
- 其他窗口通过健康检查发现已有服务，作为 **observer** 挂上。
- owner 窗口关闭后，某个 observer 会自动接管并拉起新服务。
- 非 owner 窗口的侧边栏会在服务状态旁显示 “observer”。

---

## 2B. 独立安装（不用扩展）

从命令行直接跑中继。适合无界面机器、远程服务器，或用 `.env` 手写配置。

### 安装

```bash
git clone https://github.com/len5ky/CursorRemote.git cursor-ide-remote
cd cursor-ide-remote
npm install
cp .env.example .env
```

编辑 `.env`。默认值就能跑网页。Telegram 设置 `TELEGRAM_ENABLED=true` 和 `TELEGRAM_BOT_TOKEN`（见第 4 节）。飞书用 `FEISHU_*`，QQ 用 `QQ_*`（见 `.env.example` 和第 4B 节）。

### 启动

```bash
npm run dev
```

**许可证（仅首次）：** 会提示输入许可证。到 [商店](https://cursor-remote.com/buy?utm_source=github&utm_medium=setup_guide&utm_campaign=license) 获取。密钥写入 `data/license.key`，之后不再询问。生产模式（`npm start`）启动前必须已有该文件。

```
[main] CDP URL: http://127.0.0.1:9222
[main] Server: http://127.0.0.1:3000
[telegram] Bot connected (sync: off, users: 0)
[telegram] To register, send: /register A1B2C3D4
```

---

## 3. 网络访问

> **扩展用户：** Setup 面板点几下就能配网络。下面的手工步骤主要给独立运行或 WSL2。

### 默认：只监听本机

默认绑定 `127.0.0.1`，只有本机浏览器能访问。

### 局域网

把绑定地址设为 `0.0.0.0`：

- **扩展：** Setup 面板 > Networking > “LAN access (all interfaces)” > Save & Restart
- **独立运行：** `.env` 里 `SERVER_HOST=0.0.0.0`

然后在手机上打开 `http://<你的 IP>:<端口>`。先设置网页密码。如果选了局域网而密码是空的，Setup 面板会警告：同一网络上的任何人都能控制 Cursor。

### WSL2

在 WSL2 里跑时，服务和局域网是隔开的。选一种：

#### 方式 A：镜像网络（推荐）

在 Windows 的 `%UserProfile%\.wslconfig` 里加上：

```ini
[wsl2]
networkingMode=mirrored
```

重启 WSL2：`wsl --shutdown`

#### 方式 B：端口转发

```powershell
# 查 WSL2 IP
wsl hostname -I
# 转发端口（管理员 PowerShell）
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=<WSL2-IP>
```

#### Windows 防火墙

```powershell
New-NetFirewallRule -DisplayName "CursorRemote" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

### 安全的远程访问

**Tailscale（推荐）** — 走私有 VPN，不需要端口转发。见 [Tailscale 说明](../tailscale-setup.md)（英文）。

**密码** — 扩展在 Setup 面板设置，独立运行在 `.env` 里设 `WEBAPP_PASSWORD`。登录按 IP 限速，每分钟 10 次。

两者可以一起用。

---

## 4. Telegram（可选）

> **扩展用户：** Setup 面板的 Telegram 页是分步向导。下面是手工步骤。

### 4.1 创建机器人

1. 在 Telegram 给 `@BotFather` 发 `/newbot`，按提示操作
2. 复制 **bot token**
3. **关闭隐私模式**：`@BotFather` > `/mybots` > Bot Settings > Group Privacy > **Turn OFF**

### 4.2 配置

**扩展：** Setup 面板 > Telegram > 粘贴 token > Save Token。扩展会自动启用 Telegram。

**独立运行：** 编辑 `.env`：

```bash
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4.3 启动服务

启动时会打印注册口令：

- **扩展：** 输出面板（CursorRemote 通道）或 Setup 面板的 Telegram 页
- **独立运行：** 终端

```
[telegram] To register, send in your Telegram group: /register A1B2C3D4
```

### 4.4 建群

1. 创建一个 Telegram 群
2. 把机器人加进群
3. **打开 Topics**：群设置 > Topics > Enable
4. **设为管理员**：群设置 > Administrators > 添加机器人并给予全部权限（尤其是 Manage Topics、Delete Messages）

### 4.5 注册并同步

在群里：

1. `/register A1B2C3D4` — 用服务输出里的口令注册
2. `/sync` — 为这个群打开自动同步

机器人会检查权限，并为当前窗口建话题。之后新的聊天标签会自动建话题。

### 4.6 命令

| 命令 | 说明 |
|---------|-------------|
| `/register <token>` | 用服务输出里的口令注册 |
| `/sync` | 打开自动同步（活动标签 + 最近 5 条消息） |
| `/sync_all` | 为所有窗口的全部标签建话题 |
| `/unsync` | 关闭同步，删除已跟踪话题，清空状态 |
| `/cleanup` | 删除过期、未跟踪的话题，保留活动话题 |
| `/purge` | 删除全部话题（后台执行） |
| `/status` | 同步状态、连接、代理信息、群 ID |
| `/history [N]` | 最近 N 条（默认 5）。`/history 100` 取更多 |
| `/mode` | 查看 / 切换模式（Agent/Plan/Ask/Debug） |
| `/model` | 显示当前模型 |
| `/plan <text>` | 以 Plan 模式发送提示 |
| `/agent <text>` | 以 Agent 模式发送提示 |

话题里的**普通文本**会转发给对应的 Cursor 代理。

### 4.7 原理

- **窗口监控**每 10 秒用**并行 CDP 连接**轮询所有 Cursor 窗口（界面不会跳来跳去）
- 新的或有变化的消息格式化为 Telegram HTML，发到对应话题
- HTML 失败（不支持的标签）时，改用纯文本重试
- **限速发送队列**避免 429（发送间隔约 300ms，编辑间隔 100ms；见 `send-queue.ts` / 传输配置）
- `data/` 里的数据文件（都在 gitignore 中）：
  - `license.key` — 许可证（首次运行需要）
  - `telegram-auth.json` — 注册口令 + 已注册用户和用户名
  - `telegram-sync.json` — 同步状态和群 ID
  - `telegram-topics.json` — 话题映射和高水位
  - `telegram-messages.json` — 已跟踪的消息 ID

### 4.8 鉴权

**方式 A：口令（默认）**
把服务输出里的注册口令给协作者。每人执行一次 `/register <token>`。用户名和 ID 写入 `data/telegram-auth.json`。

**方式 B：写死名单（覆盖）**
独立运行在 `.env` 设 `TELEGRAM_ALLOWED_USERS=123456789,987654321`，扩展在设置里设 `cursorRemote.telegram.allowedUsers`。一旦设置，就**覆盖**口令鉴权——只有这些用户 ID 能用机器人。删掉该设置即回到口令鉴权。

---

## 4B. 飞书和 QQ（可选）

两者默认关闭。中继主动建立 WebSocket，机器不需要公网 webhook。聊天内容仍会经过对应平台。

**扩展：** Setup 面板 → Feishu 或 QQ。应用密钥写入 SecretStorage。保存后重启。该页显示当前 `/bind` 口令。

**独立运行：** 在 `.env` 里填对应块（`FEISHU_ENABLED` / `QQ_ENABLED`、应用 ID、密钥）。尚未审核的 QQ 机器人还要 `QQ_SANDBOX=true`。

| | 飞书 | QQ |
|---|---|---|
| 控制台 | 企业自建应用，长连接 | 官方机器人，WebSocket（不是 webhook） |
| 绑定 | 私聊里 `/bind` | 扫码聊天，然后 `/bind` |
| 能做的 | 发提示；审批和计划用卡片 | 发提示；回复窗口开着时用键盘或 `/do` |
| 还不能做的 | 群聊不能驱动 Cursor | 完整对话镜像（发送 `/status`） |

步骤：[feishu_setup.md](feishu_setup.md)、[qq_setup.md](qq_setup.md)。QQ 配额和 IP 白名单：[qq-backlog.md](qq-backlog.md)。

`data/` 下的文件（gitignore）：`feishu-auth.json`、`feishu-sessions.json`、`qq-auth.json`、`qq-sessions.json`，以及轮换的绑定 JSON 和二维码 SVG。

---

## 5. 生产运行（独立）

### 方式 A：tmux

```bash
tmux new -s cursor-remote
npm run dev
# Ctrl+B D 脱离
```

### 方式 B：编译后运行

```bash
npm run build
npm start
```

运行 `npm start` 之前要已有 `data/license.key`（生产模式没有提示）。

---

## 6. 排错

### 通用

#### “No valid license key” 或服务立刻退出

- **扩展：** 打开 CursorRemote 侧边栏，点击 “License Key Required” 输入密钥
- **独立运行：** 用 `npm run dev`（不要用 `npm start`）才会出现交互提示
- 到 [商店](https://cursor-remote.com/buy?utm_source=github&utm_medium=setup_guide&utm_campaign=license) 获取有效密钥

#### 网页显示 “Disconnected”

- 先从手机或平板访问 `http://<server>:<port>/health`
- `connected: false` 表示中继还没挂上 Cursor / CDP
- `connected: true` 且 `extractorStatus: "waiting"` 表示已挂上 Cursor，但还在等第一份 DOM 快照
- `connected: true` 且 `extractorStatus: "stale"` 表示 CDP 仍连着，但 DOM 提取失败或被后台节流
- `lastExtractionError` 是最近一次提取失败的原因

#### macOS：Cursor 在后台，手机不再更新

- macOS 上 Electron / Chromium 会节流后台窗口，`Runtime.evaluate` 可能超时
- 若 `/health` 为 `connected: true` 且 `extractorStatus: "stale"`，把 Cursor 切回前台，等下一次成功快照
- 中继对连续的提取超时会退避，不会一直猛打 CDP

#### 手机 / 平板连不上

- 从另一台设备 `curl http://<ip>:<port>/health`
- 检查防火墙、端口转发、WSL2 网络
- 确认服务绑定的是 `0.0.0.0` 或你的具体 IP，不是 `127.0.0.1`

#### 较旧的手机浏览器白屏或界面坏了

- 较新构建不再要求浏览器支持 `crypto.randomUUID()`
- 页面仍打不开时，看浏览器控制台里其他不支持的 Web API
- 先升级到最新 CursorRemote 再测旧的 iOS / Android 浏览器

### 扩展

#### 侧边栏显示 “Disconnected”

- 打开输出面板（**CursorRemote: Show Logs**）看错误
- 用侧边栏 Stop > Start
- 确认 CDP 已开：`http://localhost:9222/json` 应返回 JSON

#### 多个 Cursor 窗口

- 只跑一个服务。第一个窗口是 owner，其余是 observer。
- 非 owner 窗口的侧边栏会显示 “observer”。
- owner 关闭后，observer 大约 15 秒内自动恢复。

#### Telegram 机器人没反应

- 看输出面板里的连通性信息
- 启动时会测出站 HTTPS，并报告 Telegram API 或全部 HTTPS 是否不可达
- 确认没有另一个进程在用同一个 token
- 注册口令在输出面板和 Setup 面板的 Telegram 页

#### 飞书控制台保存不了长连接订阅

- 先用应用凭证把中继启动起来。飞书只在该连接已经在线时接受订阅。
- Setup 面板的飞书页会显示长连接是否就绪。确认那一行之后，再保存**使用长连接接收事件**。

#### QQ 网关以 4914 关闭

- 机器人仍只能走沙箱。在 Setup 面板打开 **Sandbox**（或 `QQ_SANDBOX=true`）后重启。QQ 页会直接显示这个错误。
- 控制台有 IP 白名单时，把这台机器当前的公网出口 IP 加进去。同一页也会显示白名单被拒。

### 独立运行

#### 机器人没反应

- `.env` 里 `TELEGRAM_ENABLED=true`？
- 机器人是管理员，且有 Manage Topics？
- 隐私模式已关？（`@BotFather` > Bot Settings > Group Privacy）
- `/register` 用的口令对吗？
- 看 `temp/server.log`

#### /sync 说 “not a supergroup” 或 “not a forum”

- 先在群设置里打开 Topics（会自动转成超级群）
- 机器人会从 `/sync` 识别正确的群 ID

#### /sync 说 “missing permissions”

- 群设置 > Administrators > 机器人 > 打开列出的权限
- 需要：Manage Topics、Delete Messages

#### macOS 上 build 失败

- `npm run build` 编译 TypeScript，并把 `src/client/` 复制到 `dist/client/`
- `npm start` 会自动创建 `temp/`

#### 服务日志

带时间戳的全部输出：`temp/server.log`
