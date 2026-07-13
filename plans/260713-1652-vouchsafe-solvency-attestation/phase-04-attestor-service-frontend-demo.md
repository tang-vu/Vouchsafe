# Phase 4 — Attestor-Service + Frontend + Demo

**Priority:** P0 · **Status:** planned · Ties everything into an unattended `yarn demo`.

## Goal
Off-chain orchestrator wiring inputs → TEE extension → FDC proof → on-chain submission. Minimal frontend for the
three demo views. Single `yarn demo` runs the full happy path on Coston2 unattended and prints an explorer link.

## attestor-service/ (TypeScript, express)
- `POST /attest` — body `{ subject, reserves[], liabilities[], salt }`: calls tee-extension `/action` (SOLVENCY/PROVE)
  → gets signed attestation; runs `prove-reserves.ts` FDC round-trip; submits `recordSolvency(claim, sig, fdcProof)`;
  returns `{ attestationId, txHash, explorerUrl }`.
- `GET /reserves/:subject` — public reserves figure JSON consumed by the FDC Web2Json verifier (only reserves total,
  never liabilities). Deterministic per subject for the demo.
- `GET /attestation/:id` — reads `SolvencyRegistry.getAttestation` → `{ subject, solvent, timestamp, inputHash }`
  (no raw numbers). `POST /fraud/:id` — triggers `raiseFraud` for the demo fraud path.
- Config via `.env` (RPC, keys, verifier/DA-layer URLs, contract addresses from P1/P3 deploy output).

## frontend/ (minimal — Vite + React, or static + ethers)
- **(a) Issuer view:** submit figures → shows returned attestation id + explorer link.
- **(b) Verifier view:** paste attestation id → shows "Solvent, verified at T" + inputHash, **no numbers**.
- **(c) Fraud demo:** button triggers an insolvent case → shows the slash tx (stake reduced). Keep it small; no
  infra we won't show.

## `yarn demo` (scripts/demo run unattended)
Happy path: fund/stake attestor → submit solvent figures → TEE signs → FDC proof round-trip → `recordSolvency` →
print attestation id + explorer link + "verified without revealing numbers". Then a **separate** fraud scenario:
insolvent subject → attestor asserts solvent → `raiseFraud` with FDC counter-proof → stake slashed → print slash tx.
Idempotent, backoff on FDC finalization, clear console output.

## Related files
- Create: `attestor-service/src/{index.ts,routes.ts,tee-client.ts,fdc-client.ts,chain-client.ts,config.ts}`,
  `frontend/` (minimal), root `scripts/demo/run-happy-path.ts` + `run-fraud-path.ts`, root `package.json` `demo` script.
- Reference: P2 tee-extension client shape, P3 `prove-reserves.ts`.

## Success criteria
`yarn demo` completes unattended on Coston2, prints explorer link to a recorded attestation and a slash tx. Frontend
three views work against Coston2. Verifier view shows solvent+T+inputHash with no raw figures. Commit
`feat: attestor-service orchestrator, demo frontend, yarn demo end-to-end`.

## Security
Service holds attestor key in `.env` (local only, never committed). Validate request bodies. Rate-limit public
endpoints (starter ships express-rate-limit). Fraud endpoint gated for demo only.

## Next
P5 generates submission artefacts from the working system.
