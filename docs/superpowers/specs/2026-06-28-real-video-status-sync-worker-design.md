# Real Video Status Sync Worker Design

> Current status (2026-06-28): implemented. The original design intentionally avoided real supplier `POST /v1/videos` while building the worker. The current project state has `VIDEO_PROVIDER_REAL_JOBS=true` enabled by user request; user-created jobs can now submit real supplier tasks, while frontend polling still avoids automatic `/sync` calls.

## Goal

Move real-provider video status synchronization out of frontend-triggered polling and into backend background work, while keeping the current mock provider as the default path and avoiding any real `POST /v1/videos` call.

## Approach

Add a small backend synchronizer that scans active provider-backed jobs, calls the existing `VideoService.syncJob()` path, and persists changed state after background updates. Wire it to BullMQ when `REDIS_URL` and real video jobs are enabled. The API can still expose a manual sync route as a fallback, but frontend polling should only read `/api/video/jobs`.

## Components

- `VideoStatusSynchronizer`: pure testable scanner for `PENDING` or `RUNNING` jobs with non-mock `providerTaskId`.
- BullMQ adapter: creates a repeatable scan job and worker tied to Redis.
- `createApp`: accepts optional status-sync scheduler, enqueues provider-backed jobs after create, and turns manual `/sync` into enqueue-or-inline fallback.
- `server.ts`: starts BullMQ-backed sync only when `VIDEO_PROVIDER_REAL_JOBS=true` and `REDIS_URL` is configured.
- `index.html`: keeps UI polling but removes automatic `POST /sync` calls.

## Testing

Tests cover scanner behavior, route enqueue behavior, and static frontend constraints. Existing provider tests remain mocked and must not call real supplier endpoints.
