# 新对话轻量接力提示词

新开 Codex 对话时，优先复制下面这段。它只包含当前继续开发所需事实，避免把旧聊天全部塞进上下文。

```text
你在 Windows 项目 `C:\Users\Administrator\Desktop\即梦生视频项目` 里继续开发。

请先只读这些文档，不要一次性读取所有历史：
1. `PROJECT.md`
2. `docs/context/current-session.md`
3. `docs/context/long-term-context.md`
4. 和本次任务相关的 `docs/modules/*.md` 或 `docs/architecture/*.md`

项目事实：
- 前端是根目录静态页：`index.html`、`auth.html`、`admin.html`，并包含站点图标 `favicon.svg`。
- 后端在 `backend/`，Fastify + TypeScript + Prisma + Vitest。
- 本地前端：`http://127.0.0.1:8765`；API：`http://127.0.0.1:4000`。
- 本地测试管理员：`admin-code-1782584735007@example.com` / `password123`。
- 后端使用 PostgreSQL/Prisma；Redis 已启用；不要运行 `docker compose down -v`。
- 当前本地 `backend/.env` 已设置 `VIDEO_PROVIDER_REAL_JOBS=true`，用户点击生成视频会真实提交供应商 `POST /v1/videos`。
- 关闭 `VIDEO_PROVIDER_REAL_JOBS` 时仍可回到本地 Mock Provider。
- 供应商 Key 只放在 `backend/.env`，不要输出或写入前端/文档。
- 供应商抓取参考素材的公网 API 地址在管理后台“系统设置”维护，持久化到 `system_settings`；优先级高于 `PUBLIC_API_BASE_URL` 环境变量。

真实供应商状态：
- 供应商只读模型列表已返回 `video-ds-2.0`、`video-ds-2.0-fast`。
- 协议是 OpenAI Video 风格：`POST /v1/videos`、`GET /v1/videos/{id}`、`GET /v1/videos/{id}/content`。
- 真实视频状态同步已迁移到 Redis/BullMQ 后台同步器：`backend/src/services/video-status-sync.service.ts`。
- 启用条件是 `VIDEO_PROVIDER_REAL_JOBS=true` 且配置 `REDIS_URL`。
- 前端轮询只刷新 `/api/video/jobs`，不再自动触发 `/sync`。
- 历史上已提交过 1 次真实 `POST /v1/videos` 小流量联调，供应商返回：
  `HTTP 403: insufficient_user_quota - 用户额度不足, 剩余额度: ＄35.000000, 最低保留额度: ＄9.000000`
- 该任务没有 provider task id，没有视频资产；之后用户说明额度已充值，并明确要求后续点击生成视频持续真实发起请求、不再限制。

已完成的关键行为：
- 管理后台模型、积分套餐、兑换码操作台默认空；保存即新增或更新，保存后清空。
- 管理后台新增“系统设置”，可保存公网 API 地址；该地址用于供应商抓取参考素材，必须公网可访问且 HTTPS 证书有效。
- 管理后台系统提示统一居中弹窗；切换模型配置、积分套餐、用户管理、生成记录、操作审计等页签不弹提示。
- 用户管理不显示管理员账号。
- 模型删除：无历史任务引用则物理删除；已有生成记录引用则软删除并从配置/前台模型列表隐藏，历史记录保留。
- 前端 `apiFetch` 只有有 body 时才设置 JSON content-type，空 body 的 DELETE 不带 `Content-Type: application/json`。
- CORS 已允许 `GET,HEAD,POST,PATCH,DELETE`。
- 模型配置加密 Key 已支持稳定单 Key 和生产版本化 keyring：`MODEL_CONFIG_ENCRYPTION_KEY_BASE64`/`MODEL_CONFIG_ENCRYPTION_KEY_HEX` 兼容旧配置，`MODEL_CONFIG_ENCRYPTION_KEYS` + `MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION` 用于轮换；旧密文按记录 `keyVersion` 解密，缺失版本按 1 兼容。
- 管理后台模型配置里的“模型名称”从 `GET /api/admin/provider-models` 读取供应商模型作为输入建议并保存为真实 `modelName`；供应商列表读取失败时仍可手动输入真实模型 ID；“模型别名”即 `displayName`，可由管理员修改。
- 用户前台模型下拉只展示 `displayName`，创建视频任务时仍提交供应商 `modelName`，不要把展示名传给供应商。
- 真实供应商成功任务会下载 `/content` 写入后端本地目录，用户端下载按钮请求签名下载地址；`VIDEO_STORAGE_DIR` 可覆盖本地视频文件目录。
- 用户兑换记录已接入：`GET /api/credits/redemptions` 返回当前用户脱敏兑换历史。
- 管理端操作审计已接入：`GET /api/admin/audit-logs` 和后台“操作审计”页签覆盖模型、套餐、兑换码批量生成、用户积分调整和封禁/解封；metadata 不保存完整模型 Key、兑换码明文或兑换码哈希。
- 更完整错误提示已接入：后端结构化返回 `code/message/statusCode/error`，前端三页通过 `apiErrorMessage()` 统一显示常见错误中文文案。
- 供应商错误详情解析已接入：非 2xx 响应会解析 JSON/text 错误体，提取 `error.code/error.message`、`error_code/error_msg`、`code/message`、`error_message` 等字段，并避免输出 Key 明文。
- 旧模型 Key 密文迁移脚本已接入：`npm run model-keys:migrate` 默认 dry-run，`npm run model-keys:migrate -- --apply` 才重加密到当前版本。
- 视频任务队列和项目视频已解耦：任务队列只展示生成任务，不提供删除入口；生成任务记录不可由用户删除。
- 项目页通过 `/api/video/assets` 展示当前用户视频资产；删除项目视频调用 `DELETE /api/video/assets/:id`，删除数据库中的视频资产记录，但不影响生成任务记录。
- 项目页“播放”会通过 `/api/video/assets/:id/download-url` 获取签名地址，并在项目卡片内联播放器直接播放，不弹出提示；“下载”会直接触发文件下载，不进入播放；项目页没有默认占位视频封面，无视频资产时显示无视频空状态。
- `DELETE /api/video/jobs/:id` 应返回 405 `VIDEO_JOB_DELETE_NOT_ALLOWED`。
- 视频生成页点击生成并通过基础校验后，会先提示“正在提交生成任务，请稍候...”；右侧预览区无任务时显示空状态，有活跃任务时显示“视频生成中...”；轮询间隔为 1.5 秒，检测到完成后自动显示视频，并在全局页面正中间提示“视频已生成”。
- 视频生成页检测到任务生成成功并已渲染可播放视频后应停止重复轮询；只有存在排队/生成中任务时才继续轮询，避免真实视频播放器被不断刷新。
- 视频生成页任务队列最多展示 10 条，超出在固定高度内滚动；队列卡片底边与“生成参数”卡片底边对齐。
- 文生视频参考图/首帧功能与参考音频功能放在同一行；视频生视频参考视频功能与参考音频功能放在同一行；提示词下方快捷风格按钮和“接口参数由后台统一配置”文案已移除。
- 用户端已有单独“生成记录”页，展示生成时间、模型展示名、供应商模型 ID、提示词、分辨率、画幅/尺寸、用户选择的视频时长、参考图片/视频/音频数量、扣除积分、状态和视频生成时长；不展示完成时间、视频地址、下载链接、存储 key 或供应商 task id。
- 管理后台视频记录同样展示模型、提示词、分辨率、画幅/尺寸、用户选择的视频时长、媒体上传数量和视频生成时长；`generationDurationSeconds` 按完成时间减去提交时间计算，单位秒。
- 管理后台兑换码页通过 `/api/admin/redemption-codes` 展示所有已生成兑换码历史记录，管理员可查看完整兑换码、批次、积分、状态、生成时间、有效期和兑换信息；页面采用上下布局，批量生成在上方，全部兑换码记录在下方，固定高度分页切换。
- 兑换码批量生成表单区不再有“复制全部兑换码”；有效期选择为“永久有效/自定义天数”；生成成功后弹出“本次生成兑换码”弹窗，弹窗内有复制全部按钮，复制格式为一行一个完整码。管理员复制历史兑换码时复制明文完整码。
- 兑换码完整码会通过现有 Prisma 字段 `redemption_codes.code_ciphertext` 持久化，并在 `PrismaBackedStore` 重载时映射回领域对象 `plainCode`；老数据如果当时只保存哈希则无法反推完整码。
- 用户端兑换记录和管理员端兑换码记录都展示 `validityDays`，单位为天；用户端左下角可用积分区域显示有效期倒计时：“还剩 N 天”、永久或 `--`。
- 用户端启动顺序是防回归重点：`index.html` 必须先初始化 `redemptionRecords` 等状态，再调用 `updateUserUI(readStoredUser())`；`updateCreditValidity()` 默认参数不能引用尚未初始化的 `redemptionRecords`，否则刷新后脚本中断，按钮不可点击且历史视频不渲染。
- 生成参数下拉框统一使用 `.select-control` 自定义样式；不要重新退回浏览器默认下拉框。
- 参考图/参考视频/参考音频上传已进入创建任务 payload：图片最多 4 张并传 `images`，视频最多 3 个并传 `videos`，音频最多 1 个并传 `audios`；参考视频+参考音频原始文件总大小限制为 36MB；后端 `/api/video/jobs` 同步校验数量。
- 真实供应商路径不会直接把 data URL 发给供应商：后端会保存 reference asset 到 `VIDEO_STORAGE_DIR/references/<jobId>/`，再把 `/api/video/reference-assets/<jobId>/<filename>` 公网 URL 提交给供应商；已有 HTTP(S) URL 原样透传。公网 origin 优先来自管理后台系统设置，其次是 `PUBLIC_API_BASE_URL`，最后才尝试从非本地请求域名推断。
- 参考图片提交前会在前端压缩成长边 1280px 的 JPEG data URL；后端拒绝超大的图片 data URL；失败任务队列卡片会显示失败原因摘要。
- 参考素材当前以前端 base64 data URL 放入 JSON 请求体提交；前端限制参考视频+参考音频原始文件总大小不超过 36MB；后端默认 `REQUEST_BODY_LIMIT_BYTES=67108864`，Debian Nginx 模板 `client_max_body_size 100m`。若上传素材后出现 `Failed to fetch`，优先检查 body limit、Nginx 限制和实际素材体积；若供应商返回 `PUBLIC_API_BASE_URL_REQUIRED`，先填系统设置公网 API 地址；若返回 `PUBLIC_API_BASE_URL_CERT_INVALID` 或原始错误包含 `x509: certificate has expired`，续期公网 API 地址域名证书并重载 Nginx。
- 最近验证：`npm test` 通过 18 个测试文件、136 个测试；`npm run build` 通过；`npm run prisma:generate` 通过；本地已对新增 `system_settings` 执行 `npm run prisma:deploy`。
- 生产部署已由用户确认成功上线。部署文档已更新：根目录 `README.md` 指向 `docs/operations/debian-12-github-deployment-guide.md`。该文档按 Debian 12 + GitHub 仓库 `https://github.com/Ttt599536561/ai-video-sd.git` 写了完整命令，包含端口冲突、Nginx 反代、公网 IP/域名、后台初始化、URL/Key 和积分套餐是否需要重配。
- 已上线服务器应用普通代码补丁时，生产 PostgreSQL 里的管理员账号、模型配置、供应商 URL/Key、积分套餐、系统设置、兑换码和用户积分会保留；只有换数据库、清空数据库或恢复另一份备份时才需要重新初始化。当前 `favicon.svg` 补丁只需要服务器 `git pull origin main` 后重新安装 `auth.html`、`index.html`、`admin.html`、`favicon.svg` 到 `/var/www/ai-video` 并重载 Nginx。

工作规则：
- 不要连接内置浏览器，不要截图验证，除非我明确要求。
- 先用 `rg` 搜索，再改代码。
- 改代码优先补测试；完成前运行 `npm test` 和 `npm run build`。
- 如果需要 Prisma Client 重新生成，Windows 下 DLL 被占用时先停止后端 dev server，生成后再启动回来。新增 migration 后要先 `npm run prisma:deploy` 再 `npm run prisma:generate`，否则类似 `prisma.systemSetting` 的新 delegate 可能不存在。
- 不要运行 `docker compose down -v`。
- 真实生成当前已按用户要求持续启用；不要把供应商 Key 输出或写入前端/文档。

接下来优先做：
1. 观察真实生成闭环：供应商 task id、后台同步、内容下载、本地资产、项目页播放/下载、参考素材公网抓取和 HTTPS 证书有效性。
2. 继续完善生产运维：Redis/BullMQ 进程守护、视频文件清理策略、审计日志筛选/分页/导出、备份与回滚演练。
3. 后续如供应商支持，可补 webhook 回调入口。
```
