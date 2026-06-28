# Debian 12 部署手册

本文档面向一台 Debian 12.0 64bit 服务器，推荐部署形态：

- Nginx 托管根目录静态页：`auth.html`、`index.html`、`admin.html`。
- Nginx 将 `/api/` 和 `/health` 反向代理到本机 `127.0.0.1:4000`。
- systemd 守护 Fastify 后端。
- PostgreSQL 保存业务数据。
- Redis 支撑真实视频任务的 BullMQ 后台状态同步。
- `/var/lib/ai-video/storage/videos` 保存 3 天视频文件缓存。

## 0. 上线前准备

你需要先准备：

- 域名：例如 `example.com`，A 记录指向服务器公网 IP。
- 服务器系统：Debian 12.0 64bit。
- 代码目录：建议 `/opt/ai-video`。
- 静态文件目录：建议 `/var/www/ai-video`。
- 环境变量文件：`/etc/ai-video/backend.env`。
- 视频文件目录：`/var/lib/ai-video/storage/videos`。

本项目的前端已经改成生产环境默认使用同源 API：公网访问 `https://example.com/index.html` 时会请求 `https://example.com/api/...`；本地 `127.0.0.1` 或 `localhost` 仍默认请求 `http://127.0.0.1:4000`。

## 1. 安装系统依赖

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git nginx postgresql postgresql-contrib redis-server certbot python3-certbot-nginx
```

安装 Node.js 24：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

如果 NodeSource 当前不可用，可临时改用 Docker 部署后端，或用官方 Node.js 二进制包安装 Node 24；不要使用 Debian 12 默认旧版 Node 来跑此项目。

## 2. 创建系统用户和目录

```bash
sudo adduser --system --group --home /opt/ai-video --no-create-home ai-video
sudo mkdir -p /opt/ai-video /var/www/ai-video /etc/ai-video /var/lib/ai-video/storage/videos /var/backups/ai-video
sudo chown -R ai-video:ai-video /opt/ai-video /var/lib/ai-video
sudo chown -R www-data:www-data /var/www/ai-video
sudo chmod 0750 /var/lib/ai-video /var/lib/ai-video/storage /var/lib/ai-video/storage/videos
```

## 3. 创建 PostgreSQL 数据库

生成一个只含字母数字的数据库密码，避免 URL 转义麻烦：

```bash
DB_PASS="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)"
echo "$DB_PASS"
```

创建数据库用户和库，把上一步输出的密码替换进去：

```bash
sudo -u postgres psql
```

```sql
CREATE USER ai_video_user WITH PASSWORD 'REPLACE_DB_PASSWORD';
CREATE DATABASE ai_video OWNER ai_video_user;
\q
```

## 4. 上传代码

如果代码已经推送到 GitHub，推荐按 [docs/operations/debian-12-github-deployment-guide.md](../../docs/operations/debian-12-github-deployment-guide.md) 从仓库克隆部署。下面的 `rsync` 方式仍可用于没有 GitHub 仓库或临时手动同步的场景。

在你的本机或 CI 上把项目同步到服务器，排除本地依赖、日志和真实 `.env`：

```bash
rsync -az --delete \
  --exclude 'backend/node_modules' \
  --exclude 'backend/dist' \
  --exclude 'backend/storage' \
  --exclude 'backend/.env' \
  --exclude '*.log' \
  ./ root@example.com:/opt/ai-video/
```

服务器上修正属主：

```bash
sudo chown -R ai-video:ai-video /opt/ai-video
```

## 5. 配置后端环境变量

复制模板：

```bash
sudo cp /opt/ai-video/deploy/debian/backend.env.example /etc/ai-video/backend.env
sudo chown root:ai-video /etc/ai-video/backend.env
sudo chmod 0640 /etc/ai-video/backend.env
sudo nano /etc/ai-video/backend.env
```

必须替换这些值：

- `DATABASE_URL`：使用第 3 步创建的数据库密码。
- `JWT_SECRET`：`openssl rand -base64 48`。
- `REDEMPTION_HASH_SECRET`：`openssl rand -base64 48`。
- `BOOTSTRAP_ADMIN_SECRET`：首次创建管理员的一次性密钥。
- `MODEL_CONFIG_ENCRYPTION_KEY_BASE64`：`openssl rand -base64 32`，必须解码为 32 字节。
- `VIDEO_PROVIDER_API_KEY`：供应商 Key，只能放后端。
- `VIDEO_PROVIDER_REAL_JOBS=true`：开启真实供应商任务。
- `REQUEST_BODY_LIMIT_BYTES=67108864`：允许参考图片等 base64 JSON 上传；Nginx 模板已设置 `client_max_body_size 100m`。

生产环境必须填写 `DATABASE_URL` 并保持 `USE_IN_MEMORY_STORE=false`。如果漏填，后端会拒绝启动；只有显式设置 `USE_IN_MEMORY_STORE=true` 才允许使用会丢数据的内存模式。

可选项：

- `PUBLIC_API_BASE_URL`：供应商抓取参考素材的公网 API 地址兜底值。优先推荐上线后在管理后台“系统设置”填写；后台数据库配置会覆盖该环境变量。

不要把真实供应商 Key、JWT Secret、兑换码哈希 Secret 或模型配置加密 Key 写进前端、README、聊天记录或 Git 仓库。

## 6. 构建后端并执行数据库迁移

```bash
cd /opt/ai-video/backend
sudo -u ai-video npm ci
sudo -u ai-video npm run prisma:generate
sudo -u ai-video npm run build
```

加载生产环境变量并执行 migration：

```bash
sudo -u ai-video bash -lc 'set -a; . /etc/ai-video/backend.env; set +a; cd /opt/ai-video/backend && npm run prisma:deploy'
```

如果是从旧服务器迁移，并且模型配置密文涉及 Key 轮换，先 dry-run：

```bash
sudo -u ai-video bash -lc 'set -a; . /etc/ai-video/backend.env; set +a; cd /opt/ai-video/backend && npm run model-keys:migrate'
```

确认输出后再执行：

```bash
sudo -u ai-video bash -lc 'set -a; . /etc/ai-video/backend.env; set +a; cd /opt/ai-video/backend && npm run model-keys:migrate -- --apply'
```

## 7. 部署静态前端

```bash
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/auth.html /var/www/ai-video/auth.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/index.html /var/www/ai-video/index.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/admin.html /var/www/ai-video/admin.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/favicon.svg /var/www/ai-video/favicon.svg
```

## 8. 配置 systemd

```bash
sudo cp /opt/ai-video/deploy/debian/ai-video-api.service /etc/systemd/system/ai-video-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now ai-video-api
sudo systemctl status ai-video-api --no-pager
```

检查日志：

```bash
journalctl -u ai-video-api -n 100 --no-pager
```

正常启动应看到：

```text
Using PostgreSQL/Prisma persistent store.
API listening on http://0.0.0.0:4000
```

本机健康检查：

```bash
curl -fsS http://127.0.0.1:4000/health
```

## 9. 配置 Nginx

```bash
sudo cp /opt/ai-video/deploy/debian/nginx-ai-video.conf /etc/nginx/sites-available/ai-video
sudo nano /etc/nginx/sites-available/ai-video
```

把 `server_name example.com www.example.com;` 改成你的域名。然后启用：

```bash
sudo ln -sf /etc/nginx/sites-available/ai-video /etc/nginx/sites-enabled/ai-video
sudo nginx -t
sudo systemctl reload nginx
```

公网 HTTP 检查：

```bash
curl -fsS http://example.com/health
curl -I http://example.com/auth.html
```

签发 HTTPS：

```bash
sudo certbot --nginx -d example.com -d www.example.com
sudo systemctl reload nginx
```

HTTPS 检查：

```bash
curl -fsS https://example.com/health
```

## 10. 创建第一个管理员

确认 `/etc/ai-video/backend.env` 里有 `BOOTSTRAP_ADMIN_SECRET`，并重启后端：

```bash
sudo systemctl restart ai-video-api
```

创建管理员：

```bash
curl -X POST https://example.com/api/auth/bootstrap-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"REPLACE_ADMIN_PASSWORD","bootstrapSecret":"REPLACE_USE_ONCE_SECRET"}'
```

该接口只用于全新数据库的第一个管理员；数据库里已经存在管理员后，再次调用会返回 `ADMIN_BOOTSTRAP_DISABLED`。成功后立刻编辑 `/etc/ai-video/backend.env`，删除或注释 `BOOTSTRAP_ADMIN_SECRET`，再重启：

```bash
sudo nano /etc/ai-video/backend.env
sudo systemctl restart ai-video-api
```

## 11. 初始化系统设置、供应商模型和套餐

访问：

```text
https://example.com/admin.html
```

用管理员账号登录，然后：

1. 在“系统设置”里填写公网 API 地址，例如 `https://example.com` 或 `https://api.example.com`。这是供应商抓取参考图片/视频/音频时访问的后端 origin，必须公网可访问且 HTTPS 证书有效。
2. 在“模型配置”里读取供应商模型列表。
3. 选择或手动输入供应商真实模型 ID，例如 `video-ds-2.0` 或 `video-ds-2.0-fast`。
4. 填写模型别名，这是用户前台看到的名称。
5. 填写供应商基础 URL，例如 `https://zz1cc.cc.cd`。
6. 填写提交路径 `/v1/videos`。
7. 鉴权类型选择 `BEARER`。
8. 填写供应商 Key；后端会加密保存，前端不会持久展示明文。
9. 填写单次消耗积分并启用模型。
10. 在“积分套餐”里创建用户可购买的套餐。
11. 如需给用户发放积分，在“兑换码”里生成兑换码批次；有效期可选永久有效或自定义天数。

## 12. 发布更新流程

```bash
sudo systemctl stop ai-video-api
rsync -az --delete \
  --exclude 'backend/node_modules' \
  --exclude 'backend/dist' \
  --exclude 'backend/storage' \
  --exclude 'backend/.env' \
  --exclude '*.log' \
  ./ root@example.com:/opt/ai-video/
sudo chown -R ai-video:ai-video /opt/ai-video

cd /opt/ai-video/backend
sudo -u ai-video npm ci
sudo -u ai-video npm run prisma:generate
sudo -u ai-video npm run build

sudo -u ai-video bash -lc 'set -a; . /etc/ai-video/backend.env; set +a; cd /opt/ai-video/backend && npm run prisma:deploy'

sudo install -o www-data -g www-data -m 0644 /opt/ai-video/auth.html /var/www/ai-video/auth.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/index.html /var/www/ai-video/index.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/admin.html /var/www/ai-video/admin.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/favicon.svg /var/www/ai-video/favicon.svg

sudo systemctl start ai-video-api
sudo nginx -t && sudo systemctl reload nginx
curl -fsS https://example.com/health
```

## 13. 备份和恢复

至少备份 PostgreSQL。视频文件只保留 3 天，如业务要求 3 天内必须可下载，也备份 `VIDEO_STORAGE_DIR`。

备份：

```bash
BACKUP_DIR="/var/backups/ai-video/$(date +%F-%H%M%S)"
sudo mkdir -p "$BACKUP_DIR"
sudo chown ai-video:ai-video "$BACKUP_DIR"
sudo -u ai-video bash -lc "set -a; . /etc/ai-video/backend.env; set +a; pg_dump \"\$DATABASE_URL\" -Fc -f '$BACKUP_DIR/ai_video.dump'"
sudo tar -C /var/lib/ai-video -czf "$BACKUP_DIR/video-storage.tgz" storage
```

恢复前先停止后端：

```bash
sudo systemctl stop ai-video-api
sudo -u ai-video bash -lc 'set -a; . /etc/ai-video/backend.env; set +a; pg_restore --clean --if-exists -d "$DATABASE_URL" /var/backups/ai-video/REPLACE/ai_video.dump'
sudo tar -C /var/lib/ai-video -xzf /var/backups/ai-video/REPLACE/video-storage.tgz
sudo chown -R ai-video:ai-video /var/lib/ai-video
sudo systemctl start ai-video-api
```

## 14. 故障排查

- `/health` 不通：先看 `systemctl status ai-video-api` 和 `journalctl -u ai-video-api -n 100 --no-pager`。
- 日志出现 `MODEL_CONFIG_ENCRYPTION_KEY_BASE64 is required`：生产环境变量缺少模型配置加密 Key。
- 日志出现 `DATABASE_URL is required in production unless USE_IN_MEMORY_STORE=true`：生产数据库连接未加载，必须修复 `/etc/ai-video/backend.env` 里的 `DATABASE_URL`。
- 日志出现 `Using non-persistent InMemoryStore`：只应出现在显式本地测试或临时模式；生产不要使用，否则重启会丢业务数据。
- 用户前端没有模型：管理员后台还没有创建并启用模型配置。
- 真实任务不自动更新：确认 `VIDEO_PROVIDER_REAL_JOBS=true` 且 `REDIS_URL=redis://127.0.0.1:6379`，并检查 Redis 服务。
- 供应商提交失败：看返回的结构化错误；后端会解析供应商 `code/message`，但不会打印 API Key。
- 供应商返回 `PUBLIC_API_BASE_URL_REQUIRED`：管理后台“系统设置”未填写公网 API 地址，且环境变量/请求域名也无法推断公网地址。
- 供应商返回 `PUBLIC_API_BASE_URL_CERT_INVALID`，或原始错误里有 `x509: certificate has expired`：公网 API 地址对应域名 HTTPS 证书过期或不可验证。用 `sudo certbot renew` 续期证书，随后 `sudo systemctl reload nginx`，再用 `curl -Iv https://example.com/health` 检查证书有效期。
- 上传图片/视频/音频参考后供应商抓取失败：确认“系统设置”的公网 API 地址不是 `localhost`、`127.0.0.1` 或内网 IP；确认 Nginx 已代理 `/api/video/reference-assets/` 到后端；确认 HTTPS 证书有效。
- 上传后出现 `REQUEST_BODY_TOO_LARGE` 或 `Failed to fetch`：保持 `REQUEST_BODY_LIMIT_BYTES=67108864` 和 Nginx `client_max_body_size 100m`；前端已限制参考视频+参考音频原始文件总大小不超过 36MB，仍失败时压缩素材或减少数量。
- 视频无法下载：确认 `/var/lib/ai-video/storage/videos` 属主是 `ai-video:ai-video`，并且文件未超过 3 天过期。

## 15. GitHub 部署与端口冲突补充

- GitHub 仓库地址为 `https://github.com/Ttt599536561/ai-video-sd.git` 时，可在服务器执行 `sudo -u ai-video git clone https://github.com/Ttt599536561/ai-video-sd.git /opt/ai-video`。
- 如果服务器已有其他项目，先执行 `sudo ss -lntp` 检查端口。`4000` 已被占用时，把 `/etc/ai-video/backend.env` 的 `PORT=4000` 改成 `PORT=4100`，并把 Nginx 里所有 `127.0.0.1:4000` 改成 `127.0.0.1:4100`。
- 新服务器的新 PostgreSQL 数据库不会自动拥有本地配置过的积分套餐、模型配置、系统设置或用户积分；上线后需要登录 `https://域名/admin.html` 重新配置，或另行做数据库备份恢复。
- 管理后台只填写 URL 和 Key 还不够。还必须完成环境变量、数据库迁移、systemd、Nginx、HTTPS、模型启用、积分套餐/兑换码等步骤。

## 外部参考

- NodeSource Node.js Binary Distributions: https://github.com/nodesource/distributions
- PostgreSQL Debian packages: https://www.postgresql.org/download/linux/debian/
- Certbot Nginx instructions: https://certbot.eff.org/instructions
