# Product plan

[中文](zh/product-plan.md)

Work that makes CursorRemote easier to set up and safer to leave running. Order is the order a user hits the gaps. Each finished item updates this file and the matching Chinese page.

## Done in this pass

- When Feishu rate-limits an edit, the previous message stays and the status line says the agent has not stopped. A limited edit is not replaced with a new copy.
- The web client explains notification permission and asks from a button. Home-screen install is offered after that. Alerts still need the page to stay open, and neither works on a plain HTTP LAN address.
- A Telegram topic for a tab that is not in front says it is not live, and updates when that tab is opened. Other open windows already refresh their current tab in the background. Hidden tabs are not clicked, because that would change the chat in Cursor.
- The Setup panel warns when LAN (`0.0.0.0`) is selected and the web password is empty, because anyone on the network can then control Cursor.
- The web client says to bring Cursor to the foreground whenever extraction is stale. An empty code block says it fills in after Cursor paints the lines.
- The Setup panel lists each bound Feishu or QQ account with a Remove button. A running relay drops that account immediately. If the relay is down, the local record is deleted for the next start. Allow-list ids return on the next process start, and the panel says so.
- QQ questionnaire choices and plan actions use the same passive-reply keyboard and `/do` fallback as approvals.
- Feishu `/history` reads earlier messages from the current window (default 30, up to 80). The live mirror still sends only the recent tail.
- Feishu and QQ private chats can list and switch Cursor windows, chat tabs, and models with `/windows`, `/tabs`, and `/model` (or a number or name). Later messages follow the window you picked.
- The getting-started walkthrough has optional Feishu and QQ steps. Each completes when that bot's App ID setting changes.
- The Setup panel follows the editor language. A Chinese editor uses Chinese labels and links Feishu, QQ, and the install notes to `docs/zh/`.
- The Setup panel probes Cursor's debug port (`/json` on the CDP URL). If it is closed, the Networking tab and a warning say to fully quit Cursor and start it with `--remote-debugging-port=9222`.
- Feishu and QQ tabs show whether the long connection or gateway is actually up, including a missing secret, QQ `4914`, and an IP allowlist rejection. Saved credentials alone no longer look like a finished connection.
- Send and card results name the Cursor window (`已发送到：项目名`).
- `/status` uses Chinese agent labels (空闲, 等待审批, …) and lists pending approvals.
- `/unbind` in Feishu and QQ private chats. Users listed in `FEISHU_ALLOWED_USERS` or `QQ_ALLOWED_USERS` return on the next process start.
- `/bind` in a Feishu group does not register the user and does not use up the code.
- QQ `/status` prints `/do <id>` when an approval is waiting. If the 4-minute passive window had closed, the next message from that user can carry the keyboard.
- Feishu text past the size limit says it was truncated.
- Setup panel: Feishu “start the relay before saving the long connection”, QQ sandbox / `4914`, a one-second bind countdown, and copy confirmation. Enabling either bot says chat content leaves the machine.

## Next

The first usable release list is done.

Later, and not required for the first usable release: auto-approve rules, copy-code button, marketplace listing, Chinese Telegram topic docs, per-user web logins.
