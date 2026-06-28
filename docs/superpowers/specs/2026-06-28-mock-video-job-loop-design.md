# Mock Video Job Loop Design

## Goal

Make generated video jobs move through a believable local lifecycle without requiring a real provider API: queued, running, succeeded or failed, with output asset records and failure refunds.

## Scope

- Add a backend video job state machine.
- Add a local mock provider that can submit a task and produce a deterministic success or failure result.
- On success, create an `OUTPUT_VIDEO` asset with a 3-day expiry.
- On failure, mark the job failed and refund the deducted credits exactly once.
- Add a route for local/mock processing so tests and the UI can drive state transitions predictably.
- Update the user page to poll current video jobs after generation.

## Out Of Scope

- Real provider HTTP integration.
- Redis/BullMQ workers.
- Real object storage and playable video files.
- Scheduled 3-day deletion.

## Architecture

`VideoService` remains the owner of credit deduction and job records. A new mock provider module returns fake provider task ids and mock output metadata. `VideoService.processJob()` transitions a job from `PENDING` to `RUNNING` and then to `SUCCEEDED` or `FAILED`.

The app exposes `POST /api/video/jobs/:id/process` for local processing. This is intentionally simple for MVP and can be replaced by a worker route or queue consumer later.

## Data Flow

User creates a job with `POST /api/video/jobs`. The frontend refreshes the queue and periodically polls `/api/video/jobs`. A local processor call advances the job. Success writes `VideoAsset`; failure writes a `REFUND` ledger entry and restores the user balance.

## Testing

Tests cover success, failure refund, idempotent failure refund, and the HTTP process route.
