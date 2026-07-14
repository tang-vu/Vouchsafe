# Phase 1 — Quorum endorsements + per-subject policy (contracts)

## Overview
Priority: high. Roadmap item: "Multi-attestor quorum; per-issuer configurable stake + penalty."
Extends `SolvencyVerifier` so independent staked attestors co-sign (endorse) a recorded attestation;
fraud slashes the recorder **and** every endorser. Per-subject policy overrides global params.

## Design
- `SubjectPolicy { uint256 minStake; uint256 slashPenalty; uint32 requiredEndorsements }`,
  `setSubjectPolicy` (owner). Zero field = fall back to global.
- `endorse(bytes32 id)` — staked (per-subject requirement), not the recorder, not already endorsed,
  attestation exists + not revoked, endorser set capped at `MAX_ENDORSERS = 32` (bounds fraud-slash gas).
  Locks endorser stake for `challengeWindow` from now. Emits `AttestationEndorsed`.
- Views: `endorsementCount`, `endorsersOf`, `isQuorate` (count ≥ policy.requiredEndorsements, not revoked),
  `requiredStakeFor(subject)` = max(global minStake, policy.minStake).
- `recordSolvency` stake gate uses `requiredStakeFor(subject)`.
- `raiseFraud` slashes recorder + all endorsers at the effective penalty (policy override or global),
  challenger is beneficiary for all; emits `EndorserSlashed` per endorser.
- File size: split admin/storage into abstract `SolvencyVerifierAdmin.sol`; core logic stays in
  `SolvencyVerifier.sol` (artifact name unchanged → deploy script untouched).

## Files
- Modify: `contracts/src/SolvencyVerifier.sol` (split), `attestor-service/src/abis.ts` (later phase).
- Create: `contracts/src/SolvencyVerifierAdmin.sol`, `contracts/test/solvency-verifier-quorum.test.ts`.

## Todo
- [x] Split admin base + add policy storage/setters
- [x] endorse + views + fraud multi-slash
- [x] Quorum test suite; all tests green

## Success criteria
`yarn test` green (existing 30 + new). No change to deploy constructor args.

## Risks
- Gas of slash loop → capped endorser set.
- Endorsing near window end → each endorser gets a fresh full lock from endorsement time (economically
  conservative, simple).
