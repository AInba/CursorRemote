# 飞书接入

[English](../feishu_setup.md)

CursorRemote 可以把本机 Cursor 代理接到飞书机器人。中继主动向飞书建立 WebSocket 长连接，不需要公网 IP、域名或 ngrok。聊天内容仍会经过飞书云端，这不是只在局域网里的连接。

当前阶段从**私聊控制当前 Cursor 窗口**。群话题路由还没有做。

## 1. 创建企业自建应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)，创建企业**自建**应用。商店应用不能使用长连接。
2. 开通**机器人**能力。
3. 权限（租户 / 应用身份）至少包括：
   - `im:message`
   - `im:message:send_as_bot`
   - `im:message.group_at_msg` 与 `im:message.p2p_msg`（接收消息）
   - 以后要发图片时再加 `im:resource`
4. 事件：订阅**接收消息** `im.message.receive_v1`。
5. 回调：订阅**卡片回传交互** `card.action.trigger`。
6. 事件订阅和回调订阅都选**使用长连接接收事件**。保存按钮只有在这个应用的长连接已经在线时才会成功，所以要先用应用凭证把中继启动一次（第 3 步），再回来保存。然后发布应用版本。

## 2. 填写凭证

在 Cursor 里：**CursorRemote: Open Setup Panel** → **Feishu**。

- App ID（`cli_xxx`）
- App Secret（存在 VS Code SecretStorage 里，不写进设置项）

或者独立运行时写在 `.env`：

```bash
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=your-secret
```

保存后重启中继。日志里应出现 `Long connection ready` 和一条 `/bind` 口令。

可选：`FEISHU_ALLOWED_USERS=ou_xxx`（或设置项 `cursorRemote.feishu.allowedUsers`）让这些 open_id 跳过绑定口令。

## 3. 扫码并绑定

Setup 面板大约每 60 秒刷新一次，显示两段内容：

| 内容 | 怎么用 |
|------|--------|
| 打开机器人 | 用飞书扫码，打开与机器人的会话（`applink.feishu.cn`） |
| 绑定命令 | 文本 `/bind 123456`。把这条命令原样发给机器人 |

口令只用一次，60 秒后失效。失败就从面板复制新的命令。

绑定成功后，该飞书用户写入数据目录里的 `feishu-auth.json`。私聊记在 `feishu-sessions.json`，并跟随中继的**当前** Cursor 窗口。

## 4. 使用

在私聊里：

- 非命令文本会输入到当前 Cursor 输入框并提交。回复会写上窗口名，例如 `已发送到：my-app`。
- `/status` — 中文状态（空闲、等待审批等）、模式、模型，以及待审批
- `/history` — 回看当前窗口里更早的对话。平时只推送最近十几条。`/history` 默认 30 条，最多 80 条（`/history 50`）。页面上不够时，会先让 Cursor 向上滚动再读，然后滚回底部。
- `/windows` 列出 Cursor 窗口并标出当前窗口。`/window <序号或名称>` 切换后，后面的消息发到那个窗口。同一张卡片上每个窗口有一个按钮。
- `/tabs` 和 `/tab <序号或名称>` 切换当前窗口里的对话标签。
- `/model` 读取模型菜单（Cursor 会短暂打开它），`/model <序号或名称>` 选中一个。
- `/mode` — 模式按钮
- `/unbind` — 解除这个账号。Setup 面板上的移除按钮做同一件事。写在 `FEISHU_ALLOWED_USERS` 里的 open_id 会在中继下次启动时重新加入。
- 审批、Run / Skip / Allow、计划的 Build，以及问卷选项，以卡片形式出现。点击会立刻回执；CDP 点击在回调返回之后执行（飞书要求 3 秒内响应）。执行结果会带上窗口名。
- 超过约 3500 字的对话会被截断，并注明其余内容在 Cursor 或网页客户端。

Cursor 必须以 `--remote-debugging-port=9222` 启动。

## 限制

- 每个应用只保留一个中继进程。飞书把每条事件发给一条长连接。
- 流式助手文本会就地编辑并做防抖。飞书限制编辑时，那条消息保持原样，状态行会写明代理没有停。被限流的编辑不会再当成新消息发一次。
- 在群里发送 `/bind` 不会注册，也不会用掉口令。只有私聊能控制 Cursor。
