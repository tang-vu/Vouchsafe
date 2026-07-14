# Phase 01 — XRPL Payment FDC Path

## Context links
- [plan.md](plan.md) · `contracts/src/SolvencyVerifier.sol` (patterns) · `tee-extension/src/fdc-reserves.ts` (FDC round-trip)
- FDC `Payment` type: `node_modules/@flarenetwork/flare-periphery-contracts/coston2/IPayment.sol` (supported: BTC, DOGE, XRP)

## Overview
Priority: HIGH (Bounty 1 — interoperable assets). Status: done.
XRPL-native reserve proof: subject proves control of its XRPL reserve address by sending a testnet
payment whose memo carries a contract-derived challenge reference; FDC attests the payment; the
contract verifies proof + address + reference + freshness on-chain.

## Requirements
- Functional: register XRPL address per subject (owner); view challenge ref; `proveControl` verifies
  FDC Payment proof, binds to subject, stores latest proof (txId, timestamps); freshness view.
- Non-functional: contract < 200 lines; no changes to audited v2 contracts; registry-resolved
  FdcVerification (no hardcoded addresses); replay-safe (per-subject nonce in challenge ref + used-tx guard).

## Architecture
```
XRPL testnet wallet (reserve addr) --payment w/ memo=challengeRef--> XRPL testnet
attestor-service/xrpl-client.ts  --txId--> tee-extension/fdc-payment.ts
  prepareRequest(xrp/Payment, testXRP) -> FdcHub -> Relay finalization -> DA proof
    -> XrplReserveProof.proveControl(subject, nonce, proof)
       checks: verifyPayment, sourceAddressHash == registered, standardPaymentReference == challengeRef(subject,nonce),
               status==0, blockTimestamp fresh, txId unused -> stores XrplControl{txId, provenAt}
```
- Standard address hash (FDC): `keccak256(bytes(xrplAddressString))`.
- Challenge ref: `keccak256(abi.encode("VOUCHSAFE_XRPL_V1", block.chainid, address(this), subject, nonce))`.
- XRPL memo: single Memo with 32-byte MemoData = challenge ref (FDC standard payment reference rule).

## Related code files
- Create: `contracts/src/XrplReserveProof.sol`, `contracts/src/interfaces/IPaymentVerifier.sol`,
  `contracts/src/mocks/MockPaymentVerifier.sol`, `contracts/test/xrpl-reserve-proof.test.ts`,
  `tee-extension/src/fdc-payment.ts`, `attestor-service/src/xrpl-client.ts`, `attestor-service/src/xrpl-demo.ts`
- Modify: `tee-extension/src/index.ts` (export), `attestor-service/package.json` (xrpl dep, demo:xrpl script),
  `attestor-service/src/server.ts` (+`/api/xrpl-proof` GET), `contracts/scripts/deploy-xrpl-reserve-proof.ts`

## Implementation steps
1. `XrplReserveProof.sol` — Ownable; `setXrplReserveAddress(subject, xrplAddr)` stores hash+string;
   `challengeRef(subject, nonce)`; `proveControl`; `lastProof(subject)`; `isFresh(subject, maxAge)`.
2. Mock verifier + hardhat tests (happy, wrong source, wrong ref, stale, replay, failed status).
3. `fdc-payment.ts` — Payment round-trip (mirror fdc-reserves.ts; poll prepareRequest until VALID).
4. `xrpl-client.ts` — xrpl.js: faucet-fund wallet, send 1-drop payment with memo, wait validated.
5. `xrpl-demo.ts` — end-to-end act; deploy script for the new contract.

## Todo
- [x] Contract + interface + mock
- [x] Unit tests green
- [x] TS helpers + demo + API endpoint
- [x] `tsc` clean

## Success criteria
`yarn test` green incl. new suite; `yarn demo:xrpl` runs end-to-end on Coston2 (phase 02).

## Risk assessment
- FDC XRPL indexer lag → poll prepareRequest with backoff (it 400s until tx indexed).
- Memo→standardPaymentReference rule mismatch → verify live in phase 02 before docs claim it.
- Rate-limited placeholder verifier key → retries; acceptable for demo volume.

## Security considerations
Owner-gated address registration (same trust model as reservesSourceHash); challenge ref binds
payment to this chain+contract+subject+nonce (no cross-deployment replay); used-txId guard.

## Next steps
Phase 02 — deploy + live run + explorer evidence.
