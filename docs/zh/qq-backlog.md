# QQ 官方机器人

[English](../qq-backlog.md)

传输层已经实现。安装步骤见 [qq_setup.md](qq_setup.md)。

下面这些平台限制仍然有效，也是 QQ 不像飞书那样镜像完整代理对话的原因：

1. **IP 白名单。** 官方机器人只能从名单里的公网出口 IP 调用网关和 OpenAPI。家庭 NAT 地址会变。沙箱更宽松，审核通过之前应使用沙箱。
2. **回复配额。** 私聊回复必须带上用户最近一条消息的 `msg_id`，这个窗口很短。主动推送有上限。因此 CursorRemote 只在窗口仍然开着时发送审批，并请你发送 `/status` 获取快照。
3. **审核 / 沙箱。** 发布之前，机器人只能和沙箱用户说话。先用控制台的扫码聊天，再发送 Setup 面板上的 `/bind`。

不使用非官方协议（go-cqhttp、NapCat、Lagrange）。

- https://bot.qq.com/wiki/bot_new_product-intro/
- https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html
