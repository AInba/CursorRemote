const DOCS = 'https://github.com/len5ky/CursorRemote/blob/main/docs';

export interface SetupCopy {
  htmlLang: string;
  title: string;
  subtitle: string;
  tabNetworking: string;
  tabTelegram: string;
  tabFeishu: string;
  tabQq: string;
  cdpHeading: string;
  cdpChecking: string;
  bindHeading: string;
  bindIntro: string;
  localhostTitle: string;
  localhostHint: string;
  lanTitle: string;
  lanHint: string;
  customTitle: string;
  customBeforeLink: string;
  customAfterLink: string;
  tailscaleName: string;
  customPlaceholder: string;
  saveRestart: string;
  tailscaleBefore: string;
  tailscaleLink: string;
  tailscaleAfter: string;
  networkingGuideUrl: string;
  passwordHeading: string;
  passwordIntro: string;
  passwordPlaceholder: string;
  copy: string;
  save: string;
  openBefore: string;
  tgStep1: string;
  tgStep2: string;
  tgStep3: string;
  tgStep4: string;
  done: string;
  pending: string;
  saved: string;
  bound: string;
  tgCreateBefore: string;
  tgCreateAfter: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  saveToken: string;
  tgGroupIntro: string;
  tgGroupTopics: string;
  tgGroupAdmin: string;
  tgRegistered: string;
  tgRegisterOther: string;
  tgRegisterFirst: string;
  tgNoToken: string;
  tgSync: string;
  engineHeading: string;
  engineIntro: string;
  grammyTitle: string;
  grammyHint: string;
  rawTitle: string;
  rawHintBefore: string;
  rawHintAfter: string;
  troubleBefore: string;
  troubleRaw: string;
  troubleAfter: string;
  troubleLink: string;
  telegramGuideUrl: string;
  feishuStep1: string;
  feishuIntro: string;
  feishuAppId: string;
  feishuSecretNew: string;
  feishuSecretSaved: string;
  feishuGuideUrl: string;
  feishuChecking: string;
  feishuStep2: string;
  feishuBindIntro: string;
  feishuBindNote: string;
  feishuBound: string;
  feishuNone: string;
  waitingCode: string;
  openBot: string;
  bindCommand: string;
  qqStep1: string;
  qqIntroBefore: string;
  qqPlatform: string;
  qqIntroAfter: string;
  qqGuideUrl: string;
  qqNote: string;
  qqAppId: string;
  qqSandbox: string;
  qqChecking: string;
  qqStep2: string;
  qqBindIntro: string;
  qqBound: string;
  qqNone: string;
  footerBefore: string;
  copyFilter: string;
  copied: string;
  expiryLeft: string;
  expiryGone: string;
  boundPrefix: string;
  removeUser: string;
  userRemoved: string;
  userRemovedAllowlist: string;
  userRemovedOffline: string;
  userRemoveRefused: string;
  userMissing: string;
  lanOpenWarning: string;
}

/** True when the relay listens on every interface and the web password is empty. */
export function lanNeedsPassword(host: string, password: string): boolean {
  return host.trim() === '0.0.0.0' && password.trim() === '';
}

export function setupCopy(zh: boolean): SetupCopy {
  if (zh) {
    return {
      htmlLang: 'zh-CN',
      title: 'CursorRemote 设置',
      subtitle: '配置网络、Telegram、飞书或 QQ。消息经过对应的聊天平台，这台机器不需要公网回调地址。',
      tabNetworking: '网络',
      tabTelegram: 'Telegram',
      tabFeishu: '飞书',
      tabQq: 'QQ',
      cdpHeading: 'Cursor 调试端口',
      cdpChecking: '正在检查调试端口…',
      bindHeading: '服务绑定地址',
      bindIntro: '选择服务暴露方式，以便另一台设备上的浏览器连进来。',
      localhostTitle: '仅本机（不能远程访问）',
      localhostHint: '绑定 127.0.0.1，只有这台机器上的浏览器能打开。',
      lanTitle: '局域网（所有网卡）',
      lanHint: '绑定 0.0.0.0，同一局域网里的浏览器都能打开。需要设置密码。',
      customTitle: '指定地址（Tailscale / 自定义）',
      customBeforeLink: '绑定某一个 IP，适合 ',
      customAfterLink: ' 或某一块网卡。',
      tailscaleName: 'Tailscale',
      customPlaceholder: '例如 100.64.0.1',
      saveRestart: '保存并重启',
      tailscaleBefore: '使用 Tailscale？详见',
      tailscaleLink: '安装说明',
      tailscaleAfter: '。',
      networkingGuideUrl: `${DOCS}/zh/setup-guide.md`,
      passwordHeading: '网页客户端密码',
      passwordIntro: '从另一台设备的浏览器连接时，输入这个密码。',
      passwordPlaceholder: '输入密码',
      copy: '复制',
      save: '保存',
      openBefore: '在任意浏览器打开',
      tgStep1: '创建 Telegram 机器人',
      tgStep2: '创建超级群',
      tgStep3: '注册',
      tgStep4: '同步',
      done: '完成',
      pending: '待完成',
      saved: '已保存',
      bound: '已绑定',
      tgCreateBefore: '在 Telegram 打开 ',
      tgCreateAfter: '，用 /newbot 新建机器人，把 token 贴到下面。',
      tokenLabel: 'Token',
      tokenPlaceholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      saveToken: '保存 Token',
      tgGroupIntro: '新建一个 Telegram 群，然后：',
      tgGroupTopics: '打开群设置，启用话题（Topics）',
      tgGroupAdmin: '把机器人加为管理员，并授予「管理话题」权限',
      tgRegistered: '已注册用户',
      tgRegisterOther: '要换成别的用户，在 Telegram 群里发送：',
      tgRegisterFirst: '在 Telegram 群里发送这条命令完成注册：',
      tgNoToken: '启动服务后才会生成注册口令。',
      tgSync: '注册成功后，在群里发送 /sync，为每个 Cursor 窗口创建话题。到这里就配好了。',
      engineHeading: '传输引擎',
      engineIntro: '选择用哪个 HTTP 客户端访问 Telegram Bot API。',
      grammyTitle: 'Grammy（默认）',
      grammyHint: '功能完整，带自动重试和限流处理。大多数情况用这个。',
      rawTitle: 'Raw（轻量备用）',
      rawHintBefore: '直接用 Node.js 自带的 fetch。如果启动时卡在',
      rawHintAfter: '，改用这个。',
      troubleBefore: '排查：日志里一直没有 “Bot connected” 时，改成',
      troubleRaw: 'Raw',
      troubleAfter: '。这会绕过 Grammy 的 HTTP 层（在部分系统上会卡住，macOS 上见过）。更多说明见',
      troubleLink: '中文安装说明里的 Telegram 一节',
      telegramGuideUrl: `${DOCS}/zh/setup-guide.md`,
      feishuStep1: '飞书自建应用',
      feishuIntro: '创建企业自建应用并启用机器人，用长连接订阅 im.message.receive_v1 和 card.action.trigger（不需要公网地址）。先保存凭证并重启。本页显示长连接已就绪后，再回飞书控制台保存「使用长连接接收事件」。聊天内容会经过飞书。见',
      feishuAppId: 'App ID（cli_xxx）',
      feishuSecretNew: 'App Secret',
      feishuSecretSaved: 'App Secret 已保存 — 粘贴新值可替换',
      feishuGuideUrl: `${DOCS}/zh/feishu_setup.md`,
      feishuChecking: '正在检查飞书连接…',
      feishuStep2: '扫码绑定',
      feishuBindIntro: '用飞书扫左边的码打开机器人，再发送 6 位命令（大约每 60 秒更换）。右边的码是 /bind 文本，方便从扫码结果复制。',
      feishuBindNote: '请在私聊里发送。群聊不能控制 Cursor，也不会消耗绑定码。也可以在下面移除，或发送 /unbind。',
      feishuBound: '已绑定',
      feishuNone: '还没有绑定飞书用户。',
      waitingCode: '启动服务后才会生成绑定码',
      openBot: '打开机器人',
      bindCommand: '绑定命令',
      qqStep1: 'QQ 官方机器人',
      qqIntroBefore: '在',
      qqPlatform: 'QQ 开放平台',
      qqIntroAfter: '创建机器人，选择 WebSocket（不要选 webhook）。控制台要求 IP 白名单时，把这台机器的公网出口 IP 加进去。见',
      qqGuideUrl: `${DOCS}/zh/qq_setup.md`,
      qqNote: '未过审时勾选 Sandbox，用控制台「扫码聊天」打开机器人，再发送下面的绑定码。网关关闭码 4914 表示仍只能走沙箱。聊天内容会经过 QQ。',
      qqAppId: 'App ID',
      qqSandbox: 'Sandbox（未过审前必须打开）',
      qqChecking: '正在检查 QQ 连接…',
      qqStep2: '扫码绑定',
      qqBindIntro: '在 QQ 机器人控制台用「扫码聊天」打开机器人，再发送这 6 位命令。大约每 60 秒更换，只用一次。',
      qqBound: '已绑定',
      qqNone: '还没有绑定 QQ 用户。',
      footerBefore: '全部设置：按 Ctrl+,（macOS 为 Cmd+,），搜索',
      copyFilter: '复制筛选',
      copied: '已复制',
      expiryLeft: '绑定码剩余 {n} 秒。过期后自动更换，只用一次。',
      expiryGone: '绑定码已过期，等待新码…',
      boundPrefix: '已绑定：',
      removeUser: '移除',
      userRemoved: '已移除。这个账号不能再控制 Cursor。',
      userRemovedAllowlist: '已移除。它写在允许名单里，中继下次启动会重新加入。',
      userRemovedOffline: '中继没在运行，已从本机记录删除。下次启动后生效。允许名单里的账号仍会重新加入。',
      userRemoveRefused: '中继拒绝了这次移除，内存里的授权还在。没有改本机记录。',
      userMissing: '没有找到这个账号。',
      lanOpenWarning: '局域网已开放，但网页密码是空的。同一网络上的任何人都能控制 Cursor。请设置密码，或改回仅本机。',
    };
  }

  return {
    htmlLang: 'en',
    title: 'CursorRemote Setup',
    subtitle: 'Configure networking, Telegram, Feishu, or QQ. Messages go through the chat platform; this machine does not need a public webhook.',
    tabNetworking: 'Networking',
    tabTelegram: 'Telegram',
    tabFeishu: 'Feishu',
    tabQq: 'QQ',
    cdpHeading: 'Cursor debug port',
    cdpChecking: 'Checking the debug port…',
    bindHeading: 'Server Bind Address',
    bindIntro: 'Choose how the server is exposed so you can connect from a browser on another device.',
    localhostTitle: 'Localhost only (no remote access)',
    localhostHint: 'Binds to 127.0.0.1 — only accessible from a browser on this machine.',
    lanTitle: 'LAN access (all interfaces)',
    lanHint: 'Binds to 0.0.0.0 — accessible from any browser on your local network. Password required.',
    customTitle: 'Specific address (Tailscale / custom)',
    customBeforeLink: 'Bind to a specific IP — useful for ',
    customAfterLink: ' or a particular network interface.',
    tailscaleName: 'Tailscale',
    customPlaceholder: 'e.g. 100.64.0.1',
    saveRestart: 'Save & Restart',
    tailscaleBefore: 'Using Tailscale? See the ',
    tailscaleLink: 'setup guide',
    tailscaleAfter: ' for details.',
    networkingGuideUrl: 'https://github.com/len5ky/CursorRemote/blob/main/docs/tailscale-setup.md',
    passwordHeading: 'Web Client Password',
    passwordIntro: 'Enter this password in your browser when connecting from another device.',
    passwordPlaceholder: 'Enter a password',
    copy: 'Copy',
    save: 'Save',
    openBefore: 'Open',
    tgStep1: 'Create a Telegram Bot',
    tgStep2: 'Create a Supergroup',
    tgStep3: 'Register',
    tgStep4: 'Sync',
    done: 'Done',
    pending: 'Pending',
    saved: 'Saved',
    bound: 'Bound',
    tgCreateBefore: 'Open ',
    tgCreateAfter: ' in Telegram and create a new bot with /newbot. Paste the token below.',
    tokenLabel: 'Token',
    tokenPlaceholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    saveToken: 'Save Token',
    tgGroupIntro: 'Create a new Telegram group, then:',
    tgGroupTopics: 'Open group settings and enable Topics',
    tgGroupAdmin: 'Add your bot as an administrator with "Manage topics" permission',
    tgRegistered: 'Registered user(s)',
    tgRegisterOther: 'To register a different user, send this in your Telegram group:',
    tgRegisterFirst: 'Send this command in your Telegram group to register:',
    tgNoToken: 'Start the server to generate a registration token.',
    tgSync: "After registration succeeds, send /sync in the group to create Cursor window topics. You're all set!",
    engineHeading: 'Transport Engine',
    engineIntro: 'Choose which HTTP client talks to the Telegram Bot API.',
    grammyTitle: 'Grammy (default)',
    grammyHint: 'Full-featured bot framework with auto-retry and rate-limit handling. Works for most users.',
    rawTitle: 'Raw (lightweight fallback)',
    rawHintBefore: "Uses Node.js native fetch directly. Try this if the bot hangs on startup with the error ",
    rawHintAfter: '.',
    troubleBefore: 'Troubleshooting: If your bot never reaches "Bot connected" in the logs, switch to ',
    troubleRaw: 'Raw',
    troubleAfter: ". This bypasses Grammy's HTTP layer, which can hang on some systems (observed on macOS). See the ",
    troubleLink: 'full troubleshooting guide',
    telegramGuideUrl: 'https://github.com/len5ky/CursorRemote/blob/main/docs/telegram-troubleshooting.md',
    feishuStep1: 'Feishu self-built app',
    feishuIntro: 'Create an enterprise self-built app, enable the bot, and subscribe to im.message.receive_v1 plus the card.action.trigger callback over the long connection (no public URL). Save the credentials and restart first. When this page says the long connection is ready, save 使用长连接接收事件 in the Feishu console. Chat content goes through Feishu. See the ',
    feishuAppId: 'App ID (cli_xxx)',
    feishuSecretNew: 'App Secret',
    feishuSecretSaved: 'App Secret saved — paste to replace',
    feishuGuideUrl: `${DOCS}/feishu_setup.md`,
    feishuChecking: 'Checking the Feishu connection…',
    feishuStep2: 'Scan to bind',
    feishuBindIntro: 'Scan the left code in Feishu to open the bot. Then send the 6-digit command (it rotates about every 60 seconds). The right code is the text /bind … if you want to copy it from a scanner.',
    feishuBindNote: 'Send it in a private chat. A group chat cannot control Cursor and does not use up the code. Remove the account below, or send /unbind.',
    feishuBound: 'Bound',
    feishuNone: 'No Feishu user bound yet.',
    waitingCode: 'Start the server to generate a code',
    openBot: 'Open bot',
    bindCommand: 'Bind command',
    qqStep1: 'QQ official bot',
    qqIntroBefore: 'Create a bot on the ',
    qqPlatform: 'QQ open platform',
    qqIntroAfter: ", choose WebSocket (not webhook), and add this machine's public IP to the allowlist if the console requires one. See the ",
    qqGuideUrl: `${DOCS}/qq_setup.md`,
    qqNote: 'Until the bot is approved, turn on Sandbox, open it with the console 扫码聊天 code, then send the bind command below. Gateway close code 4914 means the bot is still sandbox-only. Chat content goes through QQ.',
    qqAppId: 'App ID',
    qqSandbox: 'Sandbox (required until the bot is approved)',
    qqChecking: 'Checking the QQ connection…',
    qqStep2: 'Scan to bind',
    qqBindIntro: 'In the QQ bot console, use 扫码聊天 to open the bot. Then send the 6-digit command. It rotates about every 60 seconds and works once.',
    qqBound: 'Bound',
    qqNone: 'No QQ user bound yet.',
    footerBefore: 'For all settings, press Ctrl+, (or Cmd+,) and search ',
    copyFilter: 'Copy filter',
    copied: 'Copied',
    expiryLeft: 'Bind code expires in {n}s. It rotates and works once.',
    expiryGone: 'Bind code expired, waiting for a new one…',
    boundPrefix: 'Bound: ',
    removeUser: 'Remove',
    userRemoved: 'Removed. This account can no longer control Cursor.',
    userRemovedAllowlist: 'Removed. This id is on the allow list and returns the next time the relay starts.',
    userRemovedOffline: 'The relay is not running, so the local record was deleted. It takes effect on the next start. Allow-list ids still return.',
    userRemoveRefused: 'The relay refused this removal, so the in-memory grant is unchanged. The local record was left as it is.',
    userMissing: 'That account was not found.',
    lanOpenWarning: 'LAN is open and the web password is empty. Anyone on this network can control Cursor. Set a password, or switch back to this computer only.',
  };
}
