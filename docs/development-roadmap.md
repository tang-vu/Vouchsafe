# Vouchsafe — Development Roadmap

## Status: hackathon build + post-hackathon quorum build complete — deployed and demonstrated live on Coston2

### Delivered (Phases 1–5)
- [x] **Phase 1** — Monorepo + `SolvencyRegistry` / `AttestorStaking` / `SolvencyVerifier`; 19 unit tests; Coston2 deploy.
- [x] **Phase 2** — Confidential TEE extension (TS): private solvency compute, EIP-191 signer, `/action` server; on-chain signature verification; `VouchsafeInstructionSender` FCC footprint.
- [x] **Phase 3** — FDC Web2Json reserve proof + FXRP agent binding; `recordSolvency` requires both proofs; evidence-based `raiseFraud` slashing. Live FDC round-trip on Coston2.
- [x] **Phase 4** — `attestor-service` orchestrator + API + 3-view frontend; unattended `yarn demo` (happy + fraud).
- [x] **Phase 5** — SUBMISSION.md, README, architecture diagram, docs suite; all five contracts verified on the explorer.

### Acceptance criteria — all met
- [x] `yarn demo` runs the full happy path unattended on Coston2 with an explorer link.
- [x] Third party verifies "solvent at T" without seeing the numbers.
- [x] Fraud path slashes an attestor's stake (1.0 → 0.0 C2FLR, live).
- [x] Both a TEE attestation and an FDC proof are required to record solvency.
- [x] Tests pass (24); contracts deployed + verified on Coston2 with addresses in SUBMISSION.md.
- [x] SUBMISSION.md honestly separates new work from starter/skill-provided work.

### Delivered (Phase 6 — post-hackathon quorum build, 14 Jul 2026)
- [x] Multi-attestor **quorum**: `endorse(id)` puts independent stake behind a claim; `raiseFraud` slashes the
  recorder **and** every endorser; `isQuorate` finality signal. 14 new unit tests (44 total).
- [x] **Per-subject policy** (`SubjectPolicy`): configurable stake floor, slash penalty, and required
  endorsements per issuer; global fallback.
- [x] **Attestation history** without an external indexer: event-scan API (`GET /api/attestations`) from the
  deployment `startBlock`, joined with live quorum state.
- [x] **Wallet-connect frontend** (Act IV): MetaMask connect + Coston2 auto-add, stake + endorse from the
  browser; service-endorser fallback (`POST /api/endorse`); history table.
- [x] Redeployed + explorer-verified on Coston2; `yarn demo` now exercises happy + quorum + fraud paths.

### Delivered (Phase 7 — submission final push, 14 Jul 2026)
- [x] **XRPL-native reserve proof** (`XrplReserveProof`, FDC **Payment** type): challenge-payment proof that the
  subject controls its registered XRP reserve address — chain/contract/subject/nonce-bound memo reference,
  replay-safe (nonce + tx guards), freshness bound. 12 new unit tests (56 total). Deployed + verified
  (`0x878Fe3305cC23aDfa6CfF10E1B9e811e9A2Ac9f0`) and **proven live**: XRPL testnet payment `FDA9BA6A…` →
  Coston2 `proveControl` tx `0x354c0811…`.
- [x] Shared FDC plumbing (`fdc-common.ts`) + `fdc-payment.ts` round-trip + `xrpl-client.ts` (xrpl.js) +
  `yarn demo:xrpl`; `GET /api/xrpl-proof/:subject`; frontend Act V.
- [x] **Confidential Space scaffolding**: `tee-extension/Dockerfile`, `/attestation` launcher-token endpoint,
  one-command `setup-confidential-space.sh` (Cloud Build — no local Docker), operator guide
  (`docs/confidential-space-deployment-guide.md`). Blocked only on a billing-enabled GCP project.
- [x] **Public demo hosting**: `READ_ONLY` service mode (write paths 403, MetaMask still works), root
  `Dockerfile`, `fly.toml`, read-only UI banner.
- [x] Demo-video storyboard (`plans/260714-1037-flare-submission-final-push/demo-video-script-storyboard.md`).

## Next (post-hackathon)
- [ ] **Run** Confidential Space (user action): enable GCP billing → `setup-confidential-space.sh` →
  `setTeeAddress(enclaveAddr)`; later point `VouchsafeInstructionSender` at the live `TeeExtensionRegistry`.
- [ ] Record + upload the demo video; `fly deploy` the public read-only demo; post to the Flare Telegram for traction.
- [ ] Unbonding/lock parameter tuning informed by real challenge-latency data.
- [ ] **Privacy on reserves too** — range-proof / ZK option so the reserves figure (not just liabilities) stays hidden.
- [ ] Mainnet FXRP; integrate with agent tooling; production verifier/DA-layer API keys.
- [ ] Subgraph for cross-deployment attestation history (the event-scan API covers a single deployment).

## Known limitations
- `TeeExtensionRegistry` is not yet published in the Coston2 `FlareContractRegistry`, so the full on-chain FCC
  round-trip runs in event-anchored simulated mode.
- The FDC reserves endpoint must be publicly reachable and return `application/json`; the demo relies on a githack
  proxy over a gist.
- Placeholder verifier/DA-layer API key is rate-limited.
