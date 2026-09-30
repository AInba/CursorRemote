# QQ 官方机器人接入

[English](../qq_setup.md)

CursorRemote 可以从 QQ 私聊控制当前 Cursor 窗口。中继主动向 QQ 建立 WebSocket，不需要公网 webhook。消息仍会经过 QQ 的服务器。

只使用官方机器人 API。

## 1. 创建机器人

1. 打开 [QQ 机器人控制台](https://q.qq.com/qqbot/) 并创建机器人。个人机器人可以限制可用的用户和群。
2. 复制 App ID 和 App Secret。
3. 事件订阅选择 **WebSocket**，不要选 Webhook。
4. 如果控制台有 IP 白名单，把这台机器的公网出口 IP 加进去。家庭 NAT 地址会变；变了之后网关会报 IP 错误，直到你更新名单。沙箱模式更宽松。
5. 机器人审核通过之前，打开**沙箱**，并把你的 QQ 加为沙箱用户。用控制台的**扫码聊天**打开会话。

## 2. 填写凭证

CursorRemote Setup → **QQ**：

- App ID
- App Secret（存在 VS Code SecretStorage）
- Sandbox 复选框

或者 `.env`：

```bash
QQ_ENABLED=true
QQ_APP_ID=
QQ_APP_SECRET=
QQ_SANDBOX=true
```

重启中继。日志里应出现 `gateway ready` 和一条 `/bind` 口令。`4914` 表示这个机器人只能走沙箱：打开沙箱后重启。

## 3. 绑定

Setup 面板显示 6 位口令和一张 `/bind 123456` 的二维码。口令大约 60 秒失效，且只能用一次。在用扫码聊天打开的私聊里发送它。

## 4. 使用

- 其他文本会输入到当前 Cursor 输入框。回复会写上窗口名，例如 `已发送到：my-app`。
- `/status` 和 `/mode` 作为对那条消息的回复发出。状态是中文。有待审批时，`/status` 会列出 `/do <id>`。如果被动回复窗口已经关掉，它会说明按钮没推送；再发任意文字，按钮会挂到这条消息上。
- `/windows`、`/tabs`、`/model` 列出选项。`/window`、`/tab`、`/model` 加上序号或名称即可切换。按钮最多五个；键盘被丢掉时，正文里仍有 `/do <id>`。
- `/unbind` 解除这个账号，直到下次重启。Setup 面板上的移除按钮做同一件事。写在 `QQ_ALLOWED_USERS` 里的 openid 会在中继启动时重新加入。
- 审批、问卷和计划的按钮挂在你最近一条消息上，且必须还在 QQ 的被动回复窗口内（大约 4 分钟）。每个按钮也会印成 `/do <id>`。如果窗口已经关掉，`/status` 会列出同样的 `/do`；再发任意文字，按钮会挂到这条消息上。
- 点按钮会立刻向 QQ 回执，然后再执行点击。执行结果会带上窗口名。

QQ 限制机器人主动发言的频率。这条通道不会像飞书那样镜像完整对话。需要最新快照时发送 `/status`。

## 限制

- 仅私聊。跟随中继当前的 Cursor 窗口。
- 每个机器人一条网关连接。
- IP 白名单和沙箱 / 审核规则由 QQ 执行，不是 CursorRemote。
