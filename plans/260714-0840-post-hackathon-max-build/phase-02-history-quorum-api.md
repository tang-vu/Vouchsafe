# Phase 2 — Attestation history + quorum API (attestor-service)

## Overview
Roadmap item: "subgraph/indexer for attestation history" — delivered as an event-scan API (no external
indexer per YAGNI). Also surfaces quorum state per attestation.

## Design
- New `attestor-service/src/history.ts`: `getLogs` on `SolvencyAsserted` + `AttestationRevoked` from the
  deployment block (`startBlock` written by deploy script; fallback 0), join revocations, newest first,
  optional `subject` filter + `limit`.
- `readAttestation` gains `endorsements` + `quorate` (verifier views).
- Routes: `GET /api/attestations?subject&limit`, `POST /api/endorse` not needed server-side (wallet does it).
- `abis.ts`: add registry events, verifier `endorse/endorsementCount/isQuorate/requiredStakeFor/subjectPolicy`.
- Deploy script writes `startBlock` into deployments JSON.

## Todo
- [x] history.ts + server route
- [x] abis + orchestrator quorum fields
- [x] tsc clean

## Success criteria
`yarn workspace @vouchsafe/attestor-service build` (tsc) clean; endpoint returns records against Coston2.
