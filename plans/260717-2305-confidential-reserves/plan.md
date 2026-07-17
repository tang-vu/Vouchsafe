# Confidential Reserves Mode (roadmap: "Privacy on reserves too")

## Status: implementing (single phase)

## Problem
Reserves figure is fully public today: endpoint serves raw `{"reserves": N}`, FDC puts N in calldata,
and `reservesCommitment = keccak256(abi.encode(N))` is unsalted → low-entropy reserves are dictionary-
attackable even where N is not directly visible. Only liabilities are private.

## Design (commitment mode, TEE-verified — no ZK library, KISS)
- Endpoint (confidential subjects) publishes a **salted commitment** instead of the raw number:
  `{"reservesCommitment": "0x…"}` = `keccak256(abi.encode(uint256 totalReserves, bytes32 reservesSalt))`.
- TEE gets `reservesSalt` as an extra PRIVATE input; recomputes the same salted commitment in-enclave,
  checks `reserves >= liabilities`, signs claim binding the commitment. Raw number never leaves enclave.
- Contract: per-subject flag `confidentialReserves` (owner-set, evented).
  - plain: decode `uint256 reserves`, require `keccak256(abi.encode(reserves)) == claim.reservesCommitment`
  - confidential: decode `bytes32 commitment`, require `commitment == claim.reservesCommitment`
  Source-URL binding, staking, quorum, fraud reveal (`inputHash`) unchanged. Trust model identical:
  TEE trusted for the boolean + binding; economics backstop via slash.

## Files
- Modify `contracts/src/SolvencyVerifierAdmin.sol` — mapping + `setConfidentialReserves` + event
- Modify `contracts/src/SolvencyVerifier.sol` — `_attestedReservesCommitment` branch, doc update
- Create `contracts/test/solvency-verifier-confidential.test.ts` — ~7 unit tests
- Modify `tee-extension/src/{types,solvency-compute,action-handler,self-test}.ts` — `reservesSalt` input
- Modify `tee-extension/src/fdc-reserves.ts` — `confidential` option: jq `.reservesCommitment`, abi `bytes32`
- Modify `attestor-service/src/{config,orchestrator,abis}.ts` — env `CONFIDENTIAL_RESERVES`, `RESERVES_SALT`
- Docs: README privacy note, `docs/development-roadmap.md`, `docs/codebase-summary.md`, `.env.example`

## Todo
- [x] Contracts + tests green (`yarn test`)
- [x] TEE extension compiles + self-test covers salted commitment
- [x] Service wiring + env docs
- [x] Docs updated
- [ ] Coston2 redeploy + live confidential round-trip (DEFERRED — changes submitted deployment; user call)

## Success criteria
All existing 56 tests still pass + new confidential tests pass; plain-mode demo path untouched.

## Risks
- Web2Json verifier must ABI-encode a "0x…" JSON string as `bytes32` (documented assumption; unit tests
  use the mock; live confidential run is optional and needs a commitment-serving endpoint anyway).
- Redeploy would change addresses recorded in SUBMISSION.md (already submitted) → deliberately deferred.
