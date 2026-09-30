# 架构 — CursorRemote

[English](../architecture.md)

## 1. 总览

系统分三层，中间用两段协议连接：

```
Cursor IDE  ←──CDP──→  中继服务  ←──socket.io──→  手机客户端
(Windows)               (WSL2/Node)                 (浏览器)
```

- **Cursor IDE** 是原装 Electron 应用，以 `--remote-debugging-port=9222` 启动。它通过 WebSocket 暴露 Chrome DevTools Protocol。我们不修改 Cursor。
- **中继服务** 是跑在 WSL2 里的 Node.js / TypeScript 进程。一侧接 CDP，一侧接 socket.io。
- **手机客户端** 是中继提供的静态 HTML/CSS/JS。只通过 socket.io 事件通信。

---

## 2. 组件

```
┌──────────────────────────────────────────────────────────┐
│                     中继服务                             │
│                                                          │
│  ┌─────────────┐    ┌───────────────┐    ┌───────────┐  │
│  │  CDP Bridge  │───→│ DOM Extractor │───→│   State   │  │
│  │              │    │               │    │  Manager  │  │
│  │  CdpClient   │    │ callFunction  │    │           │  │
│  │  WebSocket   │    │ data-attr     │    │  diff     │  │
│  │  lifecycle   │    │ extraction    │    │  events   │  │
│  └──────┬───────┘    └───────────────┘    └─────┬─────┘  │
│         │                                       │        │
│         │            ┌───────────────┐          │        │
│         │            │   Command     │          │        │
│         └───────────→│   Executor    │          │        │
│                      │               │          │        │
│                      │  CDP Input    │          │        │
│                      │  evaluate     │          │        │
│                      │  approve/deny │          │        │
│                      └───────┬───────┘          │        │
│                              │                  │        │
│                      ┌───────▼──────────────────▼─────┐  │
│                      │         Relay                  │  │
│                      │  Express（静态文件）           │  │
│                      │  socket.io（状态 + 命令）      │  │
│                      └────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 2.1 CDP 客户端（`cdp-client.ts`）

**职责**：用原始 WebSocket 实现的轻量 Chrome DevTools Protocol 客户端。

**为什么不用 Puppeteer**：Electron / Cursor 会挡住 `Target.getBrowserContexts`，而 `puppeteer-core` 连接时需要它。我们的客户端直接连页面 target 的 WebSocket URL。

**API**：

- `connect(wsUrl)` — 连到页面 target 的 WebSocket
- `evaluate(expression)` — `Runtime.evaluate`，按值返回
- `callFunction(fn, ...args)` — 把函数和参数序列化后在页面上下文执行。注入 `__name` 垫片，因为 tsx / esbuild 会用 `__name()` 包一层具名函数
- `typeText(text)` — `Input.insertText`（Chromium 原生输入管线）
- `pressKey(key, code, keyCode, modifiers)` — `Input.dispatchKeyEvent`（keyDown + keyUp）
- `click(selector)` — evaluate：滚入视口再点击
- `exists(selector)` — 检查元素是否存在

### 2.2 CDP Bridge（`cdp-bridge.ts`）

**职责**：发现 Cursor 窗口，建立并维持 CDP 连接，支持切换窗口。

**多窗口**：所有 Cursor 窗口共用一个 CDP 端口（9222）。每个窗口在 `/json` 里是一个单独的 `page` target。Bridge 发现全部 workbench 页面，暴露为 `CursorWindow[]`。同一时间只连一个窗口；用户在手机界面上切换。

**工作区名称**：连上 target 后，用 `Runtime.evaluate` 读 `vscode.context.configuration().workspace.uri`。这是每个 Cursor / VS Code Electron 渲染进程里都有的稳定内部 API。`uri.path` 的最后一段是项目文件夹名，`uri.authority` 是远程限定符（WSL、SSH 等）。它不依赖会变的 `document.title`。限定符后缀（例如 `[WSL: ubuntu-24.04]`）可以用 `.env` 里的 `WINDOW_TITLE_QUALIFIER=false` 关掉，让 Telegram 话题名更干净。尚未轮询、只从 `/json` 发现的窗口，退回解析 CDP target 标题：去掉 ` - Cursor`，按 ` - ` 切开，取项目那段。

**生命周期**：

1. 从 `http://<CDP_URL>/json` 取 target 列表
2. 筛出 URL 含 `workbench` 的页面，作为 `windows`
3. 把 `CdpClient` 连到选中（或第一个）target 的 `webSocketDebuggerUrl`
4. 把 `CdpClient` 和 `activeTargetId` 交给其他模块
5. 断开时发事件，并用指数退避重连

**切换窗口**（`switchWindow(targetId)`）：

1. 断开当前 CdpClient
2. 发出 `disconnected`（提取器停止，执行器清掉客户端）
3. 对新窗口 `connect(targetId)`
4. 发出 `connected`（提取器重启，执行器拿到新客户端）

**定期刷新**：每 10 秒 `refreshWindows()` 重新拉 `/json`，发现新开或已关的窗口，不必重连。

### 2.3 DOM 提取器（`dom-extractor.ts`）

**职责**：定期从 Cursor 的 DOM 抽出结构化状态。

**做法**：

1. 提取函数经 `client.callFunction()` 序列化传进去
2. 在 Cursor 渲染进程里选出所有 `[data-flat-index]`
3. 对每个元素读 `data-message-role` 和 `data-message-kind` 做分类
4. 按类型抽出内容，变成带类型的 `ChatElement`
5. **助手消息**：`html` 只取 **`.markdown-root` 的 innerHTML**（正文）。**`codeBlocks`** 是从 composer 代码控件建出的 **`CodeBlockItem`** 数组（Shiki 行、Monaco `.view-line` 文本、按行的纯代码回退、diff 装饰 → `diffLines` 的 `add` / `rem` / `ctx` 等）
6. **ToolCallElement**：编辑审阅 / 紧凑 / 行工具上有 composer 代码块时，**`diffBlock`** 用同一种 **`CodeBlockItem`**，给网页（和 Telegram）原生渲染，不是把控件 HTML 镜像过去
7. 同时提取审批按钮、基础状态、聊天标签、模式、模型、composer 队列，以及原始活动信号（`_rawSignals`）
8. 共享的 `activity-derive.ts` 把 `_rawSignals` 和已解析消息变成 `agentStatus`、`agentActivityText`、`agentActivityLive`、`agentActivitySource`，网页和 Telegram 用同一套实时活动约定
9. 成功返回完整 `CursorState`，失败返回 `null`

**元素分类**：

| data-message-role | data-message-kind | 结果类型 |
| ----------------- | ----------------- | ---------------- |
| human             | human             | HumanMessage 或 PlanBlock（旧格式） |
| ai                | assistant         | AssistantMessage |
| ai                | tool              | PlanBlock（控件）、RunCommand 或 ToolCallElement |
| （无）            | （无）            | ThoughtBlock、LoadingIndicator，或跳过 |

在 `ai` / `tool` 分支里的优先级：

1. `.composer-create-plan-container` → **PlanBlock**（带待办和操作的控件）
2. `.composer-terminal-tool-call-block-container` → **RunCommand**（命令文本、Run/Skip/Allow）
3. `.composer-edit-file-review-wrapper` → **ToolCallElement**（编辑 / 审阅卡；有代码块时可选 **`diffBlock`**）
4. `.composer-tool-former-message` → **ToolCallElement**（紧凑摘要；可以带 **`diffBlock`**）
5. `.ui-tool-call-line-action` → **ToolCallElement**（展开的工具行；可以带 **`diffBlock`**）

提取内部使用的选择器与英文架构文档 §2.3 的表一致（`[data-flat-index]`、`.markdown-root`、`.composer-create-plan-*`、`.composer-run-button` 等）。类名和属性名以英文文档和 `selectors.json` 为准。

### 2.4 命令执行器（`command-executor.ts`）

**职责**：把远程命令翻译成对 Cursor DOM 的 CDP 操作。

| 命令 | 实现 |
| ------- | -------------- |
| `send_message(text)` | 1. 选择器级联 + `evaluate()` 找输入框。2. 聚焦并点击。3. Ctrl+A + Backspace 清空。4. `Input.insertText` 写入。5. `Input.dispatchKeyEvent` 发送 Enter。 |
| `approve(selectorPath)` | evaluate：滚入视口再点击。 |
| `reject(selectorPath)` | 与 approve 相同，点拒绝按钮。 |
| `approve_all()` | 按文本匹配找到 “Accept All” 再点击。 |
| `switch_tab(tabTitle)` | 按标题找 `.agent-sidebar-cell`，JS `.click()`。 |
| `new_chat()` | 选择器级联点击新建聊天。 |
| `set_mode(modeId)` | 对模式下拉触发器 JS `.click()`，再对目标项 `.click()`。 |
| `set_model(modelId)` | 对模型下拉触发器 JS `.click()`，再对 `.composer-unified-context-menu-item` `.click()`。确认菜单关闭。 |
| `click_action(selectorPath)` | 通用按钮点击。滚入视口后 JS `.click()`。用于带着 `selectorPath` 抽出的 Run、Skip、Allow、Build、View Plan。 |

**打字为什么走 CDP Input**：Cursor 的聊天输入框是 ProseMirror / TipTap。DOM 级方法（`document.execCommand`、`element.value=`）绕过 ProseMirror 的内部状态。CDP 的 `Input.insertText` 和 `Input.dispatchKeyEvent` 走 Chromium 原生输入管线，ProseMirror 能通过 `beforeinput` / `input` 正确处理。

**重试**：最多 2 次，间隔 500ms。返回 `{ ok: boolean, error?: string }`。

### 2.5 状态管理器（`state-manager.ts`）

**职责**：对连续状态做 diff，发出细粒度变更事件。

**算法**：

1. 接收提取器给出的新 `CursorState`
2. 用 JSON.stringify 比较每个顶层字段和上一份状态
3. 只把变了的字段放进 patch
4. 对 patch 防抖（默认 300ms），避免流式输出时广播风暴
5. 发出 `state:patch`

**由 Bridge 维护的字段**：`windows` 和 `activeWindowId` 不来自 DOM 提取（提取只能看到一个窗口）。它们由 `index.ts` 在 CDP bridge 连接或刷新后调用 `updateWindows()` 写入。应用提取结果时，diff 会保留这些字段。

**事件**：

- `state:patch` — 部分状态变化
- `connection:changed` — CDP 连接状态翻转

### 2.6 传输层

状态管理器发事件；任意多个传输层可以各自订阅。每个传输层自己管连接、客户端格式和命令路由。

#### 网页（`relay.ts`）

**职责**：提供网页客户端，并把 socket.io 和后端接上。

**HTTP**：

- `GET /` → 以静态文件提供 `src/client/`
- `GET /health` → `{ ok, connected, agentStatus, clients, uptime, windows, activeWindowId, mode, model, chatTabCount, pendingApprovalCount, generation, transports }`。`transports.feishu` 和 `transports.qq` 是 `{ state, detail }`（`disabled`、`starting`、`ready`、`error`）。Setup 面板读这一段，避免把已保存的密钥显示成已经连上。
- `POST /local/unbind`，请求体 `{ transport, openId }`，从正在运行的进程里移除一个飞书或 QQ 用户。本机回环可以调用，源地址等于该套接字绑定地址的本机连接也可以（Tailscale 或自定义 IP）。局域网客户端不行。这条路由登记在网页密码校验之前，扩展才能调用。中继拒绝时，Setup 面板不会改写授权文件。

**socket.io**：

- 新连接时发送 `state:full`
- 把 `command:*` 交给命令执行器
- 把 `command:switch_window` 直接交给 CDP Bridge
- 把状态管理器的事件转给所有已连接 socket

**网页客户端**（`src/client/app.js`、`src/client/styles.css`）：

- 把 `ChatElement` 渲染进 `#messages`。助手 HTML 经 `sanitizeHtml`（去掉脚本、事件处理和内嵌的 composer / Shiki 根节点）。
- **原生代码 / diff**：`createNativeBlockFromItem()` 建出 `.code-block.native-code-block`，工具栏（标题 + 全屏），**`.code-block-viewport`** 大约 7 行（`--cb-font`、`--cb-lh`、`--cb-lines`）并可滚动，结构化 diff 用绿 / 红行样式。助手 **`codeBlocks`** 接在正文后面；工具 **`diffBlock`** 挂在 **`.tool-diff-host`**（`syncToolDiffHost` / `updateToolEl`）。纯补丁文本也会在服务端分成 `diffLines`，没有 Monaco 时仍能显示增删颜色。
- **全屏阅读**：展开打开 **`.code-block-fs-overlay`**（模态、安全区、点背景或 Escape 关闭、控件至少 44px）。打开时锁定页面滚动。

#### Telegram（`transports/telegram/`）

**职责**：把 Cursor 状态接到带论坛话题的 Telegram 超级群。

**两种实现**（环境变量 `TELEGRAM_IMPL`）：

- `grammy`（默认）— Grammy 框架做轮询和 API。Grammy 的 `fetch` 包了 30 秒 HTTP 超时，避免一直挂住。
- `raw` — 用 Node 原生 `fetch` 直接打 Telegram Bot API。没有外部机器人框架。所有 API 调用 30 秒超时，长轮询单独循环并退避。Grammy 启动挂死时用这个（在部分 macOS 上见过）。

**两边共用**：

- `base.ts` — `BaseTelegramTransport`：鉴权持久化、同步状态、活动指示、自动建话题、消息处理、正在输入、事件处理。Grammy 和 raw 都继承它。
- `tg-types.ts` — 不依赖 Grammy 的类型：`TelegramApiClient`、`BotContext`、`TgKeyboard`
- `formatter.ts` — 每种 `ChatElement` 转成 Telegram HTML。用 `node-html-parser` 走 DOM（Shiki 代码块、标题、按 class 的粗体、表格）。处理 4096 字符拆分，以及操作的内联键盘。不依赖 Grammy。
- `topic-manager.ts` — `windowTitle::tabTitle` 映射到论坛话题 `threadId`。经 `TelegramApiClient.createForumTopic` 建话题。
- `message-tracker.ts` — 每个话题里 `ChatElement.id` → Telegram `message_id`。决定新发还是编辑。
- `commands.ts` — `/sync`、`/mode`、`/model`、`/status`、`/plan`、`/agent`。用 `BotContext`，不依赖 Grammy。

**入站**（Telegram → Cursor）：

1. 用户在话题里发文本 → 话题解析成窗口 + 标签 → 需要时切换 → `commandExecutor.sendMessage(text)`
2. 用户点内联键盘 → 解码 callback → 调用执行器（`clickApproval`、`clickAction`、`setMode`、`setModel`）
3. `/mode` → 机器人回复当前模式和键盘 → 用户点选 → `commandExecutor.setMode(modeId)`

**出站**（Cursor → Telegram）：

1. 状态管理器发出带变更 `messages` 的 `state:patch`
2. `WindowMonitor` 对每个已映射话题调用 `doProcessWindow`：活动行、composer 队列，然后是聊天元素
3. 传输层按话题 diff 新消息和已跟踪消息
4. 新元素 → `sendMessage`（HTML + 可选键盘）
5. 变化的元素（例如流式助手文本）→ 对已跟踪消息 `editMessageText`
6. `agentActivityLive` 为真且状态是活动模式时，每 4 秒 `sendChatAction('typing')`

**访问控制**：中间件用 `update.from.id` 对照 `TELEGRAM_ALLOWED_USERS`。机器人必须是群管理员，且隐私模式关闭。

配置见 `docs/prd.md` §8 的 `TELEGRAM_*`。完整说明：`docs/telegram_prd.md`。细节：`docs/telegram_architecture.md`。

#### 飞书（`transports/feishu/`）

**职责**：从飞书私聊控制当前 Cursor 窗口。中继用 `@larksuiteoapi/node-sdk` 的 `createLarkChannel`，`transport: 'websocket'`。飞书经这条出站连接推事件，所以没有公网 webhook。

**绑定**：6 位口令 60 秒过期，只用一次。Setup 面板显示口令和两张二维码（打开机器人的 applink，以及 `/bind` 命令）。允许的 `open_id` 存在 `feishu-auth.json`。

**路由**：当前阶段私聊跟随 `CDPBridge.activeTargetId`。在群里 `/bind` 不会注册用户。

**出站**：当前窗口的 `window:update` 经防抖后，编辑一条状态消息、一张审批卡、一张问卷卡，以及对话尾部。卡片点击立刻返回；`CommandExecutor` 在之后执行，使回调落在飞书的 3 秒窗口内。

**入站命令**：`/bind`、`/status`、`/mode`、`/help`，以及普通文本（`sendMessage`）。

安装：`docs/zh/feishu_setup.md`。

#### QQ（`transports/qq/`）

**职责**：经官方 QQ 机器人 WebSocket 网关做同样的私聊控制（`QQBot` access token，intents `1<<25` 和 `1<<26`）。不用非官方协议，也没有公网 webhook。

**绑定**：同样的 60 秒 `/bind` 口令，写成 `qq-bind.json` 加一张命令二维码。用户用控制台的扫码聊天打开机器人。

**出站**：QQ 的被动回复必须带上用户最近一条消息的 `msg_id`，主动推送有配额。这条传输层不镜像完整对话。只在该 `msg_id` 仍在大约 4 分钟窗口内时发送审批键盘。`/status` 和 `/mode` 是被动回复。markdown 键盘被拒绝时，同样的操作印成 `/do <id>`。

**沙箱**：`QQ_SANDBOX=true` 使用 `https://sandbox.api.sgroup.qq.com`。网关关闭码 `4914` 表示机器人仍只能走沙箱。生产环境还可能要求把机器的公网 IP 加进机器人白名单。

安装：`docs/zh/qq_setup.md`。平台限制：`docs/zh/qq-backlog.md`。

---

## 3. 网络模型

### 3.1 CDP（中继 → Cursor）

```
WSL2 进程 → localhost:9222 → Windows 上的 Cursor
```

WSL2 默认把 localhost 转到 Windows 主机。

### 3.2 客户端（手机 → 中继）

```
手机 → <windows-lan-ip>:3000 → （端口转发）→ WSL2 中继
```

需要其一：

- **WSL2 镜像网络**：`.wslconfig` 里 `networkingMode=mirrored`
- **端口转发**：`netsh interface portproxy` 转发 3000

两者都要给 TCP 3000 加 Windows 防火墙入站规则。

---

## 4. 错误恢复

### 4.1 CDP 断开

1. CdpClient 发现 WebSocket 关闭
2. CDP Bridge 发出 `disconnected` → 状态管理器 → 客户端看到 “Disconnected”
3. 指数退避重连（1s、2s、4s……最多 30s）
4. 重连后重新发现 target、重连、恢复轮询

### 4.2 DOM 提取失败

1. 提取捕获全部错误，返回 `null`
2. 状态管理器把 `null` 当成“无变化”（保留上一份已知状态）
3. 连续 10 次 `null` 后打警告，建议 `npm run discover`

### 4.3 客户端断开

1. socket.io 指数退避自动重连
2. 重连后服务发送 `state:full` 补齐

### 4.4 命令执行失败

1. 命令执行器最多重试 2 次，间隔 500ms
2. 向该客户端返回 `{ ok: false, error }`
3. 客户端显示错误提示

---

## 5. 文件结构

与英文架构文档 §5 的树一致。和飞书 / QQ 相关的新增路径：

```
docs/feishu_setup.md
docs/qq_setup.md
docs/qq-backlog.md
docs/zh/                      # 上述文档及产品说明的中文版
src/server/transports/feishu/ # 长连接、卡片、/bind、私聊 → 当前窗口
src/server/transports/qq/     # 官方网关、被动回复、/do
```

其余服务、客户端、扩展文件见英文 [architecture.md](../architecture.md) 第 5 节。选择器和类名以那份树和源码为准。

---

## 6. 实现中确认过的事实

给扩展系统或 Cursor 升级后排查用。选择器保持英文。

### 6.1 聊天标签用 `.agent-sidebar-cell`

聊天标签从侧边栏的 `.agent-sidebar-cell` 提取。`aria-label` 或 `title` 是聊天名。`data-selected` 或 `data-highlighted` 表示当前标签。切换按标题匹配后 JS `.click()`，不用脆弱的 CSS 路径或基于坐标的鼠标事件。

VS Code 的标签栏（`ul[role="tablist"] li.composite-bar-action-tab`）是编辑器 / 终端 / 输出，不能当成聊天标签。

### 6.2 ID 里的点必须转义

工作台元素 ID 带点（例如 `workbench.parts.auxiliarybar`）。`buildSelectorPath` 必须写成 `#workbench\\.parts\\.auxiliarybar`。不转义时 `querySelector` 会把点当成类选择器，然后静默失败。

### 6.3 下拉菜单：JS `.click()` 有效，CDP 鼠标事件无效

模式和模型下拉都用 `Runtime.evaluate` 里的普通 `.click()`。基于坐标的 `Input.dispatchMouseEvent` 对 React 事件不可靠：看起来点到了，菜单却不开，或选项不生效。

`setMode` 和 `setModel` 的做法：

1. `document.querySelector(trigger).click()` 打开菜单
2. 等 250–300ms 让菜单渲染
3. `document.querySelector(item).click()` 选中
4. 确认菜单已关闭

### 6.4 模型选择器：悬停和当前项不是一回事

`data-is-selected="true"` 表示**悬停 / 焦点**项，不是当前模型。真正的当前模型是右侧的勾（`codicon-check`）。触发按钮 `.composer-unified-dropdown-model` 的文本是当前模型名。

### 6.5 模式

当前模式（Agent、Plan、Debug、Ask）在 `.composer-unified-dropdown` 的 `data-mode` 上。菜单项 ID 形如 `composer-mode-*-{modeId}`。

### 6.6 计划控件 `.composer-create-plan-container`

带待办、Build、View Plan 的计划控件嵌在 `data-message-kind="tool"` 里，位于 `.composer-tool-former-message` 之下。必须在通用紧凑工具摘要之前识别。关键选择器：`.composer-create-plan-title`、`.composer-create-plan-label`、`.composer-create-plan-todo-item`、`.composer-create-plan-build-button`、`.composer-create-plan-view-plan-button`。

旧计划格式（`.plan-execution-message-content`）结构不同，出现在 `role=human` 里。两种都映射成 `PlanBlock`。

远程查看时，网页不只依赖抽出的紧凑载荷：

- View Plan 打开本地网页弹层。
- 中继可以读 `~/.cursor/plans/<label>`，在文件存在时返回完整计划和待办，与 Telegram 的全文计划一致。
- 计划模型胶囊经中继要 Cursor 当前的下拉选项，再把选中项写回 Cursor。

### 6.7 运行命令控件

终端审批卡包含完整 shell 命令、描述和 Run/Skip/Allow。容器是 `.composer-terminal-tool-call-block-container`（或 `.composer-tool-call-container.composer-terminal-compact-mode`）。命令文本在 `.composer-terminal-command-expanded-text`。按钮是 `.composer-run-button` 和 `.composer-skip-button`。“Allow” 用于沙箱权限。

`selectors.json` 的 `rejectButton.textMatch` 里原先没有 “Skip”，必须补上。

### 6.8 通用工具按钮

各类工具（Fetch、编辑审阅、终端命令，以及以后的 Cursor 工具）共用按钮约定：Skip 用 `.composer-skip-button`，Run / Allow / Accept 用 `.composer-run-button` / `.anysphere-secondary-button`。`dom-extractor.ts` 的 `extractToolActions(container)` 扫描这些按钮，分成 `skip`、`run`、`allow`。新工具类型会自动在 Telegram 和网页上露出审批操作。

紧凑路径（`.composer-tool-former-message`）从 `.composer-tool-call-header-content` 取动作 / 详情，避免把按钮文案当成内容。

### 6.9 浏览器通知

网页在标签不在前台、且出现可操作事件时，用原生 `Notification`。覆盖：全局审批、运行命令提示、工具级审批（例如 Fetch 允许列表、编辑接受）。每条通知用消息 ID 做唯一 tag。页面先说明权限用途，用户点「允许」后浏览器才询问。加到主屏幕在这之后。提醒仍然要求页面开着。局域网普通 HTTP 不是安全上下文，浏览器不会弹出这两项。

---

## 7. VS Code 扩展外壳

也可以作为 VS Code / Cursor 扩展安装。扩展是薄封装：把现有服务拉成子进程，并提供编辑器集成。

完整说明：`docs/zh/extension_prd.md`。

### 7.1 架构

扩展跑在 Extension Host。与服务的通信：

1. **环境变量** — 启动时传入配置和许可证
2. **HTTP 轮询** — 每 5 秒 `GET /health`
3. **解析 stdout/stderr** — 日志接到 `LogOutputChannel`

扩展不导入服务模块。许可证校验故意写两份，因为扩展包不能和服务共享代码。

**单例**：所有窗口只跑一个服务进程。启动时 `ServerManager` 探测 `GET /health`。已有服务则作为 **observer**。没有则拉起并成为 **owner**。owner 关闭后：

1. observer 连续 3 次健康检查失败
2. 随机抖动 0–3 秒后，一个 observer 调用 `attemptTakeover()`
3. 它拉起新进程并成为新 owner
4. 其他 observer 发现服务健康后继续做 observer

同时拉起时从 stderr 捕获 `EADDRINUSE`，退回 observer。

### 7.2 组件

| 文件 | 职责 |
| --- | --- |
| `extension/src/extension.ts` | 激活 / 停用、注册命令、自动启动、生成密码 |
| `extension/src/server-manager.ts` | 单例：拉起 / 杀掉、owner / observer、健康检查、自动恢复 |
| `extension/src/license-manager.ts` | 校验密钥、VS Code Secrets、购买链接 |
| `extension/src/config-bridge.ts` | VS Code 设置 → 子进程环境变量 |
| `extension/src/status-bar.ts` | 带连接颜色的状态栏 |
| `extension/src/output-channel.ts` | `LogOutputChannel`，支持 info / warn / error |
| `extension/src/tree-view.ts` | 侧边栏：服务状态、Start/Stop、CDP、代理、客户端 |
| `extension/src/setup-panel.ts` | 网络、密码、Telegram、飞书、QQ 向导 |

### 7.3 构建

- **扩展包：** esbuild 把 `extension/src/extension.ts` 打成 `dist/extension.cjs`（CJS，external：`vscode`）
- **服务包：** esbuild 把 `src/server/index.ts` 和 Node 依赖打成 `dist/server/bundle.mjs`（ESM）。banner 注入 `__dirname`、`__filename`、`createRequire`，因为 Express 等依赖这些全局量。
- **客户端：** `tsc` 编译后，把 `src/client/` 和 `node_modules` 里的 `socket.io.min.js` 复制到 `dist/client/`。
- 打包前由 `vscode:prepublish` 跑完，再用 `vsce` 打包。

### 7.4 实现备注

**grammY 原生 fetch：** grammY 默认基于 `node:https` 的 HTTP 客户端，在 esbuild 打出的 ESM 里会坏。构造时用 `{ client: { fetch } }` 改用 Node 原生 `fetch`。

**Webview 生命周期：** Setup 面板 `retainContextWhenHidden: true`。同一 ViewColumn 里再打开 VS Code 设置，可能把 Cursor 渲染进程卡死。“Open All Settings” 先销毁面板，再用 `setTimeout` 下一拍打开设置。

---

## 8. 扩展专用环境变量

扩展把服务拉成子进程时设置这些变量。不设置时行为与独立运行相同。

| 环境变量 | 独立运行默认 | 扩展设置 | 用途 |
| --- | --- | --- | --- |
| `LICENSE_KEY` | 未设置 → 读 `data/license.key` | VS Code secrets 里的密钥 | 不经过文件传递许可证 |
| `DATA_DIR` | 未设置 → `./data` | `context.globalStorageUri` | 持久化目录与扩展安装目录分开 |
| `LOG_FORMAT` | 未设置 → 带时间戳的纯文本 | `json` | 给输出通道解析的 JSON 行 |

---

## 9. 依赖

| 包 | 版本 | 用途 |
| ------------------ | ------- | ---------------------------------------------------- |
| `express`          | ^4.21   | 静态文件和健康检查的 HTTP 服务 |
| `socket.io`        | ^4.8    | 双向实时通信 |
| `ws`               | ^8.18   | CDP 客户端的原始 WebSocket；QQ 网关也用它 |
| `grammy`           | latest  | Telegram Bot API（TypeScript） |
| `@larksuiteoapi/node-sdk` | ^1.74 | 飞书长连接客户端 |
| `qrcode`           | ^1.5    | Setup 面板绑定口令的二维码 SVG |
| `node-html-parser` | latest  | Telegram 格式化用的 DOM HTML 解析 |
| `tsx`              | ^4.19   | 开发：带监视的 TypeScript 执行 |
| `typescript`       | ^5.7    | 类型检查和编译 |
| `@types/vscode`    | ^1.85   | 开发：VS Code 扩展 API 类型 |
| `esbuild`          | ^0.24   | 开发：扩展打包 |
| `@vscode/vsce`     | ^3.0    | 开发：扩展打包与发布 |

没有 Puppeteer。客户端没有前端框架，也没有构建步骤。
