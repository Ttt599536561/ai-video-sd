# 本地运行手册

## 前端

在项目根目录运行：

```powershell
python -m http.server 8765
```

访问：

```text
http://127.0.0.1:8765/auth.html
http://127.0.0.1:8765/index.html
http://127.0.0.1:8765/admin.html
```

## 后端

在 `backend/` 目录运行：

```powershell
npm install
Copy-Item .env.example .env
npm run prisma:generate
```

当前本地已使用 Docker PostgreSQL/Redis，启动依赖并应用数据库迁移：

```powershell
docker compose up -d postgres redis
npm run prisma:deploy
npm run dev
```

`backend/.env` 里应包含：

```text
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_video
MODEL_CONFIG_ENCRYPTION_KEY_BASE64=base64-encoded-32-byte-key
VIDEO_PROVIDER_BASE_URL=https://zz1cc.cc.cd
VIDEO_PROVIDER_API_KEY=<backend-env-only-provider-key>
VIDEO_PROVIDER_REAL_JOBS=true
REDIS_URL=redis://127.0.0.1:6379
VIDEO_STORAGE_DIR=storage/videos
REQUEST_BODY_LIMIT_BYTES=67108864
```

`PUBLIC_API_BASE_URL` 可作为公网 API 地址兜底值；现在更推荐在管理后台“系统设置”里填写，该数据库配置会优先于环境变量。生产必须填写供应商可访问的公网 HTTP(S) origin，本地 `127.0.0.1` 只能用于浏览器访问，供应商无法访问。

生产轮换模型配置加密主密钥时，可改用版本化 keyring：

```text
MODEL_CONFIG_ENCRYPTION_KEYS=1:base64:old-32-byte-key,2:base64:new-32-byte-key
MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION=2
```

上线顺序建议：

```powershell
cd backend
npm run model-keys:migrate
npm run model-keys:migrate -- --apply
```

第一次是 dry-run，只输出扫描数量、当前版本、各版本分布和将迁移数量；确认旧 Key 仍在 keyring 中后再执行 `--apply`。迁移过程不会输出供应商 Key 明文。

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4000/health
```

## 常用验证

```powershell
cd backend
npm test
npm run build
```

当前回归测试包含前端静态约束测试和后端业务测试，用于防止用户端误显示管理员入口、兑换码框自动填入邮箱、空任务队列、可用积分进度条/有效期、数据驱动接线、管理端模型/套餐交互、空 body DELETE 请求头、Mock 任务状态流转、供应商错误体解析、任务队列/项目视频删除语义回退、生成页轮询/预览状态、项目页播放下载、生成记录字段、兑换码有效期和刷新初始化顺序回退。

供应商只读连通验证：

```powershell
cd backend
npm run provider:smoke
```

该命令只调用供应商 `GET /v1/models`，不创建视频任务。用户生成任务在 `VIDEO_PROVIDER_REAL_JOBS=true` 时会提交真实 `POST /v1/videos`。

历史一次真实小流量联调只提交了 1 次 `POST /v1/videos`，供应商返回 `HTTP 403: insufficient_user_quota - 用户额度不足, 剩余额度: ＄35.000000, 最低保留额度: ＄9.000000`，没有生成 provider task id 或视频资产。用户已说明额度已充值，并要求后续点击生成视频持续真实发起请求；当前本地 `backend/.env` 已设置 `VIDEO_PROVIDER_REAL_JOBS=true`，后续用户反馈真实生成已经能成功生成视频。

真实任务状态同步已接入 Redis/BullMQ 后台轮询：启用 `VIDEO_PROVIDER_REAL_JOBS=true` 且配置 `REDIS_URL` 后，后端会注册后台扫描任务查询活跃供应商任务状态；用户端定时轮询只刷新任务列表。

真实 `POST /v1/videos` 由 `VIDEO_PROVIDER_REAL_JOBS=true` 控制。打开后，用户点击生成视频会真实提交供应商请求，并由 Redis/BullMQ 同步状态。

参考素材会随用户生成任务提交给后端，再由后端转交供应商：图片最多 4 张传 `images`，视频最多 3 个传 `videos`，音频最多 1 个传 `audios`。前端提交 data URL 时，后端会保存 reference asset 并向供应商提交 `/api/video/reference-assets/...` 公网 URL。上线验证时应确认前端限制、后端 `/api/video/jobs` 校验、管理后台公网 API 地址、Nginx 代理和 HTTPS 证书都正常。

当前静态前端会把参考素材作为 base64 data URL 放进 JSON 请求体。参考视频+参考音频原始文件总大小限制为 36MB；`REQUEST_BODY_LIMIT_BYTES` 控制后端 JSON body 上限，默认 64 MiB；如果用户上传图片后点击生成出现 `Failed to fetch`，优先检查该上限、Nginx `client_max_body_size` 和实际素材体积。

如果供应商返回 `PUBLIC_API_BASE_URL_REQUIRED`，说明后端无法得到供应商可访问的公网 API 地址；优先在管理后台“系统设置”填写。若返回 `PUBLIC_API_BASE_URL_CERT_INVALID` 或原始错误包含 `x509: certificate has expired`，说明公网 API 地址的 HTTPS 证书过期或不可验证，需要续期证书并重载 Nginx。

## 上线准备检查

### Redis/BullMQ 进程守护

单机部署时，API 进程负责启动 BullMQ 状态同步 worker。生产建议用系统进程管理器守护后端进程，例如 Windows 服务、PM2 或 systemd，并确保异常退出后自动重启。

最小检查项：

```powershell
cd backend
npm run build
npm run start
```

启动前确认 `REDIS_URL` 可连接，且 `VIDEO_PROVIDER_REAL_JOBS=true` 符合当前生产真实生成状态。

### 视频文件清理策略

本地视频文件目录由 `VIDEO_STORAGE_DIR` 控制，默认是 `backend/storage/videos`。后端运行时每小时扫描一次过期资产，删除超过 3 天保留期的视频文件，并把资产记录标记为已删除。

上线前确认：

- `VIDEO_STORAGE_DIR` 指向有足够空间的持久化目录。
- 该目录不提交到代码仓库，不放供应商 Key 或用户私密文本。
- 如果未来迁移到 S3 兼容对象存储，需要保留同样的 3 天过期策略和签名访问语义。

### 备份与回滚演练

上线前至少演练一次数据库备份和恢复。PostgreSQL 可使用：

```powershell
pg_dump "$env:DATABASE_URL" -Fc -f backup-ai-video.dump
pg_restore --clean --if-exists -d "$env:DATABASE_URL" backup-ai-video.dump
```

回滚流程建议：

1. 停止后端进程，避免写入继续发生。
2. 备份当前数据库和 `VIDEO_STORAGE_DIR`。
3. 回滚代码版本并重新执行 `npm run build`。
4. 如有 migration 变更，先在备份库验证恢复路径。
5. 启动后端，检查 `/health`、登录、模型列表、项目视频列表和管理后台审计页。

视频文件是否纳入备份需要明确策略：MVP 可选择不备份 3 天临时视频文件，但必须备份 PostgreSQL 数据；若业务要求用户 3 天内一定可下载，则同步备份 `VIDEO_STORAGE_DIR`。

## 本地注意事项

- 生产环境未设置 `DATABASE_URL` 会拒绝启动；只有显式设置 `USE_IN_MEMORY_STORE=true` 时才会回退到内存仓储，后端重启后会清空用户、兑换码和记录。正常本地开发也应使用 PostgreSQL。
- 设置 `DATABASE_URL` 后，后端启动日志应显示 `Using PostgreSQL/Prisma persistent store.`。
- Docker PostgreSQL 数据保存在 `backend_postgres_data` volume 里；不要运行 `docker compose down -v`，否则会清空数据库。
- Windows 本地优先使用 `127.0.0.1` 连接 PostgreSQL，避免 `localhost` 解析到 IPv6 `::1` 后连接失败。
- 前端默认 API 为 `http://127.0.0.1:4000`，也可通过浏览器 `localStorage.apiBase` 覆盖。
- 本地视频文件默认写入 `backend/storage/videos`；如需迁移目录，设置 `VIDEO_STORAGE_DIR`。
- 项目页删除视频会删除数据库中的视频资产记录，不删除生成任务记录；任务队列记录不可删除。
- 项目页播放使用资产签名地址在卡片内联播放器播放；下载使用签名地址获取 blob 后直接触发文件下载。
- 用户端生成记录页展示生成时间、模型、提示词、尺寸/分辨率、用户选择的视频时长、媒体上传数量和视频生成时长；不能新增视频地址、下载链接、存储 key 或供应商 task id 字段，也不再展示完成时间。
- 管理后台视频记录的“视频生成时长”来自 `completedAt - createdAt`，单位秒；未完成任务应显示 `--`。
- 管理后台兑换码记录和用户兑换记录展示 `validityDays`，单位天；用户端左下角可用积分有效期从兑换记录计算倒计时。
- 如果刷新 `index.html` 后历史视频不见且按钮都无法点击，优先检查浏览器控制台是否有 `Cannot access 'redemptionRecords' before initialization` 一类错误；修复原则是先初始化页面状态变量，再调用 `updateUserUI(readStoredUser())`，且 `updateCreditValidity()` 默认参数不能引用未初始化变量。
- 如果注册登录没有反应，先检查 API 服务是否运行，再看浏览器控制台网络请求。
- Windows 下如果 `npm run prisma:generate` 报 Prisma DLL 文件被占用，先停止正在运行的后端进程，再重新执行。
- 如果新增 Prisma migration，先执行 `npm run prisma:deploy`，再执行 `npm run prisma:generate`；如果 dev server 占用 Prisma DLL，停掉后端后生成，再启动 `npm run dev`。最近新增 `system_settings` 表后，如果没有执行迁移/生成，后端会在读取 `prisma.systemSetting` 时启动失败。
- 修改 `admin.html`、`index.html`、`auth.html` 后，可用 Node 解析内联脚本做无浏览器语法检查。
- 模型配置加密主密钥必须保持稳定；更换单 Key 前，优先切到 `MODEL_CONFIG_ENCRYPTION_KEYS` 多版本 keyring，确认旧密文可解，再用 `npm run model-keys:migrate -- --apply` 迁移到当前版本。

## 本地测试账号

```text
管理员：admin-code-1782584735007@example.com / password123
```
