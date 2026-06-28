# Data Driven Loop Design

> Current status (2026-06-28): implemented and superseded by later real-provider, asset, playback, and lightweight generation-record work. The out-of-scope items below describe this plan's original boundary, not the current project state.

## Goal

Complete the first data-driven loop without depending on a real video provider: user pages and admin pages should read and mutate the existing backend data instead of showing hard-coded prototype rows.

## Scope

- User side loads public models, credit packages, current video jobs, and creates/deletes video jobs through the API.
- Admin side loads model configs, packages, users, and video jobs through admin APIs.
- Admin side can create/update models, create/update/delete packages, ban/unban users, and adjust user credits.
- Backend adds missing update APIs for model configs and credit packages.

## Out Of Scope

- Real provider submission and polling.
- Object storage, real video playback, signed upload/download URLs.
- Payment provider integration.
- Full audit log implementation and scheduled cleanup.

## Architecture

Keep the current Fastify service shape. `AdminService` owns model/package mutation rules and route handlers expose small PATCH endpoints. The static HTML pages keep their single-file JavaScript style, but replace hard-coded rendering with DOM render functions fed by `apiFetch`.

## Data Flow

User page startup fetches `/api/me`, `/api/models`, `/api/credit-packages`, and `/api/video/jobs`. Generate submits `POST /api/video/jobs`, then refreshes the queue/project views and user balance. Delete submits `DELETE /api/video/jobs/:id`.

Admin page role-checks with `/api/me`, then loads `/api/admin/model-configs`, `/api/admin/credit-packages`, `/api/admin/users`, and `/api/admin/video-jobs`. Form submissions call POST or PATCH depending on selected row id.

## Error Handling

Existing toast messaging remains. API failures show the backend error message where available. Unauthorized admin requests redirect to login, while forbidden users return to the user page.

## Testing

Backend route tests cover model and package updates. Frontend shell tests assert the pages contain the API calls and render hooks required for data-driven behavior. Final verification runs `npm test` and `npm run build` in `backend`.
