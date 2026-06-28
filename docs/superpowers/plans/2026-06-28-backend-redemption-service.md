# Backend Redemption Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working backend MVP for auth, admin model/package management, redemption-code generation and redemption, credit ledger, and video-job placeholders.

**Architecture:** A modular Fastify API written in TypeScript. Business logic is isolated in services over repository interfaces so core credit/redemption rules can be tested without a live database; Prisma/PostgreSQL schema and Docker Compose are included for production persistence.

**Tech Stack:** Node.js 24, TypeScript, Fastify, Prisma/PostgreSQL, Vitest, bcryptjs, jsonwebtoken, zod, Docker Compose.

**Current Status (2026-06-28):** The backend MVP from this plan has been implemented. The actual HTTP routes are centralized in `backend/src/app.ts` instead of split route files. Docker Compose currently includes API, PostgreSQL, and Redis. Real supplier content download now writes to local `VIDEO_STORAGE_DIR` with signed access and 3-day cleanup; MinIO/S3-compatible object storage remains a later production hardening option.

---

### Task 1: Project Scaffold

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/.env.example`
- Create: `backend/README.md`

- [x] ~~Write package and TypeScript config.~~
- [x] ~~Install dependencies.~~
- [x] ~~Verify `npm test` can run.~~

### Task 2: Core Domain Tests First

**Files:**
- Create: `backend/src/test/redemption.service.test.ts`
- Create: `backend/src/test/auth.service.test.ts`

- [x] ~~Write failing tests for admin redemption-code batch generation.~~
- [x] ~~Write failing tests for successful code redemption and credit ledger creation.~~
- [x] ~~Write failing tests for duplicate and invalid redemption codes.~~
- [x] ~~Write failing tests for email registration/login password hashing.~~
- [x] ~~Run tests and verify failure due to missing modules.~~

### Task 3: Domain Services

**Files:**
- Create: `backend/src/domain/types.ts`
- Create: `backend/src/repositories/memory-store.ts`
- Create: `backend/src/services/crypto.service.ts`
- Create: `backend/src/services/auth.service.ts`
- Create: `backend/src/services/redemption.service.ts`
- Create: `backend/src/services/admin.service.ts`
- Create: `backend/src/services/video.service.ts`

- [x] ~~Implement in-memory repository for tests and local dev.~~
- [x] ~~Implement secure random redemption-code generation.~~
- [x] ~~Store redemption codes by hash and redeem inside a lock-like critical section in memory.~~
- [x] ~~Implement credit ledger updates and duplicate redemption prevention.~~
- [x] ~~Implement auth registration/login with bcrypt hash and JWT issuing.~~

### Task 4: HTTP API

**Files:**
- Create: `backend/src/app.ts`
- Create: `backend/src/server.ts`
- Create: `backend/src/routes/auth.routes.ts`
- Create: `backend/src/routes/credit.routes.ts`
- Create: `backend/src/routes/admin.routes.ts`
- Create: `backend/src/routes/video.routes.ts`
- Create: `backend/src/http/auth-middleware.ts`

- [x] ~~Build Fastify app with typed routes.~~
- [x] ~~Add auth endpoints.~~
- [x] ~~Add credit balance, ledger, and redeem endpoints.~~
- [x] ~~Add admin model config, package, user, redemption batch, and record endpoints.~~
- [x] ~~Add video-job placeholder endpoints.~~

### Task 5: Database and Deployment

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/docker-compose.yml`
- Create: `backend/Dockerfile`
- Create: `backend/src/repositories/prisma-store.ts`

- [x] ~~Encode PostgreSQL schema from the architecture document.~~
- [x] ~~Add Docker Compose for API, PostgreSQL, and Redis.~~
- [ ] Add MinIO/S3-compatible object-storage service if production requirements outgrow local `VIDEO_STORAGE_DIR`.
- [x] ~~Add Prisma repository adapter skeleton.~~
- [x] ~~Document migration and startup commands.~~

### Task 6: Verification

**Files:**
- Modify: `docs/backend-architecture-redemption-research.md`

- [x] ~~Run `npm test`.~~
- [x] ~~Run TypeScript build.~~
- [x] ~~Verify docs mention backend path and startup commands.~~
