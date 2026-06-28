# 当前窗口上下文

更新时间：2026-06-29

## 接续摘要

- 本地前端静态服务：`http://127.0.0.1:8765`。
- 本地后端 API：`http://127.0.0.1:4000`。
- 本地测试管理员：`admin-code-1782584735007@example.com` / `password123`。
- `backend/.env` 已存在，`DATABASE_URL` 使用 `postgresql://postgres:postgres@127.0.0.1:5432/ai_video`。
- 后端应使用 PostgreSQL/Prisma 持久化，启动日志显示 `Using PostgreSQL/Prisma persistent store.`。
- 不要运行 `docker compose down -v`，否则会删除 PostgreSQL 数据卷。

## 本窗口已完成

- ~~完成基础 MVP：静态用户端/管理端、登录注册、JWT、积分、兑换码、管理员接口和视频任务基础接口。~~
- ~~完成 PostgreSQL/Prisma 持久化和本地 Docker PostgreSQL/Redis 运行环境。~~
- ~~完成兑换码升级：默认 18 位大小写字母+数字，支持永久有效或自定义有效天数。~~
- ~~完成用户端权限与隐私收口：普通用户不显示管理员入口，后台页验证管理员角色后展示，兑换码输入不默认显示邮箱。~~
- ~~完成用户端体验收口：移除左侧“任务队列”和“最近生成”，空队列显示“暂无视频队列”，左下角显示“可用积分”并同步进度条，去掉左侧菜单“系统”标题。~~
- ~~完成账号管理页白底卡片样式、退出登录、修改密码和 `/api/me/password` 接口。~~
- ~~完成第一批数据驱动闭环：用户端模型、套餐、视频任务队列和项目页从后端加载；生成任务、项目视频删除和 Mock 任务处理调用后端。~~
- ~~完成管理端数据驱动闭环：模型、套餐、用户和视频记录列表从后端加载；模型/套餐新增更新、套餐删除、用户封禁解封和积分调整接真实 API。~~
- ~~完成本地 Mock 视频任务闭环：`MockVideoProvider`、任务状态流转、成功写入 `OUTPUT_VIDEO` 资产、失败退款且幂等、`POST /api/video/jobs/:id/process` 路由、用户端生成后自动触发 mock 处理并轮询刷新。~~
- ~~完成前端回归测试补充，覆盖用户端移除项、管理员入口门禁、兑换码隐私、账号页样式、数据驱动接线和 Mock 任务处理接线。~~
- ~~完成管理后台交互收口：模型、积分套餐和兑换码操作台默认空；保存即新增或更新，保存后清空；套餐和模型删除/启用/禁用失败时显示明确提示。~~
- ~~完成管理端模型删除修复：未被任务引用的模型物理删除；已被历史生成记录引用的模型软删除并从管理端/前台模型列表隐藏，历史记录保留。~~
- ~~完成用户管理列表过滤：`/api/admin/users` 不返回管理员账号。~~
- ~~完成前端请求头修复：空 body 的 `DELETE` 不再发送 `Content-Type: application/json`，避免 Fastify 拒绝空 JSON body。~~
- ~~完成新对话轻量接力文档：`docs/context/new-chat-prompt.md`。~~
- ~~完成真实视频供应商只读连通检查：后端新增 OpenAI Video 兼容适配器和 `npm run provider:smoke`，供应商 `GET /v1/models` 已返回 `video-ds-2.0`、`video-ds-2.0-fast`。~~
- ~~完成模型 Key 稳定环境变量读取：`MODEL_CONFIG_ENCRYPTION_KEY_BASE64`/`MODEL_CONFIG_ENCRYPTION_KEY_HEX` 必须解码为 32 字节，后端启动不再为模型配置随机生成加密密钥。~~
- ~~完成管理后台模型名供应商读取：新增 `GET /api/admin/provider-models`，管理后台模型配置里的“模型名称”会从供应商 `GET /v1/models` 读取视频模型作为输入建议；如果读取失败，管理员仍可手动输入真实模型 ID。~~
- ~~完成前台模型展示名/供应商模型 ID 分离：用户端模型下拉只展示后台可编辑的 `displayName`，提交生成任务时仍发送供应商模型 ID `modelName`。~~
- ~~完成文档刷新：`PROJECT.md`、上下文文档、模块文档、架构文档、运行手册和后端 README 已对齐供应商只读连通、模型别名/模型 ID 分离、稳定加密 Key 和下一步真实任务接入。~~
- ~~完成真实视频任务提交/状态同步代码路径：启用 `VIDEO_PROVIDER_REAL_JOBS=true` 时用户创建任务会提交供应商 `POST /v1/videos`，同步路由调用 `GET /v1/videos/{id}`；成功写入输出资产，失败退款保持幂等；常规测试使用 mocked fetch。~~
- ~~完成真实视频内容下载/本地存储/签名下载/3 天清理：供应商成功后可下载 `/content` 写入后端本地目录，用户端下载按钮获取签名地址，过期资产会被清理并标记删除。~~
- ~~完成用户兑换记录：新增 `GET /api/credits/redemptions`，用户端兑换积分页展示脱敏兑换历史，成功兑换后自动刷新记录。~~
- ~~完成管理端操作审计：新增 `GET /api/admin/audit-logs` 和管理后台“操作审计”页签，覆盖模型、套餐、兑换码批量生成、用户积分调整和封禁/解封；审计 metadata 不保存完整模型 Key、兑换码明文或兑换码哈希。~~
- ~~完成更完整错误提示：后端统一结构化错误响应 `code/message/statusCode/error`，前端三页统一 `apiErrorMessage()` 映射登录、权限、封禁、积分、兑换码、模型/套餐/用户和供应商错误。~~
- ~~完成生产级模型 Key 轮换策略和旧密文迁移方案：后端支持 `MODEL_CONFIG_ENCRYPTION_KEYS` + `MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION` 版本化 keyring，兼容原单 Key 环境变量；模型配置新增/更新写当前 `keyVersion`，旧密文按记录版本解密，缺失版本按 1 兼容；`npm run model-keys:migrate` 默认 dry-run，`-- --apply` 才重加密旧密文。~~
- ~~完成真实视频状态后台同步：新增 `video-status-sync.service.ts`，`VIDEO_PROVIDER_REAL_JOBS=true` 且配置 `REDIS_URL` 时通过 Redis/BullMQ 注册后台扫描任务；前端定时轮询只刷新 `/api/video/jobs`，不再批量触发 `/sync`。~~
- ~~完成供应商错误详情解析：`openai-video-provider.ts` 会解析非 2xx 的 JSON/text 错误体，识别 `error.code/error.message`、`error_code/error_msg`、`code/message`、`error_message` 等字段，并避免输出 API Key 明文。~~
- ~~完成一次明确批准下的真实小流量联调：只提交 1 次真实 `POST /v1/videos`，供应商返回 `HTTP 403: insufficient_user_quota - 用户额度不足, 剩余额度: ＄35.000000, 最低保留额度: ＄9.000000`；任务 `ebe49af4-d88e-4150-8c2f-3c7e5053e430` 失败，无 provider task id，无资产。该历史错误之后，用户已充值并要求持续启用真实生成。~~
- ~~完成任务队列与项目视频解耦：任务队列只展示生成任务且不可删除；项目页通过 `/api/video/assets` 展示视频资产，删除项目视频时删除数据库中的资产记录，不影响任务记录；`DELETE /api/video/jobs/:id` 返回 405 `VIDEO_JOB_DELETE_NOT_ALLOWED`。~~
- ~~完成项目页真实播放体验：项目卡片“播放”会请求 `/api/video/assets/:id/download-url`，用签名地址加载本卡片内联播放器；下载使用 blob 方式触发文件下载，不再误进入播放。~~
- ~~完成生产真实生成放开：供应商额度已充值后，本地 `backend/.env` 已设置 `VIDEO_PROVIDER_REAL_JOBS=true`，二次真实提交开关已移除；后续点击生成视频会持续真实发起供应商请求，不再要求每次单独批准。~~
- ~~完成用户端生成体验收口：视频生成页右侧预览区无任务时为空状态，有活跃任务时显示“视频生成中...”，1.5 秒轮询检测完成后自动显示视频，并在全局页面居中提示“视频已生成”。~~
- ~~补齐点击生成后的即时反馈：基础校验通过后、请求 `/api/video/jobs` 前立即提示“正在提交生成任务，请稍候...”，避免真实供应商提交期间界面无响应。~~
- ~~完成视频生成页右侧按钮和写死文案清理：移除“最新已下载视频”、播放器说明、刷新/复制/下载工具按钮、写死视频标题和 3 天提示背景区域。~~
- ~~完成任务队列布局收口：最近任务最多展示 10 条，超出在固定高度内滚动；队列卡片底边按“生成参数”卡片底边对齐。~~
- ~~完成用户端生成记录页字段补齐：新增“生成记录”入口和 `/api/video/job-records` 接线，展示生成时间、模型名称、提示词、尺寸/分辨率、用户选择的视频时长、参考图片/视频/音频数量、扣除积分、状态和视频生成时长；不展示完成时间、视频地址或下载链接。~~
- ~~完成参考素材提交修复：用户上传参考图/参考视频/参考音频后，创建任务 payload 会带 `images`、`videos`、`audios`，供应商适配器按 OpenAI Video 风格提交给真实供应商。~~
- ~~完成积分套餐购买 URL 配置：管理后台套餐操作台新增“配置URL”，后端 `credit_packages.purchase_url` 持久化并校验仅允许 HTTP/HTTPS，用户端购买按钮按对应套餐 URL 跳转。~~
- ~~完成参考图片上传预览：用户上传参考图片后，上传框内显示已选图片缩略图列表和文件名，便于确认素材。~~
- ~~完成参考素材上传扩展：图片最多 4 张、视频最多 3 个、音频最多 1 个；参考视频+参考音频原始文件总大小限制为 36MB；创建任务 payload 分别提交 `images`、`videos`、`audios`；后端 `/api/video/jobs` 同步校验数量。~~
- ~~修复上传图片后点击生成报 `Failed to fetch`：根因是参考图片 base64 JSON 请求体超过 Fastify 默认约 1MB 限制；后端默认 body limit 调整为 64 MiB，并支持 `REQUEST_BODY_LIMIT_BYTES` 环境变量，超限时返回结构化 413。~~
- ~~修复多张原图参考素材触发供应商 `fail_to_fetch_task` 风险：前端会把参考图片压缩成长边 1280px 的 JPEG data URL；后端拒绝超大的图片 data URL；失败任务队列卡片展示失败原因摘要。~~
- ~~修复真实视频生成成功后持续刷新/只播放 2 秒又循环刷新：生成完成并拿到可播放结果后停止重复轮询；只在队列中/生成中状态继续轮询。~~
- ~~完成视频生成页控件收口：移除提示词下方“电影感、真实人像、产品展示、竖屏短视频”等快捷风格按钮；文生视频参考图/首帧与参考音频同一行，视频生视频参考视频与参考音频同一行；生成参数中移除“接口参数由后台统一配置”。~~
- ~~修复任务队列高度规则：文生视频任务队列底边按左侧“生成参数”面板底边对齐，不再向下超过左侧边框。~~
- ~~修复项目页默认封面顶住真实视频：移除写死占位封面，无视频资产时显示无视频空状态；有视频资产时直接使用真实内联播放器/下载/复制/删除操作。~~
- ~~完成管理后台兑换码管理升级：批量生成在上方，全部兑换码记录在下方，记录区固定高度分页切换；管理员可查看完整兑换码、批次、积分、状态、生成时间、有效期和兑换信息；表单区不再放“复制全部兑换码”；生成成功后弹出“本次生成兑换码”弹窗，弹窗内复制全部，格式为一行一个。~~
- ~~完成兑换码完整码持久化和管理员历史接口：新增 `GET /api/admin/redemption-codes`；Prisma 持久化使用现有 `code_ciphertext` 字段保存完整码并在重载时映射回 `plainCode`。~~
- ~~完成视频任务记录元数据补齐：持久化画幅/尺寸和参考图片/视频/音频数量；用户端和管理员端生成记录显示视频生成时长，按完成时间减去任务提交时间计算，单位秒。~~
- ~~完成兑换码有效期展示：用户兑换记录、管理员兑换码记录和用户端左下角可用积分区域展示兑换后的有效期/倒计时。~~
- ~~完成生成参数下拉框 UI 优化：模型、分辨率、画幅和时长下拉均使用 `.select-control` 自定义样式。~~
- ~~完成刷新后前端不可点击问题修复：`index.html` 先初始化 `redemptionRecords` 等状态变量，再调用 `updateUserUI(readStoredUser())`；`updateCreditValidity()` 默认值不再读取未初始化状态。~~
- ~~完成项目页视频封面优化：切换到项目页时会主动加载视频资产并 seek 首帧，减少黑色视频封面，播放仍在项目卡片内联进行。~~
- ~~完成管理员后台提示方式收口：系统提示统一居中弹窗；切换模型配置、积分套餐、用户管理、生成记录、操作审计等页签不弹提示。~~
- ~~完成兑换码管理最新收口：有效期改为“永久有效/自定义天数”，历史记录复制使用明文完整兑换码。~~
- ~~完成真实供应商参考素材提交修复：前端提交 data URL，后端保存 reference asset 并向供应商提交公网 URL，避免供应商接收 base64 data URL 后返回 `status_code=500, task_id is empty`。~~
- ~~完成管理员后台“系统设置”：新增公网 API 地址配置，优先用于供应商抓取参考素材；新增 Prisma `system_settings` 表和 `/api/admin/system-settings` 接口。部署或本地更新后需执行 `npm run prisma:deploy` 和 `npm run prisma:generate`。~~
- ~~完成供应商 TLS 证书错误友好提示：公网 API 地址证书过期/不可验证会映射为 `PUBLIC_API_BASE_URL_CERT_INVALID`。~~
- ~~完成公网生产部署：用户已确认系统部署成功并已上线。后续更新按 GitHub `main` 拉取并发布，不需要重新初始化管理员或重新配置已存在的生产数据库业务数据。~~
- ~~完成站点图标补丁并更新到生产服务器：新增根目录 `favicon.svg`，三个入口页统一引用 `/favicon.svg`，用户已确认补丁更新成功。~~

## 当前状态

- 前端仍是根目录静态 HTML/CSS/JS：`index.html`、`auth.html`、`admin.html`，并包含站点图标 `favicon.svg`。
- 后端位于 `backend/`，Fastify + TypeScript + Prisma + Vitest。
- 当前代码包含 6 个 Prisma migration；最新新增 `20260628214500_add_system_settings` 用于后台系统设置，部署时需要执行 `npm run prisma:deploy`，再执行或确保已执行 `npm run prisma:generate`。
- 当前本地 `backend/.env` 已设置 `VIDEO_PROVIDER_REAL_JOBS=true`；用户点击生成视频会走真实供应商 `POST /v1/videos`。未配置该开关时，代码仍可回到本地 Mock Provider。
- `backend/.env` 已配置 `VIDEO_PROVIDER_BASE_URL`、`VIDEO_PROVIDER_API_KEY` 和稳定模型配置加密密钥；供应商 Key 只在后端使用，不放前端。
- 真实视频文件默认存储在后端本地目录，可用 `VIDEO_STORAGE_DIR` 覆盖；签名下载地址由后端生成，文件和记录按 3 天保留策略清理。
- 真实供应商任务状态同步已接入 Redis/BullMQ 后台同步器；`POST /api/video/jobs/:id/sync` 保留为手动兜底，配置调度器时返回排队结果。
- 项目页当前从 `/api/video/assets` 读取当前用户视频资产；播放按钮在项目卡片内联播放且不弹提示，下载按钮直接下载文件；删除项目视频会删除该资产数据库记录和列表展示，但不删除对应 `video_jobs` 任务记录。生成任务队列没有删除入口。
- 用户端参考素材上传当前限制：图片最多 4 张并显示缩略图列表，视频最多 3 个，音频最多 1 个；参考视频+参考音频原始文件总大小限制为 36MB；参考图片提交前压缩成长边 1280px 的 JPEG data URL；真实供应商提交按 OpenAI Video 风格传 `images`、`videos`、`audios`。
- 真实供应商路径不会直接把 data URL 发给供应商：后端会保存参考素材到本地 `references/<jobId>/`，并生成 `/api/video/reference-assets/<jobId>/<filename>` 公网 URL。公网 URL 的 origin 优先使用管理后台“系统设置”的公网 API 地址，其次才回退 `PUBLIC_API_BASE_URL` 或请求域名推断。
- 公网 API 地址必须是供应商可访问的 HTTP(S) 地址；生产推荐 HTTPS 且证书必须有效。若供应商报 `x509: certificate has expired`，需要续期域名证书并重载 Nginx。
- 视频生成页轮询规则：有排队/生成中的任务时继续 1.5 秒轮询；生成成功并已渲染可播放视频后停止重复轮询，避免真实视频被不断刷新。
- 管理后台兑换码页通过 `/api/admin/redemption-codes` 读取所有历史兑换码记录，包含 `validityDays`；页面采用上下布局和分页记录区，新生成批次只在生成成功弹窗里提供“复制全部”，复制内容一行一个完整码。
- 用户端生成记录页通过 `/api/video/job-records` 展示模型、提示词、分辨率、画幅/尺寸、用户选择的视频时长、媒体上传数量和视频生成时长；不再展示完成时间。
- 用户端左下角可用积分区域从兑换记录计算有效期倒计时，显示“还剩 N 天”、永久或 `--`。注意 `updateCreditValidity()` 必须能在兑换记录尚未加载时安全执行。
- 参考素材当前以前端 base64 data URL 放入 JSON 请求体提交，前端限制参考视频+参考音频原始文件总大小不超过 36MB；后端默认 `REQUEST_BODY_LIMIT_BYTES=67108864`；Debian Nginx 模板 `client_max_body_size 100m`。
- 生产级模型 Key 轮换和旧密文迁移已完成；审计日志后续可补筛选、分页、导出和保留策略；错误提示后续可补更细字段级表单提示。
- 当前真实供应商提交已验证到供应商业务错误层：历史一次真实 `POST /v1/videos` 返回 `insufficient_user_quota`；后续又发现上传参考素材时供应商会校验公网参考素材 URL 的 HTTPS 证书，证书过期会拒绝抓取。用户已说明额度已充值，并要求后续持续允许真实生成。后续用户反馈真实生成已经能成功生成视频。
- 最近验证：`npm test` 通过 18 个测试文件、136 个测试；`npm run build` 通过；`npm run prisma:generate` 通过；本地已对新增 `system_settings` 执行 `npm run prisma:deploy`；本地 `/health` 正常。历史 `npm run provider:smoke` 只读调用供应商 `GET /v1/models` 通过并返回 `video-ds-2.0`、`video-ds-2.0-fast`。
- 当前生产部署已由用户确认成功上线，且 `favicon.svg` 站点图标补丁已在生产服务器更新成功。上线系统后续应用普通代码补丁时，生产 PostgreSQL 内的管理员账号、模型配置、供应商 URL/Key、积分套餐、系统设置、兑换码和用户积分会保留；只有换数据库、清空数据库或恢复另一份备份时才需要重新初始化。
- 当前工作重心转入优化和完善阶段。优先从用户端生成体验、真实生成闭环稳定性、管理后台效率、审计日志、备份回滚、Redis/BullMQ 守护监控和视频文件清理策略里选任务推进。

## 下一步建议

1. 优化用户端生成体验：失败原因、任务状态、生成记录、项目页播放/下载和参考素材上传提示。
2. 完善管理后台：审计日志筛选/分页/导出、用户/套餐/模型操作效率、生产配置可视化检查。
3. 完善生产运维：备份与回滚演练、Redis/BullMQ 守护监控、视频文件清理策略，供应商支持时再补 webhook 回调入口。

## 中断恢复提示

新对话继续开发时，先读：

1. `PROJECT.md`
2. `docs/context/new-chat-prompt.md`
3. `docs/context/current-session.md`
4. `docs/context/long-term-context.md`
5. 目标模块对应的 `docs/modules/*.md`
