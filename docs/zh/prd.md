# CursorRemote — 产品需求

[English](../prd.md)

字段名、事件名、CSS 选择器和环境变量与英文原文一致。下面是对照翻译。

## 1. 概述

CursorRemote 是一套中继：从手机浏览器、Telegram 群、飞书私聊或 QQ 私聊，查看并控制本机 Cursor IDE 的 AI 代理。它通过 Chrome DevTools Protocol（CDP）连上正在运行的 Cursor，把代理聊天抽成结构化数据，再经与传输层无关的事件系统推给客户端。你可以在手机或这些聊天里读对话、批准或拒绝工具调用、运行或跳过 shell 命令、操作计划控件、发送新提示、切换聊天标签、改模式和模型，而不必回到主机前。

### 1.1 问题

长时间跑 Cursor 代理时，人被拴在主机上。离开就会错过挡住代理的审批，时间和节奏都断掉。Cursor 本身没有远程操作代理的办法。

### 1.2 目标

做出一套能用的系统：

- 通过 CDP 连接本机正在运行的 Cursor IDE
- 把代理聊天面板抽成带类型的结构化数据，包括带待办的计划控件和终端命令审批控件
- 经与传输层无关的事件系统，把状态推给网页、Telegram、飞书和 QQ
- 让远程用户批准 / 拒绝工具调用、运行 / 跳过 shell 命令、触发计划构建
- 支持切换聊天标签、模式和模型
- Telegram：论坛话题（每个项目 + 聊天标签一个）用于查看和控制
- 飞书和 QQ 官方机器人：本机向外的长连接，在本机 `/bind`，私聊控制当前 Cursor 窗口
- 跑在本机（没有 CursorRemote 云）。网页留在你的网络里。Telegram、飞书、QQ 的流量仍经过那些平台。

### 1.3 不做

- 网页客户端的多用户鉴权
- 持久聊天历史或数据库
- PWA / 离线
- Telegram、飞书、QQ 以外的聊天平台（例如 Discord）。Transport 接口还可以再接，但没有实现。

---

## 2. 用户故事

### US-1：远程审批
离开座位时，能在手机上看到代理需要审批，并点批准 / 拒绝，这样人离开时代理不会一直被挡住。

### US-2：远程发提示
在手机上输入并发送新提示，从而远程改方向或让代理继续。

### US-3：看对话
在手机上读完整对话，格式正确（markdown、代码块、工具调用、计划），从而知道代理做了什么、正在做什么。

### US-4：代理状态
一眼看出代理是空闲、思考、在跑工具，还是在等审批。

### US-5：后台通知
网页在后台标签时，任何需要处理的动作都有浏览器通知：全局审批、运行命令的 Skip/Run、工具级审批（例如 Fetch 允许列表、编辑 Accept/Skip），以及其他可操作的工具控件。

### US-6：断线恢复
网络掉了能自动重连，不用手动刷新或重启。

### US-7：聊天标签
在手机上看到全部打开的聊天标签并切换，从而远程管多段对话。

### US-8：模式和模型
在手机上改代理模式（Agent/Ask/Manual）和模型。

### US-9：多窗口
看到全部 Cursor 窗口并从手机切换，从而跨项目查看和控制。

### US-10：计划控件
看到完整计划卡（标题、描述、逐项状态的待办），并在手机或 Telegram 上点 Build 或 View Plan。

### US-11：Shell 命令审批
看到代理要跑的完整 shell 命令（描述和命令文本），并在手机或 Telegram 上点 Run、Skip 或 Allow。

### US-12：Telegram 查看
对话流进 Telegram 论坛话题（每个项目 + 聊天标签一个），格式正确并实时更新。

### US-13：Telegram 控制
在 Telegram 里发消息、用内联按钮批准 / 拒绝、切换模式 / 模型、触发计划构建。

### US-14：问卷
离开座位时，在手机或 Telegram 上看到并回答代理的选择题。

### US-15：Telegram 自动同步
执行一次 `/sync` 后，新聊天标签自动建论坛话题。

飞书和 QQ 的范围更窄：私聊控制当前窗口。飞书用卡片做审批和计划。QQ 不镜像完整对话，审批挂在最近一条消息的被动回复窗口里。安装见 `docs/zh/feishu_setup.md` 和 `docs/zh/qq_setup.md`。

---

## 3. 系统架构

```
Cursor IDE（CDP 9222）→ 中继
  CDP Bridge → DOM 提取器 → 状态管理器
       ├─ 网页（socket.io / Express）→ 手机浏览器
       ├─ Telegram（grammy）→ 论坛话题
       ├─ 飞书长连接 → 私聊
       └─ QQ 官方网关 → 私聊
```

英文原文 §3 的框图还画了网页和 Telegram 两侧的界面元素。飞书和 QQ 是后来加上的出站长连接，不经过公网 webhook。

### 3.0 传输层

状态管理器发出 `state:patch` 和 `connection:changed`。任意多个传输层可以各自订阅。每个传输层：

1. **订阅**状态管理器事件，用于出站
2. **调用**命令执行器（切换窗口则调用 CDP Bridge），用于入站
3. **自己管理**连接生命周期和客户端状态

当前有四个传输层：

- **网页**（`relay.ts`）：Express 静态服务 + socket.io。把状态事件转给浏览器，把 socket.io 命令交给执行器。
- **Telegram**（`transports/telegram/`）：grammy 长轮询。把状态映射成论坛话题里的消息，把内联键盘和文本交给执行器。完整说明见 `docs/telegram_prd.md`。
- **飞书**（`transports/feishu/`）：飞书 Node SDK 长连接。私聊控制当前窗口。卡片在立刻回执之后调用 `CommandExecutor`。见 `docs/zh/feishu_setup.md`。
- **QQ**（`transports/qq/`）：官方机器人 WebSocket 网关。私聊控制当前窗口。审批键盘是挂在最近 `msg_id` 上的被动回复。见 `docs/zh/qq_setup.md`。

### 3.1 数据流 — 观察

1. 中继每 500ms 用 `Runtime.evaluate`（CDP）轮询 Cursor DOM
2. 提取函数在 Cursor 渲染进程里走 `[data-flat-index]`
3. 返回结构化 `CursorState`（带类型的 `ChatElement[]`、审批、标签、模式、模型）
4. 状态管理器与上一份状态做 diff
5. 只有变了的字段经 socket.io `state:patch` 广播
6. 新连接的客户端经 `state:full` 拿到完整状态

### 3.2 数据流 — 命令

1. 手机客户端发出 socket.io 事件（例如 `command:approve`、`command:send_message`）
2. 中继校验载荷并交给命令执行器
3. 执行器翻译成 CDP 操作（`Input.insertText`、`Input.dispatchKeyEvent`、`Runtime.evaluate`）
4. CDP 作用在 Cursor 的 DOM 上
5. 下一轮观察拿到由此产生的状态变化
6. 中继把更新后的状态广播给所有客户端

飞书卡片和 QQ 按钮走同一执行器：先向平台回执，再做 CDP 点击。

---

## 4. 状态模型

### 4.1 CursorState

| 字段 | 类型 | 说明 |
| ------------------ | ------------------ | -------------------------------------------- |
| `connected` | `boolean` | CDP 是否已连上 Cursor |
| `agentStatus` | `AgentStatus` | 持久的顶栏状态（`idle`、`waiting_approval`、`error` 等） |
| `agentActivityText` | `string \| null` | 实时活动文案；线上的 `null` 表示明确清空 |
| `agentActivityLive` | `boolean` | 仅当当前 DOM 信号证明正在工作时为真 |
| `agentActivitySource` | `'none' \| 'shimmer' \| 'loading_tool' \| 'loading_indicator' \| 'tail_thought'` | 实时活动信号从哪来 |
| `messages` | `ChatElement[]` | 有序聊天元素（可区分联合） |
| `pendingApprovals` | `Approval[]` | 正在等用户决定的工具调用 |
| `inputAvailable` | `boolean` | 聊天输入框是否可见 / 可聚焦 |
| `chatTabs` | `ChatTab[]` | 打开的聊天 / composer 标签 |
| `mode` | `ModeInfo` | 当前及可选的代理模式 |
| `model` | `ModelInfo` | 当前模型名和 ID |
| `windows` | `CursorWindow[]` | 已发现的全部 Cursor 窗口 |
| `activeWindowId` | `string` | 当前连接的窗口 ID |
| `composerQueue` | `ComposerQueueState` | composer 工具栏里排队的提示 |
| `questionnaire` | `Questionnaire \| null` | 代理问卷（选择题） |

### 4.2 AgentStatus

取值：`idle`、`thinking`、`generating`、`running_tool`、`waiting_approval`、`error`。

### 4.3 ChatElement

聊天里每个元素是八种类型之一，由 `type` 区分。

#### HumanMessage（`type: 'human'`）

`id`（Cursor DOM 里的消息 UUID）、`flatIndex`、`text`、`mentions`（`{ name, mentionType }[]`，文件、终端等 @）。

#### AssistantMessage（`type: 'assistant'`）

`id`、`flatIndex`、`text`、`html`（消毒后的 `.markdown-root` HTML）、`codeBlocks`（`CodeBlockItem[]`，见 §6.11，给网页 / Telegram 原生渲染）。

#### ToolCallElement（`type: 'tool'`）

`id`、`flatIndex`、`toolCallId`、`status`（`loading` 或 `completed`）、`action`（Read、Edit、Shell 或状态摘要）、`details`、可选的 `filename`、`additions`、`deletions`、`summaryText`、`diffBlock`（编辑 / 审阅工具的结构化 diff，网页 + Telegram）。

#### ThoughtBlock（`type: 'thought'`）

`id`、`flatIndex`、`duration`（例如 `"4s"`）。

#### PlanBlock（`type: 'plan'`）

同时表示旧的计划执行摘要（`.plan-execution-message-content`）和富计划控件（`.composer-create-plan-container`）。控件变体多出这些字段：`description`、`todos`（`PlanTodo[]`）、`model`、`actions`（`PlanAction[]`，View Plan 和 Build 的选择器）。共有字段：`label`、`title`、`todosCompleted`、`todosTotal`。

`PlanTodo`：`text`，`status` 为 `pending`、`completed` 或 `in_progress`。

`PlanAction`：`label`、`type`（`view_plan` 或 `build`）、`selectorPath`。

#### RunCommand（`type: 'run_command'`）

代理想执行的终端命令，交互卡片里有完整命令和 Run/Skip/Allow。这是待决定，不是已完成的工具调用。字段：`description`、`candidates`、`command`、`actions`（`RunAction[]`：`label`、`type` 为 `run` / `skip` / `allow`、`selectorPath`）。

#### LoadingIndicator（`type: 'loading'`）

`id`、`flatIndex`。

### 4.4–4.9 其余类型

- **ChatTab**：`composerId`、`title`、`isActive`、`status`、`selectorPath`
- **ModeInfo**：`current`，以及 `available`（`{ id, label, icon }[]`）
- **ModelInfo**：`current`、`currentId`
- **CursorWindow**：`id`（CDP target ID）、`title`、`url`
- **Approval**：`id`、`description`、`actions`
- **ApprovalAction**：`label`、`type`（`approve` / `reject` / `approve_all`）、`selectorPath`

### 4.10 问卷

对应 `.composer-questionnaire-toolbar`。没有问卷时为 null。

`questions`、`activeIndex`、`totalLabel`（例如 `"1 of 3"`）、`skipSelectorPath`、`continueSelectorPath`、`continueDisabled`。

每个问题：`number`、`text`、`options`、`isActive`。每个选项：`letter`、`label`、`isFreeform`（自由输入的 “Other...”）、`selectorPath`。

---

## 5. 协议 — socket.io

每条客户端命令带 `commandId`（UUID），在 `command:result` 里原样返回，用来对上结果。

### 5.1 服务 → 客户端

| 事件 | 载荷 | 何时 |
| ------------------- | ------------------------ | ------------------------------------- |
| `state:full` | `CursorState` | 客户端初次连接 |
| `state:patch` | `Partial<CursorState>` | 任一状态字段变化 |
| `connection:status` | `{ connected: boolean }` | CDP 连接或断开 |
| `command:result` | `{ id, ok, error? }` | 命令执行完或失败 |

### 5.2 客户端 → 服务

| 事件 | 载荷 | 说明 |
| ---------------------- | --------------------------------------------- | ------------------------------ |
| `command:send_message` | `{ commandId, text }` | 输入并提交新提示 |
| `command:approve` | `{ commandId, approvalId, selectorPath }` | 点审批按钮 |
| `command:approve_all` | `{ commandId }` | 点 “Accept All” |
| `command:reject` | `{ commandId, approvalId, selectorPath }` | 点拒绝 |
| `command:switch_tab` | `{ commandId, tabTitle }` | 切换聊天标签 |
| `command:new_chat` | `{ commandId }` | 新建聊天标签 |
| `command:set_mode` | `{ commandId, modeId }` | 改模式 |
| `command:set_model` | `{ commandId, modelId }` | 改模型 |
| `command:switch_window` | `{ commandId, windowId }` | 切换 Cursor 窗口 |
| `command:click_action` | `{ commandId, selectorPath }` | 按选择器点任意操作按钮（Run、Skip、Allow、Build、View Plan） |

---

## 6. 界面

### 6.1 布局

移动优先、单列，对齐 Cursor 深色主题。固定区域：顶栏（连接点 + 代理状态）、窗口条（只有一个窗口时隐藏）、标签条（不超过一个标签时隐藏）、可滚动的消息区、底栏（条件出现的审批条 + 模式 / 模型胶囊 + 输入框）。

### 6.2 聊天元素

- **人类消息**：右对齐气泡，纯文本和 mention 徽章
- **助手消息**：左对齐气泡，来自 Cursor markdown 的消毒 HTML（正文：粗体、列表、行内代码、链接）。composer / Shiki 根节点从 `html` 去掉。代码和 diff 来自结构化 `codeBlocks`（`blockKind` 为 `code` 或 `diff`，可选 `filename` / `language`，`code` 文本，diff 还有 `diffLines`：`add` / `rem` / `ctx` / `meta` / `hunk`）。块接在正文后。工具栏显示文件名或语言，以及全屏。正文在 `.code-block-viewport` 里，大约最多 7 行，超出滚动；全屏是模态（手机安全区，点背景或 Escape 关闭）。
- **工具调用**：单行，状态图标、动作名、目标，以及可选的文件名和绿 / 红增减行数。编辑 / 审阅可以带 `diffBlock`，渲染在 `.tool-diff-host`。
- **思考**：一行淡色文字，例如 “Thought for Xs”
- **计划**：标题、描述、可滚动待办（彩色状态点）、进度条、Build / View Plan，以及网页上的全文弹层和计划模型选择器。见 §6.9。
- **运行命令**：描述、等宽命令、Run / Skip / Allow。见 §6.10。
- **加载**：三个动画点

### 6.3 审批条

`pendingApprovals.length > 0` 时出现在消息和输入框之间。两个大按钮：批准（绿）和拒绝（红），高度至少 48px。没有审批时消失。

### 6.4 输入

通栏文本框和圆形发送按钮。Enter 发送（桌面上 Shift+Enter 换行）。文本经 CDP 的 `Input.insertText`，Enter 经 `Input.dispatchKeyEvent`。

### 6.5 窗口选择

列出 URL 含 `workbench` 的 CDP 页面。标题是从窗口标题解析出的项目名（去掉文件名前缀和 ` - Cursor`）。当前窗口高亮，点一下切换（断开当前，连到新 target）。只有一个窗口时隐藏。列表每 10 秒刷新。

### 6.6 聊天标签条

来自 `.agent-sidebar-cell`。当前标签高亮，按标题匹配切换。一个或零个标签时隐藏。

### 6.7 状态

连接点：绿（已连接）、黄（重连中）、红（断开）。代理状态文案：Idle、Thinking、Running tool、Needs approval、Error。

### 6.8 视觉

深色，对齐 Cursor（背景 `#181818`，文字 `rgba(228,228,228,0.92)`）。颜色用 CSS 变量。代码和工具描述用等宽，聊天用无衬线。没有外部 CSS 框架。

### 6.9 计划控件

`PlanBlock` 带 `todos` 时渲染成富卡片。

- 页眉：文件名（淡、小）+ 标题（粗）
- 描述
- 待办列表（最大高度约 200px）：绿点完成、蓝点进行中、灰点未开始；控件里藏起来的项显示 “N more”
- 进度条和 “N/M”
- 操作行：左侧 View Plan、中间模型名 / 选择器、右侧 Build

Build 和 View Plan 的模型选择都会 `command:click_action` 或把选项写回 Cursor。View Plan 打开网页弹层；磁盘上有计划文件时加载全文，与 Telegram 的全文计划对齐。待办状态变化时卡片就地更新。

### 6.10 运行命令

- 页眉：描述（例如 “Run outside sandbox:”）+ 淡色的命令候选
- 命令块：等宽、深色底、长命令可横向滚动，前面有 `$`
- 操作行：左侧 Skip，右侧 Run；需要沙箱权限时出现 Allow

三个按钮都发 `command:click_action`，带各自的 `selectorPath`。

### 6.11 原生代码块和 diff

数据模型在 `src/server/types.ts` 的 `CodeBlockItem`：`blockKind` 为 `code` 或 `diff`；可选 `filename`、`language`；`code` 保留真实换行；`diffLines` 的 `kind` 来自提取器里 Monaco 行装饰，不是解析镜像 HTML。

助手的 `html` 只是 `.markdown-root` 的 innerHTML。`codeBlocks` 从 composer 代码控件单独建，不把控件 HTML 并进 `html`。编辑 / 审阅工具在有对应块时用 `diffBlock`，网页渲染在 `.tool-diff-host`。

如果 Cursor 给出的是普通补丁文本（`@@` 和 `+` / `-` 行），提取器把它升级成 `blockKind: 'diff'`，原生渲染仍有红 / 绿，而不是一整块纯文本。

网页：`createNativeBlockFromItem` 建工具栏和大约 7 行高的视口。全屏是 `.code-block-fs-overlay`。展开和关闭的触控热区至少 44×48px。

Telegram：`formatter.ts` 把 composer 节点映射成 `<pre><code>`，在适用时使用结构化 `codeBlocks` 和 diff 行前缀。

限制：控件还没画出编辑器行（折叠）时，`code` 和 `diffLines` 要等下一次轮询才有内容。网页会留下这块，并说明要等 Cursor 画出这些行。

---

## 7. DOM 提取

### 7.1 难点

Cursor 是基于 VS Code 的 Electron 应用。类名随版本变。没有公开的聊天状态 API。

### 7.2 用 data 属性

- `data-flat-index="N"` — 每条消息包装上的序号
- `data-message-role="human|ai"`
- `data-message-kind="human|assistant|tool"`
- `data-message-id` — 稳定消息 ID
- `data-tool-call-id`、`data-tool-status="loading|completed"`、`data-compact="true"`

提取函数在聊天容器里选所有 `[data-flat-index]`，再用 role + kind 分类。类型与 DOM 的对应关系和英文 §7.2 的表相同：human、assistant、tool、plan（`.composer-create-plan-container`）、旧 plan、run_command（`.composer-terminal-tool-call-block-container`）、thought、loading。

不在 data 属性体系里的元素（聊天容器、输入框、批准 / 拒绝、状态、标签、模式 / 模型）使用 `selectors.json` 里的 CSS 选择器，并按级联尝试。

### 7.3 发现工具

`npm run discover`（`src/discovery/discover-dom.ts`）经 CDP 连接 Cursor：列出 target、转储主窗口 DOM 摘要、搜索聊天 / 代理相关元素、输出建议写入 `selectors.json` 的选择器。

### 7.4 轮询和 diff

提取间隔 `POLL_INTERVAL_MS`（默认 500ms）。`DEBOUNCE_MS`（默认 300ms）避免流式输出时的广播风暴。状态管理器对每个顶层字段做 JSON.stringify 深比较。只有变了的字段进入 `state:patch`。

---

## 8. 配置

全部由环境变量配置。

**核心**：

| 变量 | 默认 | 说明 |
| ------------------ | -------------------------- | ---------------------------------------- |
| `CDP_URL` | `http://127.0.0.1:9222` | Cursor 的 CDP 地址 |
| `SERVER_PORT` | `3000` | 网页和 socket.io 端口 |
| `SERVER_HOST` | `0.0.0.0` | 绑定地址（`0.0.0.0` 表示局域网）。扩展默认改成 `127.0.0.1` |
| `POLL_INTERVAL_MS` | `500` | DOM 轮询间隔（毫秒） |
| `DEBOUNCE_MS` | `300` | 最短广播间隔（毫秒） |
| `SELECTORS_PATH` | `./selectors.json` | DOM 选择器配置 |
| `LOG_LEVEL` | `info` | debug / info / warn / error |

**Telegram**：

| 变量 | 默认 | 说明 |
| ------------------------ | -------- | ------------------------------------------------ |
| `TELEGRAM_ENABLED` | `false` | 是否启用 |
| `TELEGRAM_BOT_TOKEN` | — | @BotFather 的 token（启用时必填） |
| `TELEGRAM_ALLOWED_USERS` | — | 可选：写死允许的用户 ID（覆盖口令鉴权） |

**飞书**：

| 变量 | 默认 | 说明 |
| ------------------------ | -------- | ------------------------------------------------ |
| `FEISHU_ENABLED` | `false` | 启用飞书长连接 |
| `FEISHU_APP_ID` | — | 自建应用 ID（`cli_xxx`） |
| `FEISHU_APP_SECRET` | — | 应用密钥（扩展存在 SecretStorage） |
| `FEISHU_ALLOWED_USERS` | — | 跳过 `/bind` 的 open_id，逗号分隔 |

**QQ**：

| 变量 | 默认 | 说明 |
| ------------------- | -------- | ----------------------------------------------------- |
| `QQ_ENABLED` | `false` | 启用 QQ 官方机器人 |
| `QQ_APP_ID` | — | 机器人 App ID |
| `QQ_APP_SECRET` | — | 应用密钥（扩展存在 SecretStorage） |
| `QQ_SANDBOX` | `false` | 审核通过前使用沙箱网关 |
| `QQ_ALLOWED_USERS` | — | 跳过 `/bind` 的 `user_openid`，逗号分隔 |

---

## 9. 技术要求

### 9.1 服务

- Node.js 20+
- TypeScript 严格模式
- 自写轻量 CDP 客户端（`ws`），不用 Puppeteer（Electron 会挡住）
- `express` 提供静态文件
- `socket.io`，自动重连和传输回退
- `grammy` 接 Telegram（论坛话题、内联键盘）
- `@larksuiteoapi/node-sdk` 接飞书长连接
- `ws` 接 QQ 官方网关（access token 和 C2C 发送用 `fetch`）
- `qrcode` 给 Setup 面板画绑定二维码
- `node-html-parser` 把 Cursor 的复杂 HTML 转成 Telegram 能接受的 HTML
- 开发用 `tsx watch`

### 9.2 客户端

- 原生 HTML/CSS/JavaScript，没有框架，没有构建步骤
- socket.io 客户端由服务提供
- 现代手机浏览器（Safari iOS 15+、Chrome Android 90+）
- 不依赖外部 CDN

### 9.3 主机环境

- Windows 上的 Cursor，带 `--remote-debugging-port=9222`（macOS / Linux 同样支持该参数）
- 中继可以跑在同一台机器的 WSL2 里
- 手机与 Windows 主机在同一局域网，或经 Tailscale

---

## 10. 关键技术决定

### 10.1 自写 CDP 客户端

直接用 `ws`。Electron / Cursor 挡住 Puppeteer 需要的 `Target.getBrowserContexts`。客户端直连页面 target 的 WebSocket URL。

### 10.2 打字走 CDP Input

`Input.insertText` 和 `Input.dispatchKeyEvent`。ProseMirror / TipTap 不吃 `document.execCommand` 和 `element.value=`。CDP Input 走 Chromium 原生输入管线。

### 10.3 用 data 属性提取消息

`data-flat-index`、`data-message-role`、`data-message-kind`。类名随 Cursor 版本变。data 属性是语义稳定的，对应 Cursor 内部数据模型。

---

## 11. 实现状态

| 功能 | 状态 | 备注 |
| --------------------------- | ----------- | --------------------------------------------- |
| CDP 连接与发现 | 完成 | 自写客户端，自动发现 target |
| 多窗口 | 完成 | 发现全部 workbench target，窗口选择，`switchWindow` |
| DOM 提取（消息） | 完成 | 经 data 属性抽出带类型的 ChatElement |
| DOM 提取（标签 / 模式） | 完成 | `.agent-sidebar-cell` 以及下拉里的模式 / 模型 |
| 状态 diff | 完成 | JSON diff、防抖广播；窗口与 DOM 分开跟踪 |
| 发消息 | 完成 | `Input.insertText` + Enter |
| 审批按钮 | 完成 | 文本匹配 + 按选择器点击 |
| 切换聊天标签 | 完成 | 按标题匹配 `.agent-sidebar-cell`，JS `.click()` |
| 切换模式 / 模型 | 完成 | 下拉触发器和菜单项 JS `.click()`；模型会确认菜单关闭 |
| 手机模型菜单 | 完成 | MAX 开关、分类、大脑徽章 |
| 手机网页 | 完成 | 按类型渲染，主题对齐 Cursor |
| 自动重连 | 完成 | CDP 和 socket.io 两侧 |
| 浏览器通知 | 完成 | 待审批、运行命令、工具级操作 |
| 计划控件提取与网页渲染 | 完成 | 待办、Build / View Plan |
| 运行命令提取与网页渲染 | 完成 | 等宽命令，Run/Skip/Allow |
| 原生代码 / diff | 完成 | `codeBlocks` / `diffBlock`，约 7 行视口 + 全屏；不镜像 Monaco HTML |
| 传输层抽象 | 完成 | Transport 接口、SendQueue、MessageTracker、WindowMonitor |
| Telegram | 完成 | grammy、自动同步、`/register`、并行 CDP、内联键盘 |
| 飞书 | 完成 | 长连接、`/bind`、私聊 → 当前窗口、审批卡片 |
| QQ | 完成 | 官方 WebSocket、`/bind`、被动审批回复；不镜像完整对话 |
| 安装文档 | 部分 | 新用户安装指南仍在补；飞书 / QQ 见 `docs/zh/` |

---

## 12. 风险

| 风险 | 影响 | 可能性 | 缓解 |
| ---- | ------ | ---------- | ---------- |
| Cursor 版本之间 DOM 变化 | 提取坏掉 | 高 | data 属性 + 外置选择器 + 发现工具 |
| 逐 token 流式输出造成广播风暴 | CPU / 带宽高 | 高 | 防抖，发 diff 不发全量 |
| WSL2 网络让手机连不上 | 客户端连不上 | 中 | 文档写明镜像模式和端口转发 |
| ProseMirror 拒绝程序化输入 | 发消息失败 | 低 | CDP Input 走原生管线 |
| 审批按钮布局变化 | 批准 / 拒绝失效 | 高 | 文本匹配回退，发现工具重映射 |
| 多个窗口共用一个 CDP 端口 | 命令打到错误窗口 | 低 | 窗口选择、显式切换、定期刷新窗口列表 |
| 元素 ID 含点或冒号 | CSS 路径坏掉 | 中 | `buildSelectorPath` 转义 |
| Telegram 编辑频率限制 | 更新被丢或变慢 | 低 | 500ms 轮询 + 300ms 防抖，低于 Telegram 约 30 次/秒 |
| Telegram 4096 字符上限 | 长助手消息被截断 | 中 | 拆成多条，一个元素跟踪多个 message ID |
| callback_data 64 字节 | 放不下完整选择器路径 | 高 | callback 里用哈希，查表还原选择器 |
| 计划控件 DOM 变化 | 计划提取坏掉 | 中 | 认 `.composer-create-plan-container`，回退旧的 `.plan-execution-message-content` |
| 运行命令的沙箱 / Allow 变体 | 按钮缺失或分错类 | 中 | 认终端容器，按 class 抽出全部按钮 |
| 非当前标签在 Telegram 里变旧 | 那个话题看起来停了 | 高 | 话题写明不是正在监视的标签，打开该标签后继续更新。其他已打开窗口的当前标签仍用并行 CDP 刷新。不会去点隐藏标签。 |

飞书编辑频率和 QQ 被动回复窗口是平台限制，分别见飞书安装说明和 `docs/zh/qq-backlog.md`。

---

## 13. 以后

- **Discord**：复用 Transport 接口，线程当话题
- **Telegram 隐藏标签**：打开没在看的对话标签才能刷新那些话题，同时也会改掉 Cursor 正在显示的对话。其他已打开窗口的当前标签已经用并行 CDP 刷新。
- **鉴权**：HTTP 和 socket.io 上的 token 中间件
- **网页代码体验**：可选复制，可配置的行内预览高度（默认约 7 行）
- **自动审批规则**：例如自动批准读操作
- **PWA**：通知说明之后提供加到主屏幕。Service worker 只转发网络请求，不缓存实时页面。浏览器关掉之后的 Web Push 仍是以后的事。
- **推送**：浏览器关掉后用 Web Push
- **动态模型列表**：从 Cursor DOM 提取可选模型，而不是写死

---

## 14. 成功标准

**网页**：

1. 中继经 CDP 连上正在运行的 Cursor
2. 手机网页以正确格式显示代理对话
3. 每种聊天元素渲染可区分（人类、助手、工具、思考、计划、运行命令）
4. 计划显示完整待办和状态，Build / View Plan 可用
5. 运行命令显示完整命令，Run / Skip / Allow 可用
6. 在手机上点批准 / 拒绝会在 Cursor 里触发
7. 从手机发出的消息出现在 Cursor 输入框并提交
8. 聊天标签、模式、模型可以在手机上切换
9. 短暂断线能自动恢复
10. 从操作到界面反映的延迟低于 2 秒

**Telegram**：

11. 机器人连上，用户用 `/register <token>` 注册，`/sync` 对论坛群打开自动同步
12. 同步打开后，新窗口和聊天标签自动建话题。全部窗口经并行 CDP 监控（不切换界面）
13. 当前窗口 + 标签的对话流进对应话题（初次同步最近 5 条）
14. `/history [N]` 按限速把最近 N 条（默认 5）发进话题
15. 每种 ChatElement 有对应的 Telegram 格式（HTML、代码块、内联键盘）
16. 审批内联按钮（Accept / Reject / Accept All）触发正确操作
17. 运行命令卡片显示命令，并提供 Run / Skip / Allow
18. 计划显示待办，并提供 Build / View Plan
19. 在话题里打字会把文本发到对应的 Cursor 窗口 + 标签
20. `/mode` 和 `/model` 显示当前状态，并用内联键盘切换
21. 代理活动时机器人显示正在输入
22. 全部出站 API 经 SendQueue 限速（Telegram 发送约 300ms、编辑 100ms）并自动重试
23. 口令鉴权（`/register`），可选 `TELEGRAM_ALLOWED_USERS` 覆盖。数据在 `data/`
