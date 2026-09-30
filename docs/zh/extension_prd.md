# CursorRemote — 扩展需求

[English](../extension_prd.md)

## 1. 概述

把 CursorRemote 中继打成 VS Code / Cursor 扩展。扩展把服务作为子进程管理，并提供编辑器内的设置、安装向导、状态栏、输出通道、侧边栏、许可证和多窗口协调。服务代码、网页客户端，以及 Telegram、飞书、QQ 传输层打进扩展，作为一个子进程运行。打包进去的**网页客户端**把助手 **`codeBlocks`** 和工具 **`diffBlock`** 渲染成原生代码 / diff 界面（大约 7 行的滚动视口、全屏阅读、手机触控热区；见 `docs/zh/prd.md` §6.11 和 `docs/zh/architecture.md` §2.6）。

### 1.1 问题

独立服务要手工安装：克隆仓库、安装依赖、写 `.env`、跑 `npm run dev`。用户自己管进程。编辑器里看不到服务状态、CDP 健康或代理活动。多窗口会抢端口，也会拉起重复的机器人。

### 1.2 目标

发布一个 VS Code / Cursor 扩展，它：

- 从 `.vsix` 安装（市场上架另计）
- 自动管理中继生命周期（启动 / 停止 / 重启）
- 全部配置走 VS Code 设置（不需要 `.env`）
- 用 Setup 面板配置网络、密码、Telegram、飞书和 QQ
- 在状态栏和侧边栏显示服务与 CDP 状态
- 把服务日志接到带级别过滤的 LogOutputChannel
- 侧边栏显示代理状态、窗口和快捷操作，含 Start / Stop
- 许可证入口在侧边栏，不弹打断式窗口
- 首次安装自动生成随机网页密码
- 多个 Cursor 窗口只跑一个服务（单例）
- 服务依赖打进单个文件（扩展包里不需要 `node_modules`）
- 与独立的 `npm run dev` 保持兼容

### 1.3 不做

- 把服务改写成直接跑在 Extension Host 里
- 用 VS Code 扩展 API 替换基于 CDP 的 DOM 提取
- 自动发现或配置 CDP 调试端口

---

## 2. 用户故事

### US-1：装上就能用
**作为** Cursor 用户，**我希望**从 `.vsix` 安装扩展、输入许可证后服务就在跑，**这样**就不用克隆仓库、装依赖或改配置文件。

### US-2：自动启动
**作为**开发者，**我希望** Cursor 启动时中继自动起来，**这样**手机客户端和已启用的聊天机器人不用手点就可用。

### US-3：设置界面
**作为**开发者，**我希望**在 VS Code 设置里配置 CDP 地址、端口、Telegram、飞书、QQ 和其他选项，并带文档链接，**这样**就不用改 `.env`。

### US-4：安装向导
**作为**新用户，**我希望** Setup 面板带我配网络、密码、Telegram、飞书和 QQ，**这样**不必先读文档。

### US-5：状态可见
**作为**开发者，**我希望**在侧边栏和状态栏看到服务状态、CDP 连接、代理活动和已连接客户端，**这样**一眼知道系统是否正常。

### US-6：控制服务
**作为**开发者，**我希望**侧边栏有 Start 和 Stop，**这样**不用打开命令面板。

### US-7：许可证
**作为**用户，**我希望**许可证提示不打扰——放在侧边栏，并带购买链接，**这样**每次启动都不会弹窗。

### US-8：自动密码
**作为**新用户，**我希望**首次安装就生成强随机密码，**这样**网页默认就是有保护的。

### US-9：多窗口安全
**作为**开了多个 Cursor 窗口的开发者，**我希望**同一时间只有一个服务，并且能自动恢复，**这样**不会端口冲突，也不会出现重复的 Telegram 机器人。

### US-10：服务日志
**作为**开发者，**我希望**在输出面板按级别看服务日志，**这样**不用切到终端排查。

---

## 3. 架构

扩展跑在 VS Code Extension Host（Node.js 进程）里。它拉起服务子进程，通过：

1. **环境变量** — 启动时传入配置和许可证
2. **HTTP 轮询** — 每 5 秒 `GET /health` 取状态
3. **解析 stdout/stderr** — 日志行接到 LogOutputChannel

服务及其 Node.js 依赖由 esbuild 打成单个 ESM 文件（`dist/server/bundle.mjs`）。扩展本身打成 `dist/extension.cjs`（CJS，`vscode` 为 external）。

### 3.1 单例服务

所有 Cursor 窗口只跑一个服务进程：

1. 启动时 `ServerManager` 对配置端口探测 `GET /health`
2. 已有服务时，该窗口作为 **observer** 挂上（轮询健康、显示状态，但不拥有进程）
3. 没有服务时，该窗口拉起服务并成为 **owner**
4. owner 窗口关闭后，observer 连续 3 次健康检查失败，再经过随机抖动（0–3 秒）由一个 observer 接管，避免同时抢
5. 同时拉起导致的竞争：从 stderr 捕获 `EADDRINUSE`，退回 observer

---

## 4. 扩展命令

| 命令 ID | 标题 | 说明 |
|---|---|---|
| `cursorRemote.start` | CursorRemote: Start Server | 启动中继 |
| `cursorRemote.stop` | CursorRemote: Stop Server | 停止中继 |
| `cursorRemote.restart` | CursorRemote: Restart Server | 重启中继 |
| `cursorRemote.openWebClient` | CursorRemote: Open Web Client | 打开浏览器客户端地址 |
| `cursorRemote.openSetup` | CursorRemote: Open Setup Panel | 打开网络、Telegram、飞书、QQ 向导 |
| `cursorRemote.showLogs` | CursorRemote: Show Logs | 显示输出通道 |
| `cursorRemote.enterLicenseKey` | CursorRemote: Enter License Key | 提示输入许可证 |
| `cursorRemote.buyLicense` | CursorRemote: Buy License | 打开商店链接（带 UTM） |

---

## 5. 扩展设置

都在 `cursorRemote` 命名空间下。每项一对一映射到服务环境变量。`markdownDescription` 里有文档链接。

| 设置 | 类型 | 默认 | 环境变量 | 说明 |
|---|---|---|---|---|
| `cursorRemote.autoStart` | boolean | `true` | — | 启动时自动拉起服务 |
| `cursorRemote.cdpUrl` | string | `http://127.0.0.1:9222` | `CDP_URL` | Cursor 的 CDP 地址 |
| `cursorRemote.serverPort` | number | `3000` | `SERVER_PORT` | 网页端口 |
| `cursorRemote.serverHost` | string | `127.0.0.1` | `SERVER_HOST` | 绑定地址（默认只本机） |
| `cursorRemote.pollIntervalMs` | number | `500` | `POLL_INTERVAL_MS` | DOM 轮询频率 |
| `cursorRemote.debounceMs` | number | `300` | `DEBOUNCE_MS` | 广播防抖 |
| `cursorRemote.logLevel` | enum | `info` | `LOG_LEVEL` | 日志级别 |
| `cursorRemote.webappPassword` | string | *（自动生成）* | `WEBAPP_PASSWORD` | 网页密码 |
| `cursorRemote.windowTitleQualifier` | boolean | `true` | `WINDOW_TITLE_QUALIFIER` | 标题中显示远程限定符 |
| `cursorRemote.telegram.enabled` | boolean | `false` | `TELEGRAM_ENABLED` | 启用 Telegram |
| `cursorRemote.telegram.botToken` | string | `""` | `TELEGRAM_BOT_TOKEN` | 机器人 token |
| `cursorRemote.telegram.allowedUsers` | string | `""` | `TELEGRAM_ALLOWED_USERS` | 逗号分隔的 ID |
| `cursorRemote.feishu.enabled` | boolean | `false` | `FEISHU_ENABLED` | 启用飞书长连接 |
| `cursorRemote.feishu.appId` | string | `""` | `FEISHU_APP_ID` | 自建应用 ID |
| `cursorRemote.feishu.appSecret` | string | `""` | `FEISHU_APP_SECRET` | 已废弃。经 Setup 面板写入 SecretStorage |
| `cursorRemote.feishu.allowedUsers` | string | `""` | `FEISHU_ALLOWED_USERS` | 跳过 `/bind` 的 open_id |
| `cursorRemote.qq.enabled` | boolean | `false` | `QQ_ENABLED` | 启用 QQ 官方机器人 |
| `cursorRemote.qq.appId` | string | `""` | `QQ_APP_ID` | 机器人 App ID |
| `cursorRemote.qq.appSecret` | string | `""` | `QQ_APP_SECRET` | 已废弃。经 Setup 面板写入 SecretStorage |
| `cursorRemote.qq.allowedUsers` | string | `""` | `QQ_ALLOWED_USERS` | 跳过 `/bind` 的 openid |
| `cursorRemote.qq.sandbox` | boolean | `false` | `QQ_SANDBOX` | 审核通过前使用沙箱网关 |

### 5.1 安全默认值

- `serverHost` 默认 `127.0.0.1`（不是 `0.0.0.0`）。用户在 Setup 面板明确打开之前，服务不会暴露到网络。
- `webappPassword` 在首次激活时用 `crypto.randomBytes(24)` 生成，并写入 VS Code 设置。用户看到一条不打断的通知，可“复制到剪贴板”。
- 飞书和 QQ 的应用密钥走和 Telegram token 一样的路径：Setup 面板写入 SecretStorage（`cursorRemote.feishu.appSecret`、`cursorRemote.qq.appSecret`）。设置里的明文会在激活时迁入 SecretStorage，然后清空。

---

## 6. 状态栏

靠左的状态栏项显示服务状态：

| 状态 | 文本 | 颜色 | 条件 |
|---|---|---|---|
| Running | `$(radio-tower) Remote: Running` | 绿 | 服务健康且 CDP 已连接 |
| Disconnected | `$(radio-tower) Remote: Disconnected` | 黄 | 服务在跑，CDP 未连接 |
| Stopped | `$(radio-tower) Remote: Stopped` | 默认 | 服务未运行 |
| Error | `$(radio-tower) Remote: Error` | 红 | 服务崩溃或不可达 |

点击打开 CursorRemote 侧边栏（不是命令面板）。

---

## 7. 侧边栏

活动栏视图容器 `cursorRemote`，由 `TreeDataProvider` 显示：

### 未授权

- **License Key Required**（点击激活）— 红色钥匙图标
- **Buy License** — 带 UTM 的商店链接
- **Open Setup Panel** — 齿轮

### 已授权且服务在跑

- **Server: Running** — 绿色勾，描述里有运行时间；非 owner 窗口标 “observer”
- **Stop Server** — 停止按钮
- **CDP: Connected** — 插头图标，当前工作区名
- **Agent** — 状态（idle / running_tool 等）、模式 / 模型
- **Clients** — 已连接浏览器会话数
- **Pending Approvals** — 角标数量（为 0 时隐藏）
- **Windows** — 已发现的 Cursor 窗口数和名称
- *（分隔）*
- **Open Setup Panel** — 齿轮
- **Open Web Client** — 外链图标
- **Show Logs** — 输出图标

### 已授权但服务已停

- **Server: Stopped** — “click to start”
- **Start Server** — 播放按钮
- *（分隔）*
- **Open Setup Panel**、**Open Web Client**、**Show Logs**

健康检查和服务状态变化时刷新。

---

## 8. Setup 面板（WebviewPanel）

由 `cursorRemote.openSetup` 打开。创建在 `ViewColumn.One`，`retainContextWhenHidden: true`。文案跟随 `vscode.env.language`：以 `zh` 开头时用中文，飞书、QQ 和安装说明链到 `docs/zh/`。其他语言保持英文。

### 网络页

- **单选**：Localhost / LAN / 指定地址（Tailscale 或自定义）
- 选“指定地址”时显示地址输入框
- **Save & Restart** — 更新设置并重启服务
- 选择局域网（`0.0.0.0`）且网页密码为空时，面板会警告：同一网络上的任何人都能控制 Cursor。保存前就能看到，保存这个组合时编辑器再警告一次。
- Tailscale 文档链接

### 密码

- 可编辑的当前密码
- **Copy** 和 **Save**
- 显示服务 URL 供对照

### Telegram 页

- **第 1 步：创建机器人** — @BotFather 链接，token 输入（已设置则打码显示）
- **第 2 步：创建超级群** — Topics 和管理员说明
- **第 3 步：注册** — 显示 `telegram-auth.json` 里真实的 `/register <token>`，可复制。列出已注册用户和用户名。
- **第 4 步：同步** — 说明发送 `/sync`

### 飞书页

- App ID 和 App Secret。密钥保存后打码。
- 轮换的 `/bind` 口令，大约每 15 秒从服务刷新，以及打开机器人的 applink 二维码和绑定命令二维码。
- 一行说明长连接是否真的连上。只保存密钥不算机器人已连接。
- 跳过 `/bind` 的 open_id。
- 每个已绑定账号有移除按钮。中继在跑时立刻生效。中继没在跑时，删掉本机记录，下次启动后生效。允许名单里的账号下次启动会回来，面板会说明。

### QQ 页

- App ID、App Secret，以及 Sandbox 复选框。
- 轮换的 `/bind` 口令和该命令的二维码。打开机器人仍用 QQ 控制台的扫码聊天。
- 一行显示网关已连接、沙箱 `4914`，或 IP 白名单被拒。
- 跳过 `/bind` 的 `user_openid`。
- 每个已绑定账号有移除按钮，生效方式和飞书相同。

### 页脚

- **Open All Settings** — 先销毁 webview，再在下一拍打开过滤为 `@ext:cursor-remote.cursor-remote` 的 VS Code 设置（避免保留的 webview 和设置编辑器抢同一列，把 Cursor 渲染进程卡死）

---

## 9. 许可证流程

1. 激活时从 `context.secrets` 读密钥
2. 有效：若 `autoStart` 打开则启动服务
3. 缺失或无效：侧边栏显示 “License Key Required”（不弹窗）
4. 用户点击后用 `showInputBox` 输入，并做格式校验
5. 有效密钥写入 `context.secrets.store('cursorRemote.licenseKey', key)`
6. 通过环境变量 `LICENSE_KEY` 传给服务子进程
7. 服务自己的 `checkLicense()` 再校验一次
8. 侧边栏 “Buy License” 打开带 UTM 的商店链接（`?utm_source=extension&utm_medium=sidebar&utm_campaign=license`）

---

## 10. 入门演练

`contributes.walkthroughs` 提供分步引导：

1. **输入许可证** — 命令链接和购买链接（带 UTM）
2. **确认 CDP** — `--remote-debugging-port=9222` 的说明，以及启动服务命令
3. **配置网络** — 打开 Setup 面板
4. **配置 Telegram** — 可选，打开 Setup 面板
5. **配置飞书** — 可选。`cursorRemote.feishu.appId` 变化后记为完成。步骤见 `docs/zh/feishu_setup.md`
6. **配置 QQ** — 可选。`cursorRemote.qq.appId` 变化后记为完成。步骤见 `docs/zh/qq_setup.md`
7. **完成** — 摘要，并链到文档

---

## 11. 服务侧配合

为扩展做的、向后兼容的改动：

### 11.1 更丰富的 `/health`

返回 `windows`、`activeWindowId`、`mode`、`model`、`chatTabCount`、`pendingApprovalCount`、`generation`、`uptime`、`authRequired`。旧客户端忽略未知字段。

### 11.2 `LICENSE_KEY`

先读 `process.env.LICENSE_KEY`，没有再读 `data/license.key`。

### 11.3 `DATA_DIR`

可配置的数据目录（默认 `./data`）。扩展把它设为 `context.globalStorageUri.fsPath`。

### 11.4 `LOG_FORMAT`

设为 `json` 时，stdout 输出结构化 JSON 行。

### 11.5 静态资源防缓存

`GET /` 动态读 `index.html`，给 `app.js` 和 `styles.css` 加上 `?v=<random>`。静态文件带 `Cache-Control: no-cache, must-revalidate`。

### 11.6 鉴权中间件顺序

`/health` 和静态文件在鉴权中间件之前提供，避免网页检查登录状态时重定向循环。

### 11.7 grammY 使用原生 fetch

Telegram 机器人以 `{ client: { fetch } }` 构造，使用 Node.js 原生 `fetch`。grammY 默认的 HTTP 客户端（基于 `node:https` / `node-fetch`）在 esbuild 打出的 ESM 环境里会坏。

### 11.8 Telegram 优雅关闭

关服务时 `bot.stop()` 最多等 3 秒，把长轮询会话关干净，下一个实例可以马上连上。

### 11.9 Telegram 连通性诊断

启动时用原始 `fetch` 请求 `api.telegram.org/bot<token>/getMe` 和 `deleteWebhook`。不可达时再测 `google.com`，区分是 Telegram 被拦还是整个网络有问题。

---

## 12. 构建与分发

### 12.1 扩展构建

- esbuild 把 `extension/src/extension.ts` 打成 `dist/extension.cjs`
- 格式 CommonJS，平台 Node，external：`['vscode']`

### 12.2 服务构建

- esbuild 把 `src/server/index.ts` 和全部 Node.js 依赖打成 `dist/server/bundle.mjs`
- 格式 ESM，平台 Node
- banner 注入 CJS 兼容垫片（`__dirname`、`__filename`、`createRequire`），因为 Express 等被打包的包依赖这些全局量
- 扩展包里不需要 `node_modules`

### 12.3 客户端构建

- `tsc` 编译 TypeScript
- `src/client/` 复制到 `dist/client/`
- `socket.io.min.js` 从 `node_modules` 复制到 `dist/client/`

### 12.4 打包

- `npm run package` 递增补丁版本，然后 `vsce package --no-dependencies`
- 输出：`releases/cursor-remote-X.Y.Z.vsix`
- `.vscodeignore` 只包含：`dist/extension.cjs`、`dist/server/bundle.mjs`、`dist/client/`、`extension/media/walkthrough/`、`selectors.json`、`package.json`、`README.md`、`CHANGELOG.md`、`LICENSE`

### 12.5 版本号

- `npm run package` 经 `scripts/bump-build.ts` 自动递增补丁版本
- `npm run release -- patch|minor|major` 递增语义化版本、更新变更记录、打 git 标签

---

## 13. 向后兼容

每项增强都由环境变量控制，默认行为与原来一致：

| 环境变量 | 独立运行默认 | 扩展设置 |
|---|---|---|
| `LICENSE_KEY` | 未设置 → 读 `data/license.key` | Secrets API 里的密钥 |
| `DATA_DIR` | 未设置 → `./data` | `context.globalStorageUri.fsPath` |
| `LOG_FORMAT` | 未设置 → 纯文本 | `json` |

独立的 `npm run dev` 和 `npm start` 与以前相同。`.env`、`data/` 和命令行行为不变。
