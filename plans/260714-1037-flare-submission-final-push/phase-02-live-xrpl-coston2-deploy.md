# Phase 02 — Live XRPL Proof on Coston2 + Deploy + Verify

## Context links
[plan.md](plan.md) · [phase-01](phase-01-xrpl-payment-fdc-path.md) · `contracts/scripts/verify.ts`

## Overview
Priority: HIGH. Status: done. Deploy `XrplReserveProof` to Coston2 (v2 core untouched), source-verify,
run the live end-to-end: XRPL testnet payment → FDC Payment attestation → on-chain `proveControl`.

## Requirements
- New contract address appended to `contracts/deployments/coston2.json` (keep startBlock semantics).
- Blockscout source verification.
- Live evidence: XRPL tx hash + Coston2 `proveControl` tx explorer link.

## Related code files
- Create: `contracts/scripts/deploy-xrpl-reserve-proof.ts`
- Modify: `contracts/deployments/coston2.json` (via script), `attestor-service/src/config.ts` (new address)

## Implementation steps
1. Deploy script (reads existing deployments file, adds `XrplReserveProof`).
2. `yarn hardhat verify` (or verify.ts) on Coston2.
3. Run `yarn demo:xrpl`: faucet XRPL wallet → register address (owner) → memo payment → FDC round-trip
   → `proveControl` → print explorer links.
4. Record tx links for SUBMISSION.md (phase 05).

## Todo
- [x] Deployed + wired into deployments json
- [x] Source-verified on Blockscout
- [x] Live end-to-end run, links captured

## Success criteria
`proveControl` tx succeeds on Coston2 with a real FDC Payment proof of a real XRPL testnet payment.

## Risk assessment
FDC round ≈ 90–180 s; XRPL indexing lag ≈ 1–2 min → generous polling. Deployer needs C2FLR (existing key).

## Security considerations
Owner key = deployer (demo trust model, documented). No secrets printed; XRPL faucet wallet is throwaway.

## Next steps
Phase 05 records the evidence in SUBMISSION.md.
