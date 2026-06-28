# 项目记忆

本文件是给 Claude/Codex 等编码助手的短项目记忆。依据 Anthropic 对 `CLAUDE.md`/项目记忆的建议，这里只放每次进入项目都需要的稳定事实，详细内容通过链接跳转。

## 先读顺序

1. [PROJECT.md](PROJECT.md)
2. [新对话轻量接力提示词](docs/context/new-chat-prompt.md)
3. [当前窗口上下文](docs/context/current-session.md)
4. [长期上下文](docs/context/long-term-context.md)
5. [文档地图](docs/README.md)

## 项目一句话

这是一个 AI 生视频产品 MVP：用户端支持登录注册、文/图生视频、视频生视频、项目视频管理、购买积分和兑换积分；管理后台支持模型、套餐、用户、兑换码、视频记录、操作审计和系统设置管理。

## 当前技术事实

- 前端：根目录静态页面 `index.html`、`auth.html`、`admin.html`。
- 后端：`backend/`，Fastify + TypeScript，当前默认通过 `PrismaBackedStore` 使用 PostgreSQL/Prisma 持久化；未配置 `DATABASE_URL` 时才回退内存仓储。
- 视频任务：`VIDEO_PROVIDER_REAL_JOBS=true` 时用户点击生成会真实提交供应商 `POST /v1/videos`；关闭该开关时可回到 `MockVideoProvider` 成功/失败状态流转。真实供应商状态同步已迁移到 Redis/BullMQ 后台同步，成功内容会下载到本地存储并按 3 天清理。
- 本地默认地址：用户端静态服务 `http://127.0.0.1:8765`，API `http://127.0.0.1:4000`。
- 本地数据库：Docker Desktop 已安装；`backend-postgres-1` 映射 `5432`，`backend-redis-1` 映射 `6379`；`backend/.env` 的 `DATABASE_URL` 使用 `127.0.0.1:5432`。
- 模型 URL、模型 Key、第三方请求配置只能存在后端或数据库加密字段，不能放到前端。
- 供应商参考素材公网访问地址可在管理后台“系统设置”里配置“公网 API 地址”；生成任务优先使用数据库配置，其次才回退 `PUBLIC_API_BASE_URL` 环境变量或请求域名推断。该地址必须是供应商可访问且 HTTPS 证书有效的公网地址。
- 兑换码：管理员后台批量生成，默认 18 位大小写字母+数字，支持永久有效或自定义有效天数；管理员复制历史兑换码时复制明文完整码。
- 用户生成视频和管理员可见视频记录只保留 3 天。
- 视频任务队列和项目视频已解耦：生成任务记录不可删除；项目页删除视频只删除视频资产记录，不影响任务记录。
- 已在明确批准下执行过 1 次真实 `POST /v1/videos` 小流量联调，供应商返回 `insufficient_user_quota`；之后用户已充值并明确要求后续点击生成视频持续真实发起请求，不再每次单独批准。后续用户反馈真实生成已经能成功生成视频。
- 视频生成页右侧预览区已有空状态、生成中状态、1.5 秒轮询、完成后自动显示视频和居中“视频已生成”提示；任务队列最多展示 10 条并在固定高度滚动，底边与“生成参数”卡片底边对齐。
- 用户端参考素材限制：图片最多 4 张并显示缩略图列表，视频最多 3 个，音频最多 1 个；后端 `/api/video/jobs` 同步校验。真实供应商路径会先把 data URL 参考素材保存为本地 reference asset，再提交公网 URL 到供应商 `images`、`videos`、`audios`。
- 管理后台所有系统提示使用居中弹窗；切换模型配置、积分套餐、用户管理、生成记录、操作审计等页签不弹提示。
- 用户端已有独立“生成记录”页，只展示生成/完成时间、扣除积分和状态等轻量流水，不展示视频地址或下载链接。
- 管理后台用户列表不显示管理员账号；模型删除会隐藏配置，若已有历史生成记录则软删除并保留记录。
- 前端 `apiFetch` 只有在请求有 body 时才自动加 `Content-Type: application/json`，空 body 的 `DELETE` 不应带 JSON content-type。
- 本地测试管理员：`admin-code-1782584735007@example.com` / `password123`。

## 工作规则

- 新任务开始前先读 `docs/context/current-session.md`，确认“做到哪里”和“下一步”。
- 新开对话优先把 `docs/context/new-chat-prompt.md` 里的提示词贴给助手，减少重复上下文。
- 完成的短期事项用删除线标记，稳定事实再沉淀到 `docs/context/long-term-context.md`。
- 不把上下文文档写成日志；只保留决策、状态、阻塞点和下一步。
