# Phase 04 — Read-Only Public Demo Mode + Hosting Config

## Context links
[plan.md](plan.md) · `attestor-service/src/server.ts` · `attestor-service/public/`

## Overview
Priority: MEDIUM-HIGH (judges must be able to click a link). Status: done (config ready; actual
hosting needs the user's platform account unless a logged-in CLI is found).

## Requirements
- `READ_ONLY=1` env: server-key-spending endpoints (`/api/attest`, `/api/fraud`, service endorse)
  return 403 with a friendly message; GET history/quorum + static frontend + MetaMask writes still work.
- Root Dockerfile for the attestor-service workspace + `fly.toml`; docs for Render/any Docker host.
- No private key required in read-only deployment (config must not throw when PRIVATE_KEY empty).

## Related code files
- Modify: `attestor-service/src/server.ts`, `attestor-service/src/config.ts`, frontend banner for read-only.
- Create: `Dockerfile` (repo root), `fly.toml`, `docs/deployment-guide.md` section (public demo hosting).

## Implementation steps
1. READ_ONLY gate + lazy key validation; frontend shows "read-only demo" banner via `/api/config`.
2. Dockerfile (workspace build, runs attestor-service server).
3. fly.toml + deployment-guide section; check for authenticated deploy CLIs and deploy if possible.

## Todo
- [x] READ_ONLY mode + banner
- [x] Dockerfile + fly.toml + guide
- [x] Deploy attempt (blocked: no authenticated CLI found — user action)

## Success criteria
`READ_ONLY=1 yarn service` serves UI + history with no PRIVATE_KEY set; Docker image runs the same.

## Risk assessment
Public RPC rate limits → history endpoint already event-indexed with caching; acceptable.

## Security considerations
Read-only mode never loads the server key path; MetaMask txs are user-side; no secrets in image.

## Next steps
User: `fly auth login && fly deploy` (or Render). Then paste URL into SUBMISSION.md demo section.
