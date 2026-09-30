# Feishu setup

[中文](zh/feishu_setup.md)

CursorRemote can mirror the agent into a Feishu bot. The relay opens an outbound WebSocket to Feishu (long connection). You do not need a public IP, domain, or ngrok. Chat traffic still passes through Feishu's cloud — this is not a LAN-only link.

Phase 1 controls the **current Cursor window from a private chat**. Group topic routing is not implemented.

## 1. Create a self-built app

1. Open the [Feishu Open Platform](https://open.feishu.cn/app) and create an enterprise **self-built** app. Store apps cannot use the long-connection mode.
2. Enable **Bot** capability.
3. Permissions (tenant / app identity), at least:
   - `im:message`
   - `im:message:send_as_bot`
   - `im:message.group_at_msg` and `im:message.p2p_msg` (receive)
   - `im:resource` if you later add images
4. Events: subscribe to **接收消息** `im.message.receive_v1`.
5. Callbacks: subscribe to **卡片回传交互** `card.action.trigger`.
6. Set both the event subscription and the callback subscription to **使用长连接接收事件**. The save button only succeeds while a long connection from this app is already online, so do this after the relay has started once with the app credentials (step 3). Publish a version of the app.

## 2. Credentials

In Cursor: **CursorRemote: Open Setup Panel** → **Feishu**.

- App ID (`cli_xxx`)
- App Secret (stored in VS Code SecretStorage, not in settings)

Or standalone `.env`:

```bash
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=your-secret
```

Restart the relay after saving. Logs should show `Long connection ready` and a `/bind` code.

Optional: `FEISHU_ALLOWED_USERS=ou_xxx` (or `cursorRemote.feishu.allowedUsers`) skips the bind code for those open_ids.

## 3. Scan and bind

The Setup panel shows two codes, refreshed about every 60 seconds:

| Code | What to do |
|------|------------|
| Open bot | Scan in Feishu to open the bot chat (`applink.feishu.cn`) |
| Bind command | The text `/bind 123456`. Send that exact command to the bot |

The code is single-use and expires in 60 seconds. If it fails, copy the new command from the panel.

After a successful bind, that Feishu user is written to `feishu-auth.json` in the data directory. Private chats are remembered in `feishu-sessions.json` and follow the relay's **active** Cursor window.

## 4. Use

In the private chat:

- Any non-command text is typed into the current Cursor composer and submitted. The reply names that window, for example `已发送到：my-app`.
- `/status` — agent status in Chinese (空闲, 等待审批, …), mode, model, and any pending approvals
- `/history` — older messages from the current window. The live chat only mirrors the latest dozen or so. `/history` defaults to 30 and accepts a count up to 80 (`/history 50`). If the page does not already contain that many, Cursor scrolls up to load them, then scrolls back.
- `/windows` lists Cursor windows and marks the active one. `/window <number or name>` switches it, and later messages go there. The same card has a button per window.
- `/tabs` and `/tab <number or name>` switch the chat tab in the current window.
- `/model` reads the model menu (Cursor opens it briefly) and `/model <number or name>` selects one.
- `/mode` — mode buttons
- `/unbind` — remove this account. The Setup panel has a Remove button for the same action. Ids in `FEISHU_ALLOWED_USERS` are added again the next time the relay starts.
- Approval, Run / Skip / Allow, plan Build, and questionnaire choices arrive as cards. Taps are acknowledged immediately; the CDP click runs after the callback returns (Feishu requires a response within 3 seconds). The result names the window.
- Transcript text longer than about 3500 characters is cut, with a note that the rest is in Cursor or the web client.

Cursor must be running with `--remote-debugging-port=9222`.

## Limits

- One relay process per app. Feishu delivers each event to a single long connection.
- Streaming assistant text is edited in place and debounced. When Feishu rate-limits an edit, that message stays as it was and the status line says the agent has not stopped. The limited edit is not sent again as a new message.
- `/bind` in a group does not register you and does not use up the code. Control is private chat only.
