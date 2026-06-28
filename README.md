# AI Video SD

AI 视频生成项目，包含用户端、管理后台和 Fastify 后端。项目支持积分套餐、兑换码、模型配置、真实供应商任务提交，以及上传图片/视频/音频作为参考素材生成视频。

## 重要部署提醒

- 当前项目已完成公网服务器生产部署。后续代码更新按“部署后更新代码”流程从 GitHub 拉取，不需要重新初始化数据库或重新创建管理员。
- 生产环境建议使用 Debian 12.0 64bit。
- 真实密钥只允许放在服务器环境变量或管理后台里，不能提交到 GitHub。
- `backend/.env`、`node_modules`、`backend/storage`、`backend/dist`、日志文件已经在 `.gitignore` 中排除。
- 上传参考图片后生成真实任务时，供应商必须能通过公网 HTTPS 访问本项目后端的 `/api/video/reference-assets/...` 地址；生产服务器已上线后仍需确认 Nginx 代理 `/api/`、HTTPS 证书有效、管理后台“系统设置”的公网 API 地址正确。
- 生产环境必须配置 `DATABASE_URL`。未配置时后端会拒绝启动，只有显式设置 `USE_IN_MEMORY_STORE=true` 才允许使用会丢数据的内存模式。
- 参考视频和参考音频会作为 base64 JSON 上传，前端已限制视频+音频原始文件总大小不超过 36MB；后端默认 `REQUEST_BODY_LIMIT_BYTES=67108864`，Nginx 模板为 `client_max_body_size 100m`。

## 文档入口

- Debian 12 + GitHub 部署步骤：[docs/operations/debian-12-github-deployment-guide.md](docs/operations/debian-12-github-deployment-guide.md)
- Debian 部署模板：[deploy/debian/README.md](deploy/debian/README.md)
- 项目总览：[PROJECT.md](PROJECT.md)
- 后端说明：[backend/README.md](backend/README.md)

## 本地后端常用命令

```bash
cd backend
npm install
npm run prisma:generate
npm test
npm run build
npm run dev
```

本地调试可以访问：

- 用户端：`auth.html`、`index.html`
- 管理后台：`admin.html`
- 站点图标：`favicon.svg`
- 后端健康检查：`http://127.0.0.1:4000/health`

## 生产环境配置重点

首次上线或换新数据库后，需要在管理后台配置生产数据库里的业务数据：

- 系统设置里的公网 API 地址，例如 `https://ai.example.com`
- 模型配置里的供应商 URL、模型 ID、提交路径、鉴权方式和 API Key
- 积分套餐、兑换码、用户积分

本地刚设置好的积分套餐和模型配置不会自动出现在服务器上，除非你做数据库备份恢复。代码推送到 GitHub 只会同步代码和文档，不会同步本地数据库内容。

首个管理员只需要创建一次。新数据库第一次部署时用 `BOOTSTRAP_ADMIN_SECRET` 调用 bootstrap 接口；一旦数据库里已经存在管理员，再次调用会被拒绝，之后应删除或注释该环境变量并重启后端。

已上线系统应用普通代码补丁时，数据库里的管理员账号、模型配置、供应商 URL/Key、积分套餐和兑换码不会丢失，也不需要重新填写。只有换数据库、清空数据库或恢复到另一份数据库时，才需要重新初始化这些业务数据。
