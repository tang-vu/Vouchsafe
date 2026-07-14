# Vouchsafe — Flare Summer Signal Submission

## 1. Project name
**Vouchsafe** — private, stake-backed proof-of-solvency for RWA issuers and FAsset agents on Flare.

## 2. Selected bounties
- **Interoperable Asset Products** — binds attestations to a real FXRP agent on Coston2 and uses **FDC (Web2Json)**
  to bring off-chain reserve data on-chain.
- **Confidential Compute Apps** — the solvency computation and all sensitive figures run inside a **FCC/TEE
  extension**; only a signed attestation reaches the chain.

Both are exercised in a single flow: `recordSolvency` requires **both** the TEE signature **and** the FDC proof, so
neither bounty is decorative.

## 3. Short product description
Issuers/agents prove `reserves ≥ liabilities` without disclosing the numbers. The check runs in a TEE, which signs a
commitment-only attestation; an FDC Web2Json proof attests the reserves; an on-chain verifier records "solvent at T"
after checking the TEE signature, the FDC proof, and that the attestor has posted a stake. Independent attestors can
**endorse** the record with their own stake until the issuer's **quorum policy** is met. Lying is punished: anyone
can prove insolvency (commitment reveal) and slash the attestor's — and every endorser's — stake in one transaction.

## 4. Target user
FXRP agents proving collateral sufficiency behind minted FXRP; RWA issuers and custodians who must demonstrate
backing to counterparties/regulators without publishing their full books.

## 5. Demo
- `yarn demo` — unattended end-to-end on Coston2 (happy path + quorum endorsement + fraud/slash). Video: _(placeholder)_.
- Live evidence (Coston2 explorer, v2 deployment):
  - Solvency recorded (TEE sig + FDC proof): [`0xb453bf85…`](https://coston2-explorer.flare.network/tx/0xb453bf855e2fdeff63f1c9701e1246b52a710aca11b76d09efd6799bc099df2a)
  - Quorum endorsement (independent stake, `quorate` false → true): [`0x4d632ff3…`](https://coston2-explorer.flare.network/tx/0x4d632ff3803de7b51d8bdfa784c397c86c71f90cd7fc931b94c09578e4a7dd03)
  - Fraud proven → stake slashed (1.0 → 0.0 C2FLR): [`0xcfa391b0…`](https://coston2-explorer.flare.network/tx/0xcfa391b0077b180ebc29b5406f55d044ba7e639c8f009b79e0a1991b803f2347)
  - Frontend (4 acts: prove / verify / slash / quorum + history, MetaMask-enabled): `yarn service` → http://localhost:7900

## 6. GitHub repo
This repository.

## 7. How it uses Flare
- **FAssets/FXRP:** subject bound to a real FXRP agent vault; `AssetManagerFXRP` + `AgentOwnerRegistry` resolved via
  `FlareContractRegistry`.
- **FDC:** full Web2Json round-trip (prepare → `FdcHub.requestAttestation` → `Relay` finalization → DA-layer proof →
  `FdcVerification.verifyWeb2Json`) to attest off-chain reserves.
- **FCC/TEE:** confidential solvency compute + enclave signature; verifier recovers the signer and requires it to
  equal the registered TEE address (the `fce-weather-insurance` settlement pattern). `VouchsafeInstructionSender`
  provides a real FCC InstructionSender footprint.
- **No hardcoded addresses** — everything via `ContractRegistry` (`0xaD67…6019`).

## 8. New vs. ported / integrated / improved (honest breakdown)

| Component | Source |
|---|---|
| `flare-hardhat-starter`: hardhat config (0.8.25/cancun), FDC prepare→FdcHub→DA-layer flow, `ProofOfReserves` / `FassetsAgentInfo` patterns | **Integrated** (Flare starter) |
| `flare-ai-skills` (fcc/fdc/fassets/smart-accounts/general): domain knowledge; TEE ecrecover-settlement pattern | **Referenced** (Flare skills/repos) |
| `@flarenetwork/flare-periphery-contracts`: `ContractRegistry`, `IWeb2Json`, `IAssetManager`, `IAgentOwnerRegistry`, `IFdcVerification` | **Integrated** (Flare package) |
| `fdc-reserves.ts` (FDC Web2Json round-trip) | **Ported + improved** from the starter helper (registry-resolved, typed, retrying) |
| `SolvencyRegistry`, `AttestorStaking`, `SolvencyVerifier`, `VouchsafeInstructionSender`, `FxrpAgentBinding` | **New** |
| Commitment scheme (`inputHash` / `reservesCommitment`) + FDC-reserves binding + evidence-based `raiseFraud` slashing | **New** |
| `tee-extension` (confidential compute, domain-separated EIP-191 signer, `/action` server, self-test) | **New** |
| `attestor-service` (orchestrator, API, 4-act frontend) + `yarn demo` | **New** |
| Multi-attestor **quorum** (`endorse` / `isQuorate`, endorser co-slashing) + per-subject `SubjectPolicy` (stake floor, penalty, required endorsements) | **New** |
| Event-indexed attestation history API + MetaMask wallet-connect (stake/endorse from the browser) | **New** |
| Deterministic attestation id; chain+verifier-bound signing domain | **Improved** design choices |

## 9. Contract addresses / deployment (Coston2, chain id 114)

| Contract | Address |
|---|---|
| SolvencyRegistry | `0x7dE3581C791F040B2df07520B4334C93DeF5C3E8` |
| AttestorStaking | `0x24d5f0B559E84d50f651b7e45577Baf638978e1E` |
| SolvencyVerifier | `0x59b044B0a2d17FE10336367B1d9f25C6DcB76686` |
| VouchsafeInstructionSender | `0x38e53EF3eF09BE3cF0C10Fdbb36c702747F32FfE` |
| FxrpAgentBinding | `0xc98F898f4717879237FB5eB5d82afe7BFD874ccc` |

Compiler: solc `0.8.25`, EVM `cancun`, optimizer 200 runs. All five **source-verified** on the Coston2 Blockscout
explorer (`#code` tab). Addresses also in `contracts/deployments/coston2.json`. (A previous v1 deployment —
verifier `0xBBB6…321A` — remains live and verified; v2 adds multi-attestor quorum and per-subject policy.)

## 12. Security review &amp; hardening
An adversarial review (report in `plans/reports/`) confirmed the signature layer sound (chain+contract-bound
digest, no cross-chain replay, no malleability; TS/Solidity digests byte-match) and drove these fixes:
- **FDC bound to an owner-registered per-subject source** — an attestor can no longer fabricate reserves from
  their own endpoint (`reservesSourceHash` + URL check).
- **Fraud uses the committed reserves, not a fresh proof** — post-recording reserve drift can't shield a lie;
  `raiseFraud` verifies the reveal against the stored `inputHash` alone.
- **Slashing covers unbonding funds and never reverts on zero** — an attestor can't dodge a slash by unstaking,
  and revocation always applies.
- **Recent-timestamp bound**, **CSPRNG nonce/salt**, **no trapped value in simulated mode**, **lockable FDC override**.

### Known limitations (by design / roadmap)
- **Fraud proof needs the committed `(reserves, liabilities, salt)` to be disclosed** by a party who knows them
  (auditor/counterparty) — the intended RWA model, not fully trustless. A ZK opening is future work.
- FDC proof freshness (≤14-day window) is not yet enforced; owner is trusted (production wants multisig/timelock).
- The public `/api/fraud` demo endpoint spends the service's own stake — demo-only.

## 10. What is real vs. simulated
Real on Coston2: confidential computation, TEE signature + on-chain `ecrecover`, the full FDC round-trip, FXRP agent
binding, staking/slashing. Simulated: the enclave (local process), remote attestation / code-hash whitelisting, and
the `TeeExtensionRegistry` round-trip (Flare has not published that registry on Coston2 yet). Signing and on-chain
verification are identical in both modes.

## 11. Roadmap
- Deploy the extension to real **GCP Confidential Space** (`MODE=0`), reproducible build, register the TEE + whitelist
  the code hash, set the enclave address via `setTeeAddress`, and point `VouchsafeInstructionSender` at the live
  `TeeExtensionRegistry`.
- Add an **XRPPayment** FDC path for XRPL-native reserve proofs alongside Web2Json.
- ~~Multi-attestor quorum + configurable per-issuer stake/penalty~~ — **shipped** (endorse/quorum + `SubjectPolicy`).
- Mainnet FXRP; unbonding/lock parameter tuning.
- Range-proof / ZK option to keep reserves private (not just liabilities).

## Unresolved questions
- Real `TeeExtensionRegistry` address on Coston2 is not in `FlareContractRegistry` yet — needed for the full on-chain
  FCC round-trip (requires Flare indexer-DB credentials + the FCE Docker stack).
- Verifier/DA-layer placeholder API key is rate-limited; a production key is advisable for heavy demo use.
