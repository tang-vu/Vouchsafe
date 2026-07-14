# Vouchsafe — Flare Summer Signal Final Push

Baseline: v2 live + verified on Coston2 (quorum build done, 44 tests). Deadline 2026-08-15.
Goal: close the remaining competitive gaps that are automatable — XRPL-native FDC path (Bounty 1),
Confidential Space scaffolding (Bounty 2), public judge-testable demo, video script + submission docs.

## Phases

| # | Phase | File | Status |
|---|-------|------|--------|
| 1 | XRPL Payment FDC path (contract + TS + tests) | [phase-01](phase-01-xrpl-payment-fdc-path.md) | done |
| 2 | Live XRPL proof on Coston2 + deploy + verify | [phase-02](phase-02-live-xrpl-coston2-deploy.md) | done |
| 3 | Confidential Space MODE=0 scaffolding | [phase-03](phase-03-confidential-space-mode0-scaffolding.md) | done |
| 4 | Read-only public demo mode + hosting config | [phase-04](phase-04-public-demo-readonly-hosting.md) | done |
| 5 | Video script + SUBMISSION/docs refresh | [phase-05](phase-05-video-script-submission-docs.md) | done |

## Key design decisions

- **XRPL path = challenge-payment proof of reserve-address control** via FDC `Payment` type
  (sourceId `testXRP`): owner registers the subject's XRPL reserve address hash; the subject sends a
  micro-payment on XRPL testnet whose memo carries a contract-derived 32-byte challenge reference;
  `XrplReserveProof.proveControl` verifies the FDC proof + source-address hash + reference + freshness.
  Complements Web2Json (amount from custodian API) with an XRPL-native control proof.
- **New standalone contract** — the audited `SolvencyVerifier` core is NOT touched. v2 addresses stay.
- Confidential Space work is scaffolding only (Dockerfile, attestation plumbing, gcloud scripts,
  guide); actually running MODE=0 needs a GCP account — the only manual step left.
- Public demo = `READ_ONLY=1` service mode (no server-key spending endpoints) + Docker/Fly config.

## Out of scope (needs the user)

- GCP account/billing (Confidential Space run), hosting account (Fly/Render), recording the video,
  posting to the Flare Telegram for traction, production verifier API key.

## Acceptance

- All contract tests green (existing 44 + new XrplReserveProof suite); `tsc` clean in both TS packages.
- Live Coston2 evidence: XRPL testnet payment tx + FDC Payment proof verified on-chain, explorer links.
- `XrplReserveProof` source-verified on Blockscout; address in `contracts/deployments/coston2.json`.
- SUBMISSION.md/README/docs updated; video script ready to record.
