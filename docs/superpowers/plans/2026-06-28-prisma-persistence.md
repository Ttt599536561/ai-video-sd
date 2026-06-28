# Prisma Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local and production backend runs persist users, passwords, credits, redemption codes, models, packages, and video jobs in PostgreSQL/Prisma instead of losing data on process restart.

**Architecture:** Keep the current service layer stable for this pass by introducing a Prisma-backed store that loads rows into the existing in-memory shape at startup and flushes changed state to PostgreSQL after mutating requests. This solves the immediate restart-data-loss problem without a large service-layer rewrite; direct Prisma repositories can replace this adapter later.

**Tech Stack:** Fastify, TypeScript, Prisma Client, PostgreSQL, Vitest.

---

### Task 1: Persistence Regression Test

**Files:**
- Create: `backend/src/test/prisma-persistence.test.ts`

- [x] ~~Write a failing test that registers a user, flushes to Prisma, creates a fresh store, reloads from Prisma, and logs in with the same password.~~
- [x] ~~Run the test before implementation and verify it fails because the Prisma persistence API does not exist.~~

### Task 2: Prisma Store Adapter

**Files:**
- Modify: `backend/src/repositories/prisma-store.ts`
- Modify: `backend/src/app.ts`

- [x] ~~Implement `PrismaBackedStore.create(prisma)`, `load()`, and `flush()`.~~
- [x] ~~Map Prisma rows to existing domain objects.~~
- [x] ~~Upsert users, ledgers, redemption batches/codes/attempts, credit packages, model configs, video jobs, and video assets.~~
- [x] ~~Add an `onResponse` flush hook for mutating requests when the app receives a persistent store.~~

### Task 3: Server Runtime Switch

**Files:**
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`

- [x] ~~Use Prisma-backed store by default when `DATABASE_URL` is configured.~~
- [x] ~~Keep `USE_IN_MEMORY_STORE=true` as an explicit local escape hatch.~~
- [x] ~~Ensure shutdown disconnects Prisma.~~

### Task 4: Local Database Setup

**Files:**
- Modify: `backend/README.md`
- Modify: `docs/context/current-session.md`

- [x] ~~Document `docker compose up -d postgres redis`.~~
- [x] ~~Document `npm run prisma:deploy` and `npm run dev`.~~
- [x] ~~Note that old in-memory users are not recoverable after previous restarts.~~

### Task 5: Verification

**Commands:**
- [x] ~~`npm run prisma:generate`~~
- [x] ~~`npm test`~~
- [x] ~~`npm run build`~~
- [x] ~~Real local API check against PostgreSQL: register, restart/reload store, login succeeds.~~

**Final local state:** Docker Desktop is installed; `backend-postgres-1` and `backend-redis-1` are running; `DATABASE_URL` uses `127.0.0.1:5432`; backend logs show `Using PostgreSQL/Prisma persistent store.`
