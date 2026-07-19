# Demo 3 Map Backend

## Purpose

This document records the backend services currently required by the map and
submission surfaces, the Supabase changes used by the Commissioner submissions
table, and the remaining integration work. It replaces the former
"Recommended Backend Integration" section in `map-architecture.md`.

## Server Composition

`server/app.js` mounts three relevant API groups:

| Route prefix | Module | Current role |
| --- | --- | --- |
| `/api/map` | `server/map-api-service/` | Serves local map assets, DA profiles, and development assignment state. |
| `/api/comments` | `server/routes/comments.js` | Reads and writes comments, objections, and submissions in Supabase. |
| `/api/auth` | `server/routes/auth.js` | Session, profile, invitation, and authentication operations. |

The application enables credentialed CORS only for the configured
`CLIENT_ORIGIN` values and limits JSON request bodies to 1 MB.

## Map Asset Service

The map API is repository-backed rather than database-backed. It serves data
under `src/data/map/` through the following runtime contracts:

| Endpoint | Consumer | Notes |
| --- | --- | --- |
| `GET /api/map/da-profiles` | MapCanvas and InfoPanel | Returns the compact DA profile index. |
| `GET /api/map/assets/manifests/da_asset_manifest.json` | MapCanvas | Describes DA render assets and metadata shards. |
| `GET /api/map/assets/render/*.pmtiles` | MapLibre PMTiles protocol | Supports byte-range responses required by tiled rendering. |
| `GET /api/map/assets/metadata/*.geojson` | Pair workflows | Lazy-loads canonical FED metadata only when needed. |
| `GET/PUT /api/map/assignments` | Development utility | Persists `server/map-api-service/store/assignments.json`; it is not a counter-proposal submission store. |

The asset service accepts only expected JSON, GeoJSON, and PMTiles asset paths.
Baseline geographic data remains versioned in the repository and is never
rewritten by a browser workflow.

## Current Comments and Objections Flow

Public comment and objection forms call `src/services/commentsApi.js`, which
posts to `POST /api/comments`. The route inserts a row in Supabase
`submissions` with `status: "pending"`.

| Submission kind | Key fields |
| --- | --- |
| Comment | `proposal_id`, `user_id`, `comment`, `fed_num`, `dguid`, `title`, `type: "feedback"` |
| Objection | The same fields plus `neighboring_dguid` and `type: "objection"` |

The user submissions page reads `GET /api/comments/:user_id`; proposal feedback
uses `GET /api/comments/proposal/:proposalId`. These current routes are backed
by Supabase and the existing comments/objections workflow reads and writes
successfully when the expected Supabase tables and foreign keys are present.

### Authorization status

The Commissioner-wide route, `GET /api/comments`, is now protected by
`requireAuth` and a local commissioner-role guard. The frontend sends cookies
with `credentials: "include"` for this request.

The other comments endpoints, including `POST /api/comments`, have not yet been
made authoritative: they still accept `user_id` from the request body and do
not yet apply `requireAuth` consistently. Client-side sign-in checks are useful
for UX but are not an authorization boundary. The next backend change must:

1. require a verified session for every read and write route;
2. derive the author from `req.user.id`, not from `req.body.user_id`;
3. authorize user-scoped reads and deletes; and
4. validate DGUID, FED, pair, payload length, and submission type server-side.

## Commissioner Email Lookup

The Commissioner submissions table needs an author email for every submission.
The ordinary Supabase client query for `profiles` is subject to row-level
security, which caused legitimate users to appear as `Unknown`.

`server/lib/supabase.js` now exports
`getSupabaseProfileEmailsAsAdmin(userIds)`. It uses the service-role client to
retrieve only `id` and `email` for the submission authors. In
`server/routes/comments.js`, the protected Commissioner `GET /api/comments`
route fetches submissions, requests those profiles in a single batch, and merges
the resulting `{ id, email }` objects into each response row.

The service-role key remains server-only. The role-protected route is essential:
an unprotected endpoint must never expose the email merge to anonymous clients.

## Counter-Proposal Status

Counter-proposal geometry is currently an in-browser editing prototype. The
workflow maintains geometry, history, and repair details in React state and a
temporary `counter-proposal-cache` browser cache. Its confirmation action does
not yet create a durable proposal revision in Supabase.

The client-side JSTS validation is deliberately retained for immediate editing
feedback, but it is not a security boundary. A production backend must rerun
equivalent topology checks before accepting geometry.

## Required Backend Work

### 1. Persist proposal revisions

Introduce versioned proposal and geometry records rather than storing edited
GeoJSON inside a free-form comment field. At minimum, persist:

- proposal and submission identifiers;
- author, status, timestamps, and reviewer decisions;
- affected DGUIDs and the original baseline version;
- one immutable geometry revision per accepted draft;
- derived population and area metrics; and
- a server-side validation report.

The insert of a proposal, its affected geometry, and its submission record
should be transactional.

### 2. Authorize and validate every mutation

Use `requireAuth` and role middleware across comment, objection, and
counter-proposal endpoints. The server should validate the selected DAs, shared
boundary, geometry validity, area conservation, and ownership before writing.
Approval actions must use version-aware optimistic concurrency so a reviewer
cannot approve a stale revision.

### 3. Replace the heatmap fixture

`src/lib/map/heatmap.js` currently loads
`src/data/map/indexes/da_submissions.json`, a committed demonstration fixture.
The future API should return a compact aggregate such as:

```json
{
  "countsByDguid": {
    "2021S051248110895": 12
  },
  "generatedAt": "2026-07-19T00:00:00.000Z"
}
```

The endpoint should aggregate only the statuses appropriate for Commissioner
visibility and should avoid returning raw submission content. Replacing
`loadDemoSubmissionHeatmap()` with an authenticated request is sufficient; the
MapCanvas paint expression and control API can remain unchanged.

### 4. Add freshness without broadcasting geometry

No Supabase Realtime channel, Server-Sent Event stream, WebSocket, or polling
refresh is currently configured for submissions or map changes. A future event
should contain only compact identifiers and status/version metadata. Clients
can then refetch the affected aggregate or proposal record, rather than receive
full geometry over a broadcast channel.

## Environment Requirements

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` | Normal server/client Supabase access. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only profile-email lookup and administrative account checks. |
| `CLIENT_ORIGIN` | Comma-separated browser origins permitted by credentialed CORS. |
| `VITE_GOOGLE_MAPS_API_KEY` | Browser-only Google Map Tiles key; unrelated to Supabase and never committed. |

The current root `.env` is distributed through the project Google Drive shared
folder. It is Git-ignored, must be downloaded by each developer, and is the
single local environment file for both the Express server and Vite client.
`.env.local` is intentionally not used.
