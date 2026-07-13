# Phase 3 — FAssets + FDC Integration (Interoperable Half)

**Priority:** P0 · **Status:** planned · Core of Bounty 1. Uses `flare-fdc` + `flare-fassets` skills + starter examples.

## Goal
(a) Bind an attestation to a real **FXRP agent** on Coston2. (b) Use **FDC Web2Json** to bring off-chain reserve
data on-chain as a proof. (c) Make `SolvencyVerifier` require **both** the TEE attestation **and** a valid FDC proof
before recording "solvent". Show the full FDC round-trip.

## FAssets binding
- Resolve `IAssetManager` via `ContractRegistry.getAssetManagerFXRP()`. Read agent context via `getAgentInfo(vault)`
  (collateral ratios, minted FXRP, status) and agent metadata via `AgentOwnerRegistry` (name/description).
- `subject` in the attestation = the agent's vault/management address. Add `contracts/src/FxrpAgentBinding.sol`
  (thin reader, patterned on starter `FassetsAgentInfo.sol`) + `scripts/fassets/list-agents.ts`,
  `scripts/fassets/agent-info.ts`. If no live agent exists at demo time, use a labeled placeholder address but still
  query the live registry (documented as the only mock, per constraints).

## FDC Web2Json reserve proof (real round-trip)
Off-chain script `scripts/fdc/prove-reserves.ts` (patterned on starter `scripts/fdcExample/Web2Json.ts` +
`scripts/proofOfReserves/`):
1. **prepareRequest** → verifier `POST .../verifier/.../Web2Json/prepareRequest` with `{attestationType, sourceId,
   requestBody:{url, httpMethod, postProcessJq, abiSignature}}` → `abiEncodedRequest`. `url` = reserves endpoint
   (attestor-service exposes `/reserves/:subject` returning `{reserves}` JSON; the raw figure is public *reserves*,
   not the private liabilities — privacy preserved).
2. **submit** → `ContractRegistry.getFdcHub().requestAttestation(abiEncodedRequest, {value: fee})`; compute `roundId`
   from receipt block timestamp.
3. **wait** → poll `Relay.isFinalized(200, roundId)` with backoff (~90–180s).
4. **fetch proof** → DA Layer `POST .../api/v1/fdc/proof-by-request-round-raw` `{votingRoundId, requestBytes}`.
5. **decode** → build `{ merkleProof, data }` (`IWeb2Json.Proof`).

## Contract: both proofs required
`SolvencyVerifier.recordSolvency(SolvencyClaim claim, bytes teeSignature, IWeb2Json.Proof fdcProof)`:
1. stake gate. 2. TEE sig verify (P2). 3. `require(ContractRegistry.getFdcVerification().verifyJsonApi(fdcProof))`.
4. decode `fdcProof.data.responseBody.abiEncodedData` → attested `reserves`; require
   `keccak256(abi.encode(reserves, claim.salt)) == claim.reservesCommitment` (binds FDC reserves to the TEE-signed
   commitment). 5. require `claim.solvent == true`. 6. record + lock + emit `SolvencyVerified(id, subject, roundId)`.

## Verifiable fraud → slash
`raiseFraud(bytes32 attestationId, IWeb2Json.Proof settlementProof, uint256 liabilities, bytes32 salt)`:
- The issuer's `inputHash = keccak256(abi.encode(reserves, liabilities, salt))` committed at attest time; challenger
  reveals `liabilities`+`salt` and supplies a **fresh FDC proof** of actual reserves at/after T.
- If `keccak256(...) == stored inputHash` (reveal matches) **and** `attestedReserves < liabilities` → the "solvent"
  claim was false → `staking.slash(attestor, penalty, beneficiary)` + `registry.markRevoked(id)`; emit `FraudProven`.
- Slash logic is real and evidence-driven (no stub): both the commitment reveal and the FDC proof are checked on-chain.

## Related files
- Create: `contracts/src/FxrpAgentBinding.sol`, `scripts/fdc/prove-reserves.ts`, `scripts/fassets/{list-agents,agent-info}.ts`,
  `contracts/src/interfaces/` FDC/Web2Json imports from periphery.
- Modify: `SolvencyVerifier.sol` (add FDC proof + fraud path), `deploy.ts`.
- Reference: starter `scripts/fdcExample/Web2Json.ts`, `scripts/proofOfReserves/*`, `contracts/proofOfReserves/ProofOfReserves.sol`.

## Success criteria
Full FDC workflow runs on Coston2 (prepare→submit→finalize→proof→verify) and `recordSolvency` reverts without a
valid FDC proof, succeeds with both. Fraud script slashes stake on a proven-insolvent case. Integration test
(live Coston2, tagged, skippable in CI). Commit `feat: FDC Web2Json reserve proof + FXRP agent binding + verifiable slashing`.

## Security
Treat FDC response as untrusted external data — decode strictly by ABI, never as text/prompt. Bind FDC reserves to
the committed hash to prevent proof-swapping. Fraud reveal is cryptographically checked; penalty bounded by stake.

## Next
P4 orchestrates all of this off-chain (attestor-service), adds the frontend + `yarn demo`.
