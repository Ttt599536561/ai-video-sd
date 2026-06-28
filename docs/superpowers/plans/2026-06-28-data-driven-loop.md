# Data Driven Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace first-batch static user/admin data with real API-backed data and add missing update APIs.

**Architecture:** Keep the existing Fastify services and single-file static pages. Add small admin PATCH endpoints, then wire frontend render functions to existing and new APIs.

**Tech Stack:** Fastify, TypeScript, Vitest, plain HTML/CSS/JavaScript.

---

## File Structure

- Modify `backend/src/services/admin.service.ts`: add `updateModelConfig` and `updateCreditPackage`.
- Modify `backend/src/app.ts`: add PATCH routes for model configs and credit packages.
- Modify `backend/src/test/app.routes.test.ts`: add failing route tests first.
- Modify `backend/src/test/user-frontend.test.ts`: assert user page uses model/package/video APIs.
- Modify `backend/src/test/admin-frontend.test.ts`: assert admin page uses admin list/update APIs.
- Modify `index.html`: render public models, packages, jobs, and generation/deletion from API data.
- Modify `admin.html`: render admin models/packages/users/jobs and wire basic mutations.

## Tasks

### Task 1: Backend Admin Update APIs

- [x] ~~Write failing tests for `PATCH /api/admin/model-configs/:id` and `PATCH /api/admin/credit-packages/:id`.~~
- [x] ~~Run `npm test -- src/test/app.routes.test.ts` and confirm the new tests fail with 404.~~
- [x] ~~Add service methods and route handlers.~~
- [x] ~~Run `npm test -- src/test/app.routes.test.ts` and confirm the route tests pass.~~

### Task 2: User Page API Rendering

- [x] ~~Add frontend shell tests that look for `/api/models`, `/api/credit-packages`, `/api/video/jobs`, `renderModels`, `renderCreditPackages`, and `renderVideoJobs`.~~
- [x] ~~Run `npm test -- src/test/user-frontend.test.ts` and confirm the new tests fail.~~
- [x] ~~Replace hard-coded user page rendering with API-backed render functions.~~
- [x] ~~Run `npm test -- src/test/user-frontend.test.ts` and confirm the tests pass.~~

### Task 3: Admin Page API Rendering

- [x] ~~Add frontend shell tests that look for admin list/update API paths and render functions.~~
- [x] ~~Run `npm test -- src/test/admin-frontend.test.ts` and confirm the new tests fail.~~
- [x] ~~Replace static admin table behavior with API-backed render functions and form submit handlers.~~
- [x] ~~Run `npm test -- src/test/admin-frontend.test.ts` and confirm the tests pass.~~

### Task 4: Final Verification

- [x] ~~Run `npm test`.~~
- [x] ~~Run `npm run build`.~~
- [x] ~~Record remaining out-of-scope gaps in the final response.~~
