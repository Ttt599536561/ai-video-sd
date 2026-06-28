# AI Video Backend

MVP backend for the AI video generation product.

## Stack

- Fastify + TypeScript
- PostgreSQL via Prisma schema and Prisma-backed runtime store
- Local mock video provider for current job state transitions
- OpenAI Video-compatible provider adapter for supplier model listing, submit payloads, status mapping, content download, and provider error detail parsing
- Redis/BullMQ background status sync for real provider jobs
- Vitest tests for credit and redemption rules

## Local Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm test
npm run build
```

For PostgreSQL/Redis local services:

```bash
docker compose up -d postgres redis
npm run prisma:deploy
npm run dev
```

If Docker is not installed locally, install PostgreSQL 17 or use another PostgreSQL instance, then set:

```text
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_video
```

Development table sync without creating a migration:

```bash
npm run prisma:push
```

Production table creation on a server:

```bash
npm run prisma:deploy
```

The API uses PostgreSQL persistence whenever `DATABASE_URL` is set. If `DATABASE_URL` is missing, it falls back to `InMemoryStore` and prints a warning; that mode loses users, passwords, credits, codes, and records whenever the API process restarts.

Required local environment values include a stable model-config encryption key:

```text
MODEL_CONFIG_ENCRYPTION_KEY_BASE64=base64-encoded-32-byte-key
```

Use `MODEL_CONFIG_ENCRYPTION_KEY_HEX` instead if you prefer a hex-encoded 32-byte key.

Production key rotation can use a versioned keyring while keeping old ciphertext readable:

```text
MODEL_CONFIG_ENCRYPTION_KEYS=1:base64:old-32-byte-key,2:base64:new-32-byte-key
MODEL_CONFIG_ENCRYPTION_CURRENT_KEY_VERSION=2
```

New or updated model keys are encrypted with the current version. Existing rows use their stored `keyVersion`; rows without a stored version are treated as version `1`. To migrate old ciphertexts after deploying a keyring, run a dry run first:

```bash
npm run model-keys:migrate
```

Then apply only after checking the counts and keeping the old key available:

```bash
npm run model-keys:migrate -- --apply
```

The migration prints counts and versions only; it must not print plaintext provider keys.

For the current supplier integration:

```text
VIDEO_PROVIDER_BASE_URL=https://zz1cc.cc.cd
VIDEO_PROVIDER_API_KEY=<backend-env-only-provider-key>
VIDEO_PROVIDER_REAL_JOBS=true
REDIS_URL=redis://127.0.0.1:6379
VIDEO_STORAGE_DIR=storage/videos
REQUEST_BODY_LIMIT_BYTES=67108864
```

Keep provider secrets in `.env` only; do not place them in frontend files or docs.

Reference media uploaded from the static frontend is submitted to the backend as data URLs. When real provider jobs are enabled, the backend stores those reference images/videos/audios under `VIDEO_STORAGE_DIR` and sends supplier-fetchable URLs to the provider. Set the public API origin in Admin -> System Settings after deployment, for example:

```text
https://api.example.com
```

The saved admin setting takes precedence over `PUBLIC_API_BASE_URL`. If neither is configured, the API can infer a non-local request host. Do not use `localhost`, `127.0.0.1`, private IPs, or a domain with an expired HTTPS certificate; suppliers verify TLS when fetching reference media.

## Run API

```bash
npm run dev
```

Default API URL:

```text
http://127.0.0.1:4000
```

Health check:

```bash
curl http://127.0.0.1:4000/health
```

Supplier smoke test:

```bash
npm run provider:smoke
```

This only calls `GET /v1/models`; it does not create a supplier video task.
User-created jobs submit real supplier `POST /v1/videos` when `VIDEO_PROVIDER_REAL_JOBS=true`. The current local environment has real generation enabled by user request; turn the flag off only when intentionally returning to the local Mock Provider path.

The first approved real small-traffic test submitted one `POST /v1/videos` and the supplier returned `HTTP 403: insufficient_user_quota - 用户额度不足, 剩余额度: ＄35.000000, 最低保留额度: ＄9.000000`. No provider task id or video asset was created. The user later recharged the supplier quota and explicitly requested continuous real generation; subsequent user testing reported that real video generation can succeed.

## First Admin

Set `BOOTSTRAP_ADMIN_SECRET` in `.env`, then call:

```bash
curl -X POST http://127.0.0.1:4000/api/auth/bootstrap-admin \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@example.com\",\"password\":\"password123\",\"bootstrapSecret\":\"use-once-then-remove\"}"
```

Remove or rotate `BOOTSTRAP_ADMIN_SECRET` after creating the first admin.

## Key APIs

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/bootstrap-admin`
- `POST /api/admin/redemption-batches`
- `GET /api/admin/redemption-codes`
- `POST /api/credits/redeem`
- `GET /api/credits/redemptions`
- `POST /api/admin/model-configs`
- `PATCH /api/admin/model-configs/:id`
- `DELETE /api/admin/model-configs/:id`
- `GET /api/admin/provider-models`
- `POST /api/admin/model-configs/:id/test-provider`
- `GET /api/admin/system-settings`
- `PATCH /api/admin/system-settings`
- `POST /api/admin/credit-packages`
- `PATCH /api/admin/credit-packages/:id`
- `DELETE /api/admin/credit-packages/:id`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/adjust-credits`
- `POST /api/video/jobs`
- `GET /api/video/jobs`
- `GET /api/video/job-records`
- `DELETE /api/video/jobs/:id` returns 405; user task records cannot be deleted
- `POST /api/video/jobs/:id/process` for local mock processing
- `POST /api/video/jobs/:id/sync` for manual real supplier status sync fallback or enqueue
- `GET /api/video/jobs/:id/download-url`
- `GET /api/video/assets`
- `DELETE /api/video/assets/:id` for deleting a project video asset record without deleting the task record
- `GET /api/video/assets/:id/download-url`
- `GET /api/video/assets/:id/download`
- `GET /api/video/reference-assets/:jobId/:filename` public supplier-fetch route for saved reference media

`POST /api/video/jobs` accepts optional reference media arrays. The current limits are `images` up to 4 items, `videos` up to 3 items, and `audios` up to 1 item; these arrays are forwarded to the OpenAI Video-style supplier payload as `images`, `videos`, and `audios` when real jobs are enabled.

Reference media is submitted as JSON/base64 data URLs from the static frontend. `REQUEST_BODY_LIMIT_BYTES` controls the maximum JSON body size; the default is 64 MiB so normal reference image uploads do not fail at the Fastify parser layer. For real provider jobs, non-HTTP reference media is stored locally and converted to `/api/video/reference-assets/...` URLs before being submitted to the supplier. Existing HTTP(S) reference URLs are passed through unchanged.

Video job records include user-facing metadata for both the admin console and user generation-records page: model display name, provider model id, prompt, resolution, aspect ratio/size, requested duration, reference image/video/audio counts, cost, status, and `generationDurationSeconds`. The generation duration is computed as `completedAt - createdAt` in seconds and is `null` for unfinished jobs. User-facing job records intentionally omit `completedAt`, video URLs, storage keys, and provider task ids.

Redemption record APIs include `validityDays`, measured in days after redemption. Permanent codes return `null` and should be displayed as permanent in the frontend.

Frontend pages use `localStorage.apiBase` when present. Without that override, local `127.0.0.1`/`localhost` pages use `http://127.0.0.1:4000`, while production pages use `window.location.origin` so Nginx can proxy same-origin `/api/...` requests.

## Admin Behavior Notes

- `/api/admin/users` excludes `ADMIN` accounts from the user-management list.
- Deleting an unused model config removes it from storage.
- Deleting a model config that is referenced by existing video jobs soft-deletes it by setting `deletedAt`, disables it, and hides it from both admin model config lists and public `/api/models`; historical video jobs remain available.
- Browser CORS allows `GET,HEAD,POST,PATCH,DELETE`.
- Frontend helpers only send `Content-Type: application/json` when a request has a body; bodyless `DELETE` requests should not declare JSON content type.
- Admin model names are loaded from the supplier model list and saved as the real provider `modelName`.
- Admin-editable `displayName` is what users see in the frontend model selector; generation requests still submit `modelName`.
- Admin System Settings stores the public API base URL used for supplier reference-media fetches. The value is persisted in PostgreSQL and should be the HTTPS origin that reaches this backend through Nginx.
- New production servers start with an empty PostgreSQL database unless restored from backup. Recreate admin-side system settings, model configs, credit packages, redemption batches, and user credits after deployment.
- A healthy `/health` response is not enough for supplier reference-media fetches; the public API origin must also proxy `/api/video/reference-assets/...` to this backend and serve the uploaded reference file over a valid public HTTPS URL.
- User video generation uses the real supplier when `VIDEO_PROVIDER_REAL_JOBS=true`; turning that flag off returns jobs to `MockVideoProvider`. If `REDIS_URL` is configured, BullMQ scans active provider-backed jobs in the background, syncs `GET /v1/videos/{id}`, downloads `/content`, stores output locally, and exposes signed download links.
- Supplier non-2xx responses are parsed for common JSON/text error fields such as `error.code`, `error.message`, `error_code`, `error_msg`, `code`, `message`, and `error_message`; provider keys must never be logged or returned.
- Supplier TLS failures while fetching reference media, including expired HTTPS certificates, map to `PUBLIC_API_BASE_URL_CERT_INVALID` so admins see an actionable certificate message instead of raw provider JSON.
- Frontend polling only refreshes `/api/video/jobs`; it no longer batches supplier status sync calls from the browser.
- The task queue and project videos are intentionally separate: video job records are immutable from the user side, while project video cards are backed by video asset records and can be deleted via `/api/video/assets/:id`.

## Persistence Notes

- Runtime persistence is handled by `PrismaBackedStore`.
- `PrismaBackedStore` loads PostgreSQL rows at startup and flushes changed in-memory state after POST/PATCH/DELETE requests.
- Project-video deletion removes the video asset record from persisted state while leaving the referenced video job record intact.
- System settings are persisted in `system_settings`; deploy migrations before starting code that expects this table.
- This keeps the current service layer stable for the MVP; later work can replace it with direct Prisma repositories per module.
- Current migrations include the initial schema, permanent redemption-code support, `model_configs.deleted_at` for soft deletion, video job metadata, credit package purchase URLs, and `system_settings`.
- Previously registered in-memory users cannot be recovered after the old API process restarted.
- On Windows, if `npm run prisma:generate` fails because a Prisma DLL is locked, stop the running API process first and rerun the command.

## Local Test Admin

```text
admin-code-1782584735007@example.com / password123
```
