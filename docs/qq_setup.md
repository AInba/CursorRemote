# QQ official bot setup

[中文](zh/qq_setup.md)

CursorRemote can control the current Cursor window from a QQ private chat. The relay opens an outbound WebSocket to QQ. You do not need a public webhook. Messages still pass through QQ's servers.

This uses the official bot API only.

## 1. Create the bot

1. Open the [QQ bot console](https://q.qq.com/qqbot/) and create a bot. A personal bot can be limited to specific users and groups.
2. Copy the App ID and App Secret.
3. Event subscription: choose **WebSocket**, not Webhook.
4. If the console shows an IP allowlist, add this machine's public egress IP. Home NAT addresses change; when they do, the gateway returns an IP error until you update the list. Sandbox mode is looser.
5. Before the bot is approved, turn on **Sandbox** and add your QQ account as a sandbox user. Use the console's **扫码聊天** code to open the chat.

## 2. Credentials

CursorRemote Setup → **QQ**:

- App ID
- App Secret (stored in VS Code SecretStorage)
- Sandbox checkbox

Or `.env`:

```bash
QQ_ENABLED=true
QQ_APP_ID=
QQ_APP_SECRET=
QQ_SANDBOX=true
```

Restart the relay. Logs should show `gateway ready` and a `/bind` code. `4914` means the bot is sandbox-only: enable sandbox and restart.

## 3. Bind

The Setup panel shows a 6-digit code and a QR of `/bind 123456`. The code expires in about 60 seconds and works once. Send it in the private chat you opened with 扫码聊天.

## 4. Use

- Other text is typed into the current Cursor composer. The reply names that window, for example `已发送到：my-app`.
- `/status` and `/mode` reply on that message. Status uses Chinese labels. When an approval is waiting, `/status` lists `/do <id>` commands. If the passive-reply window had already closed, it says the buttons were not pushed; send any text and they attach to that message.
- `/windows`, `/tabs`, and `/model` list the choices. `/window`, `/tab`, and `/model` plus a number or name switch. Buttons cover the first five; the text includes `/do <id>` when the keyboard is dropped.
- `/unbind` removes this account until the next restart. The Setup panel has a Remove button for the same action. Ids in `QQ_ALLOWED_USERS` are added again when the relay starts.
- Approval, questionnaire, and plan buttons are sent as a keyboard on your latest message when one is still inside QQ's passive-reply window (about 4 minutes). Each button also prints `/do <id>`. If that window had already closed, `/status` lists the same `/do` commands; send any text and the keyboard attaches to that message.
- Tapping a button acknowledges QQ immediately, then runs the click. The result names the window.

QQ limits how often a bot may speak first. This transport does not mirror the full transcript the way Feishu does. Send `/status` when you want a fresh snapshot.

## Limits

- Private chat only. It follows the relay's active Cursor window.
- One gateway connection per bot.
- IP allowlist and sandbox/review rules are enforced by QQ, not by CursorRemote.
