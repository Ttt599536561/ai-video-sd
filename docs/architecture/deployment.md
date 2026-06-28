# 部署架构

## 单台美国服务器部署

当前项目已完成公网服务器生产部署，适合 MVP 阶段继续迭代。后续维护以 GitHub `main` 分支为代码来源，服务器从 `/opt/ai-video` 拉取更新并通过 systemd/Nginx 发布。

推荐进程：

- Nginx：HTTPS、静态页面、反向代理 API。
- Node.js：运行 Fastify 后端。
- PostgreSQL：保存业务数据。
- Redis：真实视频任务状态同步队列；当前本地 Mock 任务流暂未由 Worker 消费。
- 文件目录或对象存储：保存 3 天视频文件，MVP 默认用后端本地目录；真实供应商内容下载和本地存储已接入。

Debian 12 具体部署材料位于 [deploy/debian/README.md](../../deploy/debian/README.md)，包含生产环境变量模板、Nginx 配置、systemd 服务和给 AI 部署助手的提示词。新服务器从 GitHub 仓库部署时，优先按 [Debian 12 + GitHub 部署步骤](../operations/debian-12-github-deployment-guide.md) 执行；已上线服务器更新时，直接按该文档“部署后更新代码”执行。

## 生产环境注意事项

- 前端只部署静态文件，不包含模型 URL 或 Key。
- 生产前端默认请求同源 `/api/...`，Nginx 需要把 `/api/` 和 `/health` 反向代理到 `127.0.0.1:4000`；本地开发访问 `127.0.0.1`/`localhost` 时仍默认请求 `http://127.0.0.1:4000`。
- 后端通过环境变量和数据库读取模型配置。
- `MODEL_CONFIG_ENCRYPTION_KEY_BASE64` 或 `MODEL_CONFIG_ENCRYPTION_KEY_HEX` 可用于单 Key 兼容模式；生产轮换推荐使用 `MODEL_CONFIG_ENCRYPTION_KEYS=1:base64:old,2:base64:new` 和 `MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION=2`。
- 轮换时先同时部署旧 Key 和新 Key，确认旧密文可读后执行 `npm run model-keys:migrate` dry-run，再执行 `npm run model-keys:migrate -- --apply` 重加密旧密文；旧 Key 只能在确认没有旧版本密文后移除。
- `VIDEO_PROVIDER_BASE_URL` 和 `VIDEO_PROVIDER_API_KEY` 只放后端环境变量；当前已用只读 `GET /v1/models` 验证连通，并执行过真实 `POST /v1/videos` 联调。
- `VIDEO_PROVIDER_REAL_JOBS=true` 会让用户创建任务真实提交 `POST /v1/videos`；当前生产部署已上线，并按服务器环境变量持续控制真实生成。
- `VIDEO_STORAGE_DIR` 可覆盖本地视频文件目录；目录需要随 3 天保留策略清理，并确认备份或不备份策略。
- `DATABASE_URL` 是生产必填项；未配置时后端会拒绝启动，只有显式 `USE_IN_MEMORY_STORE=true` 才允许临时内存模式。
- `REQUEST_BODY_LIMIT_BYTES` 控制后端 JSON 请求体上限；当前前端参考素材以 base64 data URL 提交，参考视频+参考音频原始文件总大小限制为 36MB，生产建议显式设置为 `67108864` 并让 Nginx `client_max_body_size` 不小于该值。
- 首次上线或更换数据库后需要在管理后台“系统设置”填写公网 API 地址，例如 `https://api.example.com` 或同源站点 origin。该值会写入数据库并优先用于供应商抓取参考图片/视频/音频；没有后台配置时才回退 `PUBLIC_API_BASE_URL` 环境变量或请求域名推断。
- 公网 API 地址必须是供应商可访问的 HTTP(S) origin。生产推荐 HTTPS，且证书必须有效；证书过期会导致供应商返回 `x509: certificate has expired`，后端会映射为 `PUBLIC_API_BASE_URL_CERT_INVALID`。
- 数据库、Redis、上传目录需要定期备份或明确不备份策略。
- API 需要 HTTPS，管理后台建议限制强密码和后续二次验证。
- 已上线系统更新普通代码补丁时不会清空 PostgreSQL 数据；管理员账号、模型配置、供应商 URL/Key、积分套餐和兑换码会保留。只有换数据库、清空数据库或恢复另一份备份时，才需要重新初始化后台业务配置。
- 生产运维应确认 Redis/BullMQ 后台状态同步进程由 systemd 或同等机制守护；确认视频文件清理/对象存储策略、供应商额度规则和回滚流程；生产密钥轮换已具备 keyring 与旧密文迁移脚本，仍需在部署流程中演练备份和回滚。
- 同一台 Debian 12 服务器可以部署多个项目，但每个 Node 后端必须使用不同的本机端口、不同的 systemd 服务名、不同的项目目录和独立数据库；若 `4000` 已被占用，本项目可改用 `4100`，并同步修改 Nginx `proxy_pass`。
- 上传参考素材后提交真实供应商任务时，供应商会访问本项目公网 HTTPS 的 `/api/video/reference-assets/...`。只访问 `/health` 返回正常不代表参考素材 URL 可用；需要确保 Nginx 已反代 `/api/`，管理后台“系统设置”的公网 API 地址指向当前项目，且证书有效。
