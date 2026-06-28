# User Redemption Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-visible redemption history list without exposing redemption hashes, full codes, admin-only fields, or ledger internals.

**Architecture:** Reuse existing redemption code, redemption batch, and credit ledger data. Add a narrow backend route that returns only the authenticated user's redeemed codes, sorted by redemption time, then add a simple redemption-page table that refreshes on load and after a successful redemption.

**Tech Stack:** Fastify, TypeScript, Vitest, static HTML/CSS/JS.

---

### Task 1: Backend Redemption History API

**Files:**
- Modify: `backend/src/test/app.routes.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write the failing route test**

Add a test that creates two users, generates two codes, redeems one code per user, calls `GET /api/credits/redemptions` as the first user, and expects only that user's record with `credits`, `batchName`, `codePrefix`, `codeSuffix`, and `redeemedAt`. Assert `codeHash`, `plainCode`, and `idempotencyKey` are absent.

- [ ] **Step 2: Run the route test to verify it fails**

Run: `npm test -- src/test/app.routes.test.ts`

Expected: FAIL because `/api/credits/redemptions` is not registered.

- [ ] **Step 3: Implement the route**

Add `GET /api/credits/redemptions` in `backend/src/app.ts`. Filter `store.redemptionCodes` by `redeemedBy === user.id` and `redeemedAt`, join the batch name from `store.redemptionBatches`, sort descending by `redeemedAt`, and return masked fields only.

- [ ] **Step 4: Run the route test to verify it passes**

Run: `npm test -- src/test/app.routes.test.ts`

Expected: PASS.

### Task 2: User Frontend Redemption History

**Files:**
- Modify: `backend/src/test/user-frontend.test.ts`
- Modify: `index.html`

- [ ] **Step 1: Write the failing frontend shell test**

Add a test that checks `index.html` contains `/api/credits/redemptions`, `renderRedemptionRecords`, `refreshRedemptionRecords`, a table body target, and the empty-state text.

- [ ] **Step 2: Run the frontend shell test to verify it fails**

Run: `npm test -- src/test/user-frontend.test.ts`

Expected: FAIL because the page does not yet load or render redemption records.

- [ ] **Step 3: Implement the markup and JS**

Add a redemption history panel under the redemption form. Add `formatDateTime`, `renderRedemptionRecords`, and `refreshRedemptionRecords`. Call `refreshRedemptionRecords()` on startup and after successful redemption.

- [ ] **Step 4: Run the frontend shell test to verify it passes**

Run: `npm test -- src/test/user-frontend.test.ts`

Expected: PASS.

### Task 3: Final Verification

**Files:**
- Read only during verification.

- [ ] **Step 1: Run all backend tests**

Run: `npm test`

Expected: PASS with all test files passing.

- [ ] **Step 2: Run the TypeScript build**

Run: `npm run build`

Expected: exit code 0.
