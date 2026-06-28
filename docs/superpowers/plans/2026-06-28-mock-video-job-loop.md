# Mock Video Job Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local mock video lifecycle so jobs leave `PENDING`, create output assets on success, and refund credits on failure.

**Architecture:** Extend `VideoService` with explicit processing methods and a mock provider. Add one HTTP route for local processing and keep the UI polling existing job APIs.

**Tech Stack:** Fastify, TypeScript, Vitest, plain HTML/CSS/JavaScript.

---

## Tasks

### Task 1: Service State Machine

- [x] ~~Add failing tests in `backend/src/test/video.service.test.ts` for successful processing, failed processing refund, and idempotent refunds.~~
- [x] ~~Run `npm test -- src/test/video.service.test.ts` and confirm failure.~~
- [x] ~~Add `backend/src/services/mock-video-provider.ts`.~~
- [x] ~~Extend `backend/src/services/video.service.ts` with `processJob`, `succeedJob`, and `failJob`.~~
- [x] ~~Run `npm test -- src/test/video.service.test.ts` and confirm pass.~~

### Task 2: HTTP Process Route

- [x] ~~Add a failing route test in `backend/src/test/app.routes.test.ts` for `POST /api/video/jobs/:id/process`.~~
- [x] ~~Run `npm test -- src/test/app.routes.test.ts` and confirm failure.~~
- [x] ~~Add route handler in `backend/src/app.ts`.~~
- [x] ~~Run `npm test -- src/test/app.routes.test.ts` and confirm pass.~~

### Task 3: User Polling

- [x] ~~Add frontend shell assertions for polling and process route references.~~
- [x] ~~Run `npm test -- src/test/user-frontend.test.ts` and confirm failure.~~
- [x] ~~Update `index.html` to poll jobs and offer local mock processing after generation.~~
- [x] ~~Run `npm test -- src/test/user-frontend.test.ts` and confirm pass.~~

### Task 4: Final Verification

- [x] ~~Run `npm test`.~~
- [x] ~~Run `npm run build`.~~
- [x] ~~Run inline HTML script syntax check.~~
