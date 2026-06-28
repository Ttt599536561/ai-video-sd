# AI Video SD

AI 视频生成项目，包含用户端、管理后台和 Fastify 后端。项目支持积分套餐、兑换码、模型配置、真实供应商任务提交，以及上传图片/视频/音频作为参考素材生成视频。

## 重要部署提醒

- 生产环境建议使用 Debian 12.0 64bit。
- 真实密钥只允许放在服务器环境变量或管理后台里，不能提交到 GitHub。
- `backend/.env`、`node_modules`、`backend/storage`、`backend/dist`、日志文件已经在 `.gitignore` 中排除。
- 上传参考图片后生成真实任务时，供应商必须能通过公网 HTTPS 访问本项目后端的 `/api/video/reference-assets/...` 地址；本地电脑未上线时会报 404 或不可访问。

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
- 后端健康检查：`http://127.0.0.1:4000/health`

## 生产环境配置重点

上线后需要在管理后台重新配置生产数据库里的业务数据：

- 系统设置里的公网 API 地址，例如 `https://ai.example.com`
- 模型配置里的供应商 URL、模型 ID、提交路径、鉴权方式和 API Key
- 积分套餐、兑换码、用户积分

本地刚设置好的积分套餐和模型配置不会自动出现在服务器上，除非你做数据库备份恢复。代码推送到 GitHub 只会同步代码和文档，不会同步本地数据库内容。
