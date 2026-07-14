# Vouchsafe — Post-Hackathon Max Build

Baseline: all 5 hackathon phases done, 30/30 tests, live on Coston2. This plan delivers the feasible
"Next (post-hackathon)" roadmap items in one push.

## Scope (from docs/development-roadmap.md → Next)

| # | Phase | File | Status |
|---|-------|------|--------|
| 1 | Quorum endorsements + per-subject policy (contracts) | [phase-01](phase-01-quorum-endorsements-subject-policy.md) | done |
| 2 | Attestation history + quorum API (attestor-service) | [phase-02](phase-02-history-quorum-api.md) | done |
| 3 | Wallet-connect + quorum/history UI (frontend) | [phase-03](phase-03-wallet-connect-frontend.md) | done |
| 4 | Redeploy Coston2 + verify + live demo + docs | [phase-04](phase-04-redeploy-verify-docs.md) | done (see note) |

## Out of scope (documented, not built)
- Real GCP Confidential Space (MODE=0) — needs GCP infra.
- XRPPayment FDC type — needs XRPL fixture; Web2Json path already proves the FDC integration.
- ZK range proof on reserves — research item.
- Mainnet FXRP.

## Key dependencies
- Phase 2/3 depend on phase-1 ABI. Phase 4 last (fresh addresses invalidate older coston2.json).
- Existing Coston2 v1 addresses stay live; git history keeps the old deployments file.

## Acceptance
- All unit tests green (old 30 + new quorum suite).
- `tsc` clean in tee-extension + attestor-service.
- `yarn demo` still passes live after redeploy; explorer links printed.
- Docs (codebase-summary, roadmap, README, SUBMISSION) updated.
