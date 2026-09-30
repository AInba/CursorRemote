# QQ official bot

[中文](zh/qq-backlog.md)

The transport is implemented. Setup steps are in [qq_setup.md](qq_setup.md).

These platform limits still apply and are why QQ does not mirror the full agent transcript the way Feishu does:

1. **IP allowlist.** Official bots may only call the gateway and OpenAPI from listed public egress IPs. A home NAT address can change. Sandbox mode is less strict and is the right setting until the bot is approved.
2. **Reply quotas.** A private-chat reply has to ride the user's latest message (`msg_id`) and that window is short. Proactive pushes are capped. CursorRemote therefore sends approvals only when that window is still open, and asks you to send `/status` for a snapshot.
3. **Review / sandbox.** Before release the bot only talks to sandbox users. Use the console's 扫码聊天 code, then `/bind` from the Setup panel.

Unofficial protocols (go-cqhttp, NapCat, Lagrange) are not used.

- https://bot.qq.com/wiki/bot_new_product-intro/
- https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html
