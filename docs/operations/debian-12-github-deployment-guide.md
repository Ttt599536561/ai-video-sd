# Debian 12 从 GitHub 部署 AI 生视频项目步骤

本文档适用于一台 Debian 12.0 64bit 服务器。服务器上可以已经部署其他项目，本项目会使用独立目录、独立数据库、独立 systemd 服务和独立 Nginx 站点配置，默认后端端口为 `4000`。如果服务器已有项目也占用了 `4000`，请按本文“端口冲突处理”改成其他端口。

当前项目已经完成生产上线，并已成功更新 `favicon.svg` 站点图标补丁。本文前半部分仍保留给新服务器从零部署使用；已上线服务器只更新代码时，直接看第 22 节“部署后更新代码”。

## 0. 你需要先准备什么

- 一台 Debian 12.0 64bit 服务器，并能用 SSH 登录。
- 一个域名，例如 `tangguo.xin` 或 `api.tangguo.xin`，DNS A 记录指向服务器公网 IP。
- GitHub 仓库地址：`https://github.com/Ttt599536561/ai-video-sd.git`。
- 供应商信息：供应商基础 URL，例如 `https://zz1cc.cc.cd`，以及供应商 API Key。
- 服务器开放端口：`80`、`443`，SSH 端口通常是 `22`。

重要：未上线服务器时，真实供应商无法访问你本地电脑里的参考图片。上传图片/视频/音频参考素材并真实生成，必须满足“公网 HTTPS 地址能访问本项目后端的 `/api/video/reference-assets/...`”。

## 1. 在本机把代码推送到 GitHub

在项目根目录执行：

```bash
git init
```

说明：初始化本地 Git 仓库。

```bash
git add .
```

说明：把项目文件加入暂存区。项目已配置 `.gitignore`，不会提交 `backend/.env`、日志、`node_modules`、`backend/storage`、`backend/dist` 等本地运行产物和密钥文件。

```bash
git commit -m "chore: initial ai video project"
```

说明：创建第一次提交。

```bash
git remote add origin https://github.com/Ttt599536561/ai-video-sd.git
```

说明：绑定 GitHub 远程仓库。如果提示 `remote origin already exists`，改用 `git remote set-url origin https://github.com/Ttt599536561/ai-video-sd.git`。

```bash
git branch -M main
```

说明：把当前分支命名为 `main`。

```bash
git push -u origin main
```

说明：推送到 GitHub。第一次推送可能需要 GitHub 登录或 Personal Access Token。

## 2. 登录服务器

在本机终端执行：

```bash
ssh root@你的服务器公网IP
```

说明：用 root 登录服务器。若你的云厂商给的是普通用户，例如 `debian`，则使用 `ssh debian@你的服务器公网IP`，后续命令前面保留 `sudo`。

查看服务器系统：

```bash
cat /etc/os-release
```

说明：确认是 Debian 12。

查看公网 IP：

```bash
curl -4 ifconfig.me
```

说明：输出的 IP 就是你可以在域名 DNS A 记录里填写的服务器公网 IPv4。

## 3. 安装系统依赖

```bash
sudo apt update
```

说明：刷新 Debian 软件包索引。

```bash
sudo apt install -y ca-certificates curl gnupg git nginx postgresql postgresql-contrib redis-server certbot python3-certbot-nginx
```

说明：安装 Git、Nginx、PostgreSQL、Redis、Certbot 等生产依赖。

安装 Node.js 24：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
```

说明：添加 NodeSource Node.js 24 软件源。不要使用 Debian 默认旧版 Node。

```bash
sudo apt install -y nodejs
```

说明：安装 Node.js 和 npm。

```bash
node -v
npm -v
```

说明：确认 Node.js 已安装，`node -v` 应显示 `v24.x` 或兼容版本。

## 4. 检查端口是否被其他项目占用

```bash
sudo ss -lntp
```

说明：查看当前监听端口。重点看是否已有服务占用 `:4000`、`:80`、`:443`。

如果 `4000` 没被占用，本项目默认用 `4000`。如果 `4000` 已被占用，本文后续把 `PORT=4000` 改成 `PORT=4100`，Nginx 的 `proxy_pass` 也改成 `127.0.0.1:4100`。

同一台服务器允许部署多个项目，关键是：

- 每个后端使用不同端口，例如已有项目用 `3000`，本项目用 `4000` 或 `4100`。
- 每个项目用不同 systemd 服务名。
- 每个项目用不同目录。
- Nginx 根据不同域名或不同路径转发到不同端口。

## 5. 创建项目用户和目录

```bash
sudo adduser --system --group --home /opt/ai-video --no-create-home ai-video
```

说明：创建专用系统用户 `ai-video`，避免用 root 跑后端。`--no-create-home` 可以避免 `/opt/ai-video` 被提前写入隐藏文件，确保后续 `git clone` 的目标目录是空目录。

```bash
sudo mkdir -p /opt/ai-video /var/www/ai-video /etc/ai-video /var/lib/ai-video/storage/videos /var/backups/ai-video
```

说明：创建代码目录、静态前端目录、环境变量目录、视频缓存目录和备份目录。

```bash
sudo chown -R ai-video:ai-video /opt/ai-video /var/lib/ai-video
sudo chown -R www-data:www-data /var/www/ai-video
sudo chmod 0750 /var/lib/ai-video /var/lib/ai-video/storage /var/lib/ai-video/storage/videos
```

说明：设置目录权限。

## 6. 从 GitHub 拉取代码

```bash
sudo -u ai-video git clone https://github.com/Ttt599536561/ai-video-sd.git /opt/ai-video
```

说明：把 GitHub 仓库拉到服务器 `/opt/ai-video`。如果目录不是空的，先确认没有重要文件后再清理。

如果以后更新代码，在服务器执行：

```bash
cd /opt/ai-video
sudo -u ai-video git pull origin main
```

说明：拉取最新代码。

## 7. 创建 PostgreSQL 数据库

生成数据库密码：

```bash
DB_PASS="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)"
echo "$DB_PASS"
```

说明：生成一个只含字母数字的数据库密码。把输出保存好，下一步要用。

进入 PostgreSQL：

```bash
sudo -u postgres psql
```

说明：进入数据库管理终端。

在 PostgreSQL 里执行，先把 `REPLACE_DB_PASSWORD` 替换成刚生成的密码：

```sql
CREATE USER ai_video_user WITH PASSWORD 'REPLACE_DB_PASSWORD';
CREATE DATABASE ai_video OWNER ai_video_user;
\q
```

说明：创建本项目独立数据库用户和数据库，不影响服务器上的其他项目。

## 8. 创建生产环境变量

```bash
sudo cp /opt/ai-video/deploy/debian/backend.env.example /etc/ai-video/backend.env
```

说明：复制环境变量模板。

```bash
sudo chown root:ai-video /etc/ai-video/backend.env
sudo chmod 0640 /etc/ai-video/backend.env
```

说明：限制环境变量文件权限，避免密钥被普通用户读取。

生成几个密钥：

```bash
openssl rand -base64 48
```

说明：生成 `JWT_SECRET`，复制输出备用。

```bash
openssl rand -base64 48
```

说明：生成 `REDEMPTION_HASH_SECRET`，复制输出备用。

```bash
openssl rand -base64 32
```

说明：生成 `MODEL_CONFIG_ENCRYPTION_KEY_BASE64`，必须长期保存，不能丢。这个 Key 用来解密管理后台保存的供应商 Key。

编辑环境变量：

```bash
sudo nano /etc/ai-video/backend.env
```

说明：在服务器终端编辑生产配置。至少修改这些值：

```env
NODE_ENV=production
PORT=4000
DATABASE_URL="postgresql://ai_video_user:你的数据库密码@127.0.0.1:5432/ai_video"
USE_IN_MEMORY_STORE=false
JWT_SECRET="刚生成的 JWT_SECRET"
REDEMPTION_HASH_SECRET="刚生成的 REDEMPTION_HASH_SECRET"
BOOTSTRAP_ADMIN_SECRET="你自定义的首次创建管理员密钥"
MODEL_CONFIG_ENCRYPTION_KEY_BASE64="刚生成的 32 字节 base64 key"
REDIS_URL="redis://127.0.0.1:6379"
VIDEO_PROVIDER_BASE_URL="https://zz1cc.cc.cd"
VIDEO_PROVIDER_API_KEY="REPLACE_WITH_PROVIDER_API_KEY_OR_LEAVE_EMPTY"
VIDEO_PROVIDER_REAL_JOBS=true
VIDEO_STORAGE_DIR="/var/lib/ai-video/storage/videos"
REQUEST_BODY_LIMIT_BYTES=67108864
```

说明：

- 如果 `4000` 被其他项目占用，把 `PORT=4000` 改成 `PORT=4100`，后续 Nginx 和 systemd 检查也用 `4100`。
- 生产环境必须填写 `DATABASE_URL` 并保持 `USE_IN_MEMORY_STORE=false`。如果漏填，后端会拒绝启动；不要在生产使用 `USE_IN_MEMORY_STORE=true`，否则重启会丢用户、积分、套餐、兑换码和模型配置。
- `VIDEO_PROVIDER_API_KEY` 是后台读取供应商模型列表时使用的默认供应商 Key。若你不想把它写在环境变量里，也可以先留空，但后台自动读取模型列表会失败；这种情况下需要在“模型配置”里手动填写真实模型 ID、供应商 URL 和模型 Key。
- `REQUEST_BODY_LIMIT_BYTES=67108864` 是后端 JSON 请求体上限。前端会把参考图片/视频/音频转成 data URL 提交，其中参考视频+参考音频原始文件总大小已限制为 36MB，避免上线后触发后端或 Nginx body limit。
- 不要把这些真实值提交到 GitHub。

## 9. 安装后端依赖并构建

```bash
cd /opt/ai-video/backend
```

说明：进入后端目录。

```bash
sudo -u ai-video npm ci
```

说明：按 `package-lock.json` 安装依赖，适合生产部署。

```bash
sudo -u ai-video npm run prisma:generate
```

说明：生成 Prisma Client。

```bash
sudo -u ai-video npm run build
```

说明：编译 TypeScript 到 `backend/dist`。

## 10. 执行数据库迁移

```bash
sudo -u ai-video bash -lc 'set -a; . /etc/ai-video/backend.env; set +a; cd /opt/ai-video/backend && npm run prisma:deploy'
```

说明：加载生产环境变量，并创建/更新数据库表。必须执行，否则管理后台系统设置、模型配置、视频任务等表可能不存在。

## 11. 部署静态前端

```bash
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/auth.html /var/www/ai-video/auth.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/index.html /var/www/ai-video/index.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/admin.html /var/www/ai-video/admin.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/favicon.svg /var/www/ai-video/favicon.svg
```

说明：把登录页、用户端、管理后台复制到 Nginx 静态目录。

## 12. 配置 systemd 后台服务

```bash
sudo cp /opt/ai-video/deploy/debian/ai-video-api.service /etc/systemd/system/ai-video-api.service
```

说明：安装 systemd 服务文件。

如果你在第 8 步把端口改成 `4100`，不用改 systemd 文件，因为端口来自 `/etc/ai-video/backend.env`。

```bash
sudo systemctl daemon-reload
```

说明：让 systemd 重新读取服务配置。

```bash
sudo systemctl enable --now ai-video-api
```

说明：设置开机自启并立即启动后端。

```bash
sudo systemctl status ai-video-api --no-pager
```

说明：查看服务状态，应该是 `active (running)`。

```bash
journalctl -u ai-video-api -n 100 --no-pager
```

说明：查看后端日志。正常应看到 `Using PostgreSQL/Prisma persistent store.` 和 `API listening on http://0.0.0.0:4000`。

本机检查：

```bash
curl -fsS http://127.0.0.1:4000/health
```

说明：如果端口改成 `4100`，这里也改成 `4100`。正常返回 `{"ok":true}`。

## 13. 配置 Nginx

复制模板：

```bash
sudo cp /opt/ai-video/deploy/debian/nginx-ai-video.conf /etc/nginx/sites-available/ai-video
```

说明：安装 Nginx 站点配置。

编辑配置：

```bash
sudo nano /etc/nginx/sites-available/ai-video
```

说明：把 `server_name example.com www.example.com;` 改成你的域名，例如：

```nginx
server_name ai.your-domain.com;
```

如果后端端口是 `4000`，保持：

```nginx
proxy_pass http://127.0.0.1:4000;
```

如果后端端口改成 `4100`，把所有 `127.0.0.1:4000` 改成：

```nginx
127.0.0.1:4100
```

启用站点：

```bash
sudo ln -sf /etc/nginx/sites-available/ai-video /etc/nginx/sites-enabled/ai-video
```

说明：启用这个 Nginx 站点。

```bash
sudo nginx -t
```

说明：检查 Nginx 配置语法。

```bash
sudo systemctl reload nginx
```

说明：重载 Nginx。

HTTP 检查：

```bash
curl -fsS http://你的域名/health
```

说明：正常返回 `{"ok":true}`。如果不是，说明域名或 Nginx 没有转到本项目后端。

## 14. 配置 HTTPS 证书

```bash
sudo certbot --nginx -d 你的域名
```

说明：用 Certbot 自动申请并配置 HTTPS 证书。如果同一个站点有多个域名，可以追加多个 `-d`。

```bash
sudo systemctl reload nginx
```

说明：重载 Nginx。

HTTPS 检查：

```bash
curl -fsS https://你的域名/health
```

说明：正常必须返回 `{"ok":true}`。供应商抓取参考素材也依赖这个 HTTPS 域名。

## 15. 创建第一个管理员

确认 `/etc/ai-video/backend.env` 里还保留 `BOOTSTRAP_ADMIN_SECRET`，然后执行：

```bash
curl -X POST https://你的域名/api/auth/bootstrap-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"你的管理员邮箱","password":"你的管理员密码至少8位","bootstrapSecret":"BOOTSTRAP_ADMIN_SECRET的值"}'
```

说明：创建第一个管理员账号。这个接口只用于全新数据库的第一个管理员；数据库里已经存在管理员后，再次调用会返回 `ADMIN_BOOTSTRAP_DISABLED`，不需要也不能用它重复注册管理员。

创建成功后，立即编辑环境变量文件：

```bash
sudo nano /etc/ai-video/backend.env
```

说明：删除或注释 `BOOTSTRAP_ADMIN_SECRET`，避免保留一次性引导密钥。即使忘记删除，后端也会在已有管理员时拒绝再次 bootstrap，但生产仍应移除该密钥。

```bash
sudo systemctl restart ai-video-api
```

说明：重启后端让配置生效。

## 16. 打开后台管理

浏览器访问：

```text
https://你的域名/admin.html
```

说明：用刚创建的管理员账号登录。

## 17. 后台需要重新配置哪些东西

如果这是全新服务器、全新数据库，你本地刚配置过的内容不会自动存在于服务器数据库里。你需要重新配置：

- 系统设置里的“公网 API 地址”。
- 模型配置里的模型名、显示名、供应商基础 URL、提交路径、鉴权方式、供应商 Key、消耗积分。
- 积分套餐。
- 兑换码批次。
- 用户账号和用户积分。

原因：这些配置保存在本地 PostgreSQL 数据库里，不在 GitHub 代码仓库里。部署到新服务器后，服务器有自己的 PostgreSQL 数据库。

如果你想保留本地配置，需要做数据库迁移/备份恢复。但本地是开发库，通常不建议直接覆盖生产库。

管理员账号也属于数据库数据。全新数据库需要重新创建第一个管理员；如果你恢复了旧数据库且里面已有管理员，就不要再次执行 bootstrap，直接用旧管理员账号登录。

## 18. 管理后台应该怎么填

### 系统设置

公网 API 地址填写：

```text
https://你的域名
```

说明：这个地址必须能访问当前项目后端。验证命令：

```bash
curl -fsS https://你的域名/health
```

必须返回：

```json
{"ok":true}
```

### 模型配置

供应商基础 URL 填：

```text
https://zz1cc.cc.cd
```

提交路径填：

```text
/v1/videos
```

鉴权方式选：

```text
BEARER
```

模型名选择或输入供应商返回的真实模型 ID，例如：

```text
video-ds-2.0
```

或者：

```text
video-ds-2.0-fast
```

如果后台自动读取供应商模型失败，模型名称输入框仍允许手动填写真实模型 ID。API Key 填供应商给你的 Key，这个 Key 会由后端加密保存到数据库，不会保存在前端。

### 积分套餐

需要重新创建。套餐是业务数据，保存在服务器数据库里，不会随 GitHub 代码部署自动出现。

## 19. 是否只要在管理后台填 URL 和 Key 就可以

不是只填 URL 和 Key。至少还需要：

1. 后端环境变量配置正确，尤其是 `DATABASE_URL`、`JWT_SECRET`、`REDEMPTION_HASH_SECRET`、`MODEL_CONFIG_ENCRYPTION_KEY_BASE64`、`REDIS_URL`、`VIDEO_PROVIDER_REAL_JOBS=true`。
2. 数据库迁移已执行：`npm run prisma:deploy`。
3. Nginx 已把 `/api/` 和 `/health` 反代到本项目后端端口。
4. HTTPS 证书有效。
5. 管理后台系统设置填写公网 API 地址。
6. 管理后台模型配置填写供应商 URL、模型 ID、Key、积分消耗并启用模型。
7. 管理后台创建积分套餐，或给测试用户发放积分/兑换码。

环境变量里的 `VIDEO_PROVIDER_BASE_URL` 和 `VIDEO_PROVIDER_API_KEY` 主要用于后台“读取供应商模型列表”和默认供应商连通性；真正用于用户生成任务的是管理后台保存并启用的模型配置。通常部署后需要在管理后台配置模型 URL、模型 ID、Key 和积分消耗。

## 20. 服务器已有另一个项目怎么办

允许再部署一个项目。推荐做法：

- 旧项目保持原目录和原端口。
- 本项目目录固定为 `/opt/ai-video`。
- 本项目 systemd 服务名为 `ai-video-api`。
- 本项目数据库名为 `ai_video`。
- 本项目默认端口 `4000`，如冲突改成 `4100`。
- Nginx 使用单独域名，例如旧项目用 `www.example.com`，本项目用 `ai.example.com`。

检查端口：

```bash
sudo ss -lntp
```

说明：看 `4000` 是否被占用。

如果被占用，编辑：

```bash
sudo nano /etc/ai-video/backend.env
```

把：

```env
PORT=4000
```

改成：

```env
PORT=4100
```

然后编辑 Nginx：

```bash
sudo nano /etc/nginx/sites-available/ai-video
```

把所有：

```nginx
127.0.0.1:4000
```

改成：

```nginx
127.0.0.1:4100
```

重启：

```bash
sudo systemctl restart ai-video-api
sudo nginx -t
sudo systemctl reload nginx
```

说明：重启后端并重载 Nginx。

## 21. 如何用公网 IP 和域名访问

查看服务器公网 IP：

```bash
curl -4 ifconfig.me
```

说明：把输出的 IP 填到域名 DNS 的 A 记录。

DNS 示例：

```text
类型：A
主机记录：ai
记录值：服务器公网IP
```

说明：这样 `ai.你的域名` 会指向服务器。

等待 DNS 生效后检查：

```bash
ping ai.你的域名
```

说明：看解析出来的 IP 是否是服务器公网 IP。

浏览器访问：

```text
https://ai.你的域名/auth.html
```

管理后台访问：

```text
https://ai.你的域名/admin.html
```

## 22. 部署后更新代码

以后你在本地更新代码并推送 GitHub 后，在服务器执行：

### 22.1 已验证的静态前端补丁更新方式

`favicon.svg` 站点图标补丁已经在生产服务器更新成功。类似只改静态前端文件、没有新增数据库迁移、没有修改后端运行逻辑的补丁，已上线服务器可以只更新代码和静态前端文件：

```bash
cd /opt/ai-video
sudo -u ai-video git pull origin main
```

说明：从 GitHub 拉取最新代码。

```bash
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/auth.html /var/www/ai-video/auth.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/index.html /var/www/ai-video/index.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/admin.html /var/www/ai-video/admin.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/favicon.svg /var/www/ai-video/favicon.svg
```

说明：把最新前端静态文件复制到 Nginx 站点目录。只要页面引用了新增静态文件，就必须一起复制，否则浏览器会请求到 404。

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://你的域名/health
curl -I https://你的域名/favicon.svg
```

说明：检查 Nginx 配置、重载 Nginx，并确认后端健康和站点图标可访问。`curl -I https://你的域名/favicon.svg` 应返回 `200`。

这类静态补丁不需要重新创建管理员，不需要重新配置积分套餐，不需要重新填写供应商 URL/Key，也不需要清空或重建数据库。

### 22.2 通用完整更新方式

如果以后的更新包含后端代码、依赖或 Prisma migration，使用完整更新流程：

```bash
cd /opt/ai-video
sudo -u ai-video git pull origin main
```

说明：拉取最新代码。

```bash
cd /opt/ai-video/backend
sudo -u ai-video npm ci
sudo -u ai-video npm run prisma:generate
sudo -u ai-video npm run build
```

说明：更新依赖、Prisma Client 和编译产物。

```bash
sudo -u ai-video bash -lc 'set -a; . /etc/ai-video/backend.env; set +a; cd /opt/ai-video/backend && npm run prisma:deploy'
```

说明：执行新增数据库迁移。

```bash
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/auth.html /var/www/ai-video/auth.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/index.html /var/www/ai-video/index.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/admin.html /var/www/ai-video/admin.html
sudo install -o www-data -g www-data -m 0644 /opt/ai-video/favicon.svg /var/www/ai-video/favicon.svg
```

说明：更新前端静态文件。

```bash
sudo systemctl restart ai-video-api
sudo nginx -t
sudo systemctl reload nginx
```

说明：重启后端并确认 Nginx 配置有效。

## 23. 常见错误

### Public API reference media URL is not reachable: HTTP 404

说明：供应商或后端自检访问公网参考图 URL 时拿到 404。

检查：

```bash
curl -fsS https://你的域名/health
```

必须返回 `{"ok":true}`。

检查 Nginx 是否代理 `/api/`：

```bash
curl -I https://你的域名/api/video/reference-assets/随便的job/随便的文件.jpg
```

如果是 404，不一定错，因为文件可能不存在；但真实任务保存文件后，同路径必须能返回图片。重点确认 Nginx 配置里有：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000;
}
```

### REQUEST_BODY_TOO_LARGE 或上传后 Failed to fetch

说明：参考素材作为 base64 JSON 上传，体积超过后端或 Nginx 限制时会失败。

检查：

```bash
grep REQUEST_BODY_LIMIT_BYTES /etc/ai-video/backend.env
sudo grep client_max_body_size /etc/nginx/sites-available/ai-video
```

生产推荐保持：

```text
REQUEST_BODY_LIMIT_BYTES=67108864
client_max_body_size 100m;
```

前端已经限制参考视频+参考音频原始文件总大小不超过 36MB；如果仍然失败，请压缩素材或减少参考素材数量。

### PUBLIC_API_BASE_URL_CERT_INVALID

说明：HTTPS 证书过期或不可验证。

修复：

```bash
sudo certbot renew
sudo systemctl reload nginx
```

### 生成任务一直不更新

检查 Redis：

```bash
sudo systemctl status redis-server --no-pager
```

检查后端日志：

```bash
journalctl -u ai-video-api -n 100 --no-pager
```

### 没有模型可选

登录管理后台，创建并启用模型配置。

### 用户积分不足

管理后台创建积分套餐、兑换码，或给用户调整积分。

## 24. 最终验收清单

执行以下检查：

```bash
curl -fsS http://127.0.0.1:4000/health
```

说明：本机后端健康检查。

```bash
curl -fsS https://你的域名/health
```

说明：公网 HTTPS 健康检查，必须返回 `{"ok":true}`。

```bash
sudo systemctl status ai-video-api --no-pager
```

说明：后端 systemd 服务运行中。

```bash
sudo nginx -t
```

说明：Nginx 配置语法正确。

```bash
sudo ss -lntp
```

说明：确认本项目端口没有和其他项目冲突。
