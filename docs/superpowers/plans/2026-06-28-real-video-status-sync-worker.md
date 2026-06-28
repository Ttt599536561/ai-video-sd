# Real Video Status Sync Worker Implementation Plan

> Current status (2026-06-28): implemented. The unchecked boxes below are the original execution checklist, not the current source of truth. Current behavior is documented in `PROJECT.md`, `docs/modules/video-generation.md`, and `docs/context/current-session.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move real-provider video status sync from frontend-triggered requests into backend background synchronization.

**Architecture:** Add a pure synchronizer around `VideoService.syncJob()`, then wire it to BullMQ as a repeatable Redis-backed scanner at server startup. The frontend keeps polling reads only, while API manual sync becomes a queue/fallback path.

**Tech Stack:** Fastify, TypeScript, BullMQ, Redis, Prisma-backed in-memory store adapter, Vitest.

---

### Task 1: Lock Expected Behavior With Tests

**Files:**
- Create: `backend/src/test/video-status-sync.service.test.ts`
- Modify: `backend/src/test/app.routes.test.ts`
- Modify: `backend/src/test/user-frontend.test.ts`

- [ ] Add tests proving provider-backed active jobs are synchronized in the background scanner, mock jobs are ignored, route-level manual sync can enqueue without provider GET, and frontend polling no longer auto-posts `/sync`.
- [ ] Run targeted tests and verify they fail because the new synchronizer and enqueue behavior do not exist yet.

### Task 2: Implement Synchronizer and BullMQ Adapter

**Files:**
- Create: `backend/src/services/video-status-sync.service.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`

- [ ] Implement `VideoStatusSynchronizer.syncActiveProviderJobs()`.
- [ ] Implement BullMQ queue setup with a repeatable scan job.
- [ ] Wire app routes to enqueue provider-backed jobs after create and manual sync, with inline fallback if no scheduler is configured.
- [ ] Run targeted backend tests and verify they pass.

### Task 3: Remove Frontend Sync Pressure

**Files:**
- Modify: `index.html`
- Modify: `docs/modules/video-generation.md`
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/backend.md`
- Modify: `docs/context/current-session.md`
- Modify: `PROJECT.md`

- [ ] Remove automatic `/sync` calls from frontend job polling.
- [ ] Update docs to describe backend background sync.
- [ ] Run frontend/static tests and verify they pass.

### Task 4: Full Verification

**Files:**
- No additional edits expected.

- [ ] Run `npm test` from `backend/`.
- [ ] Run `npm run build` from `backend/`.
- [ ] Summarize touched files and verification evidence.
