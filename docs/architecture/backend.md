# 后端架构

## 当前实现

- 框架：Fastify + TypeScript。
- 测试：Vitest。
- 当前仓储：`PrismaBackedStore` 已接入 PostgreSQL/Prisma；生产环境必须配置 `DATABASE_URL`，否则后端拒绝启动。只有显式设置 `USE_IN_MEMORY_STORE=true` 时才使用会丢数据的 `InMemoryStore` 回退。
- 入口：`backend/src/server.ts` 和 `backend/src/app.ts`。

## 关键模块

- `auth.service.ts`：邮箱注册、登录、管理员初始化、密码哈希、JWT。
- `redemption.service.ts`：兑换码校验、兑换入账、防重复使用。
- `admin.service.ts`：模型、套餐、用户、兑换码、视频记录和系统设置管理。
- `video.service.ts`：生成任务创建、积分消耗、Mock 状态流转、真实供应商提交/状态同步、成功资产写入和失败退款。
- `mock-video-provider.ts`：本地 Mock 视频供应商，当前仍负责用户任务成功/失败流转。
- `openai-video-provider.ts`：OpenAI Video 兼容真实供应商适配器，已支持模型列表、视频提交、状态查询、内容下载和非 2xx 错误体解析；`VIDEO_PROVIDER_REAL_JOBS=true` 时用户创建任务会真实提交供应商。
- `video-status-sync.service.ts`：真实供应商任务后台状态同步；纯同步器扫描活跃 provider-backed 任务，BullMQ 调度器在 Redis 上注册重复扫描任务和单任务同步。
- `video-file-storage.ts`：本地视频文件存储、参考素材落盘、签名下载地址和过期文件清理。
- `server-config.ts`：后端启动环境变量校验，模型配置加密支持单 Key 兼容模式和版本化 keyring。
- `scripts/migrate-model-config-keys.ts`：模型配置 Key 旧密文迁移脚本，默认 dry-run，显式 `--apply` 才重加密到当前版本。
- `errors.ts`：后端统一错误响应映射，输出稳定 `code`、中文 `message`、`statusCode` 和兼容字段 `error`。
- `repositories/*`：内存仓储、Prisma 持久化适配器和仓储边界。
- 用户视频资产路由在 `app.ts` 中提供：`GET /api/video/assets` 列出当前用户未删除视频资产，`DELETE /api/video/assets/:id` 删除项目视频资产记录；生成任务删除路由返回 405 `VIDEO_JOB_DELETE_NOT_ALLOWED`，保证任务记录不可删。
- 用户轻量生成记录路由在 `app.ts` 中提供：`GET /api/video/job-records` 返回生成时间、模型展示名、供应商模型 ID、提示词、分辨率、画幅/尺寸、用户选择的视频时长、参考图片/视频/音频数量、扣除积分、状态和 `generationDurationSeconds`；不返回完成时间、视频地址、存储 key 或供应商 task id。
- 管理端视频记录路由同样使用 `toVideoJobRecord()` 映射展示字段；`generationDurationSeconds` 由 `completedAt - createdAt` 计算，单位为秒，未完成任务返回 `null`。
- 兑换码记录映射会返回 `validityDays`，表示兑换码被兑换后的有效时长，单位为天；永久有效或尚未兑换时返回 `null`。
- 管理端写操作审计在 HTTP 路由层记录，覆盖模型、套餐、兑换码批次、用户积分和封禁/解封；审计记录写入既有 `audit_logs` 表，并通过 `/api/admin/audit-logs` 供管理员查看。
- 管理端系统设置路由在 `app.ts` 中提供：`GET /api/admin/system-settings` 和 `PATCH /api/admin/system-settings`。当前保存公网 API 地址，用于真实供应商抓取参考素材；设置写入 `system_settings` 表并记录审计。

## 安全边界

- 模型 URL 和 Key 只允许后端读取。
- 模型配置加密主密钥可以来自兼容单 Key 环境变量 `MODEL_CONFIG_ENCRYPTION_KEY_BASE64`/`MODEL_CONFIG_ENCRYPTION_KEY_HEX`，也可以来自生产轮换用的 `MODEL_CONFIG_ENCRYPTION_KEYS` + `MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION`；每个 Key 必须解码为 32 字节。
- 新增或更新模型 Key 时写入当前 `keyVersion`；读取旧密文时按记录上的 `keyVersion` 选择解密 Key，缺失版本按 `1` 兼容旧数据。
- 默认真实供应商只通过后端环境变量 `VIDEO_PROVIDER_BASE_URL` 和 `VIDEO_PROVIDER_API_KEY` 配置，不进入前端。
- 供应商抓取参考素材使用的公网 API 地址优先来自管理后台系统设置，其次来自 `PUBLIC_API_BASE_URL` 环境变量，再尝试从请求域名推断；该地址不能是本机/内网地址，生产应使用证书有效的 HTTPS 域名。
- 真实生成提交需要后端显式设置 `VIDEO_PROVIDER_REAL_JOBS=true`；当前生产部署已上线并按该开关持续允许真实生成。历史一次真实联调返回 `insufficient_user_quota`，之后用户说明额度已充值并要求后续持续允许真实生成。
- 参考图片、参考视频和参考音频只能作为用户任务 payload 进入后端，再由后端提交供应商 `images`/`videos`/`audios` 字段；数量限制为图片最多 4 张、视频最多 3 个、音频最多 1 个；前端限制参考视频+参考音频原始文件总大小不超过 36MB，后端会拒绝超大的图片 data URL，前端不得接触供应商 Key。非 HTTP(S) data URL 会先保存成 reference asset，再通过公开的 `/api/video/reference-assets/:jobId/:filename` 路由供供应商拉取。
- 生产环境必须使用强 `JWT_SECRET` 和 `REDEMPTION_HASH_SECRET`。
- 管理员初始化密钥 `BOOTSTRAP_ADMIN_SECRET` 只用于创建首个管理员；数据库已有管理员后 bootstrap 会被拒绝，创建后应删除或轮换该密钥。
- 管理端用户列表过滤 `ADMIN` 账号，避免误操作管理员账号。
- 模型删除兼容历史记录：已被视频任务引用的模型只设置 `deletedAt` 并隐藏，未引用的模型可以物理删除。
- 审计 metadata 只保存脱敏操作摘要，不记录完整模型 Key、兑换码明文或兑换码哈希。
- CORS 允许 `GET,HEAD,POST,PATCH,DELETE`；前端空 body 的 DELETE 不应声明 JSON content-type。
- API 错误响应保持结构化：`error` 保留原始错误用于兼容，`code` 供前端稳定映射，`message` 面向用户展示，`details` 仅用于参数校验等可公开调试信息。
- 供应商错误详情可进入内部错误信息，但不得输出 API Key；适配器会解析常见 JSON/text 错误字段，方便定位真实供应商失败原因。
- 供应商抓取 reference asset 时的 TLS 证书错误会映射为 `PUBLIC_API_BASE_URL_CERT_INVALID`，提示更新公网 API 地址域名证书。

## 下一步

- 真实任务状态同步已接入 Redis/BullMQ 后台轮询，后续可在供应商支持时补 webhook 回调入口。
- 审计日志后续补筛选、分页、导出和保留策略。
- 后续可把当前 `PrismaBackedStore` 适配器逐步替换为各模块直接 Prisma repository。
