# 中文文档

仓库首页的中文版是 [README.zh-CN.md](../../README.zh-CN.md)。下面是这次飞书 / QQ 接入对应的中文说明。英文原文仍在 `docs/` 下，每篇顶部有链接。

| 中文 | 英文 | 内容 |
|---|---|---|
| [README.zh-CN.md](../../README.zh-CN.md) | [README.md](../../README.md) | 功能、安装、设置、隐私 |
| [setup-guide.md](setup-guide.md) | [setup-guide.md](../setup-guide.md) | 安装、网络、Telegram、飞书、QQ、排错 |
| [feishu_setup.md](feishu_setup.md) | [feishu_setup.md](../feishu_setup.md) | 飞书自建应用、长连接、`/bind` |
| [qq_setup.md](qq_setup.md) | [qq_setup.md](../qq_setup.md) | QQ 官方机器人、沙箱、IP 白名单、`/bind` |
| [qq-backlog.md](qq-backlog.md) | [qq-backlog.md](../qq-backlog.md) | QQ 平台限制 |
| [architecture.md](architecture.md) | [architecture.md](../architecture.md) | 组件、数据流、飞书 / QQ 传输层 |
| [prd.md](prd.md) | [prd.md](../prd.md) | 产品需求、状态模型、协议 |
| [extension_prd.md](extension_prd.md) | [extension_prd.md](../extension_prd.md) | 扩展设置、Setup 面板 |
| [smoke-checklist.md](smoke-checklist.md) | [smoke-checklist.md](../smoke-checklist.md) | 发布前手工检查 |
| [product-plan.md](product-plan.md) | [product-plan.md](../product-plan.md) | 易用性开发计划 |

更早的 Telegram 专题（`telegram_prd.md`、`telegram_architecture.md`）和历史变更记录仍只有英文。未发布的变更：

- 飞书长连接：自建应用从私聊控制当前 Cursor 窗口，Setup 面板提供 60 秒 `/bind` 口令，审批和计划用卡片。
- QQ 官方机器人：WebSocket 网关，同样的私聊和 `/bind`。审批按钮挂在最近一条消息上，不镜像完整对话。审核通过前用沙箱。

