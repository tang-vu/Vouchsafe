# Phase 2 — Confidential Compute Extension (Simulated)

**Priority:** P0 · **Status:** planned · Core of Bounty 2. Uses `flare-fcc` skill + `fce-sign` (TS) patterns.

## Goal
Build `tee-extension/` (TypeScript) that ingests private figures, computes `reserves >= liabilities` **inside the
enclave boundary**, and returns a **signed attestation** (inputHash + result + timestamp + nonce, **no raw values**).
Run it in **simulated mode** end-to-end. Wire `SolvencyVerifier` to actually verify the extension's signature and
record on Coston2. Document precisely what is simulated vs what runs in real Confidential Space.

## What the extension does
- HTTP handler (mirrors scaffold `OPType/OPCommand` shape): `OP_TYPE=SOLVENCY`, `OP_COMMAND=PROVE`.
- Input (never leaves the process): `{ subject, reserves[], liabilities[], salt, nonce }`.
- Compute: `solvent = sum(reserves) >= sum(liabilities)`; `inputHash = keccak256(abi.encode(reserves, liabilities, salt))`;
  `reservesCommitment = keccak256(abi.encode(sum(reserves), salt))`.
- Sign with the **TEE key** (simulated = local ECDSA keypair; real = enclave-held key via SIGN_PORT). EIP-191
  personal-sign over the Flare result-hash construction:
  `resultHash = keccak256(abi.encodePacked(keccak256(resultData), actionId, keccak256(bytes(submissionTag)), status))`.
- Output: `{ subject, inputHash, reservesCommitment, solvent, timestamp, nonce, signature }`. Raw numbers discarded.

## On-chain verification (replaces P1 stub)
`SolvencyVerifier.recordSolvency(claim, teeSignature)`:
1. `require(staking.stakeOf(msg.sender) >= staking.minStake())`.
2. Reconstruct `resultHash`, `ecrecover(eip191(resultHash), sig) == teeAddress` (owner sets `teeAddress` = the
   simulated TEE signer's address in P2; real enclave address in MODE=0).
3. `require(status == 1)` (success only). 4. `registry.recordAttestation(...)`; `staking.lockUntil(...)`; emit.
(FDC proof requirement added in P3 — this phase verifies the TEE half only.)

## Hybrid FCC footprint (on-chain, real)
`VouchsafeInstructionSender.sol`: `bytes32 OP_TYPE_SOLVENCY=bytes32("SOLVENCY")`, `OP_COMMAND_PROVE=bytes32("PROVE")`;
a `payable sendProveSolvency(bytes message)` calling `TeeExtensionRegistry.sendInstructions(...)` via the periphery
interface. Deploy + (best-effort) register on Coston2 to show a genuine FCC entry point. If registration needs the
full TEE machine stack, deploy the contract and document the registration command — do not fake it.

## Simulated vs real (document in tee-extension/README.md)
| Concern | Simulated (this phase) | Real Confidential Space (MODE=0) |
|---|---|---|
| Enclave | local Node process | GCP Confidential Space / AMD SEV VM |
| TEE key | local ECDSA keypair | enclave-generated, never exported |
| Attestation | `SIMULATED_TEE=true`, code hash `0x194844cf…` | measured code hash, FTDC-whitelisted on-chain |
| Signature verify | identical `ecrecover==teeAddress` | identical |
| Switch | `.env` `SIMULATED_TEE`/`MODE` flags | `MODE=0`, `LOCAL_MODE=false`, reproducible build |
The signing + on-chain verification are **identical** in both modes; only the key custody + attestation differ.

## Related files
- Create: `tee-extension/src/{solvency-compute.ts,tee-signer.ts,server.ts,config.ts}`, `tee-extension/README.md`,
  `tee-extension/package.json`, `tee-extension/.env.example`.
- Modify: `contracts/src/SolvencyVerifier.sol` (real sig verify), add `contracts/src/VouchsafeInstructionSender.sol`
  + `contracts/src/interfaces/ITeeExtensionRegistry.sol` (minimal, from fce scaffold).
- Reference: scratchpad fce-weather-insurance verify snippet (already captured), `flare-fcc` skill.

## Success criteria
Local run: figures in → signed attestation out (raw numbers absent from output & chain) → `recordSolvency` verifies
sig and records on Coston2 (explorer link). Solidity unit test: valid sig records, tampered sig/inputHash reverts,
wrong signer reverts. `tee-extension/README.md` documents simulated-vs-real. Commit `feat: simulated TEE solvency extension + on-chain signature verification`.

## Security
Untrusted input: strict decode + validate every field. Nonce prevents replay (verifier tracks used nonces). Raw
values never serialized to output/logs/chain. TEE key only in extension process/enclave. `status==1` gate.

## Next
P3 adds the FDC Web2Json reserve proof as a second required input and binds it to `reservesCommitment`.
