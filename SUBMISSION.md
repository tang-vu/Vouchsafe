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
after checking the TEE signature, the FDC proof, and that the attestor has posted a stake. Lying is punished: anyone
can prove insolvency (commitment reveal + FDC counter-proof) and slash the attestor's stake.

## 4. Target user
FXRP agents proving collateral sufficiency behind minted FXRP; RWA issuers and custodians who must demonstrate
backing to counterparties/regulators without publishing their full books.

## 5. Demo
- `yarn demo` — unattended end-to-end on Coston2 (happy path + fraud/slash). Video: _(placeholder)_.
- Live evidence (Coston2 explorer):
  - Solvency recorded (TEE sig + FDC proof): [`0x3c9119e6…`](https://coston2-explorer.flare.network/tx/0x3c9119e6b6320c1ef5c2f2ccfac12b3c4f83d7463ac1fc7af304cd6c3caea414)
  - Fraud proven → stake slashed: [`0x72c0ec03…`](https://coston2-explorer.flare.network/tx/0x72c0ec037208645883c1c2f82a837ccd0b180e58be4c08cd2d4ffe9c069c9fa8)

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
| `attestor-service` (orchestrator, API, 3-view frontend) + `yarn demo` | **New** |
| Deterministic attestation id; chain+verifier-bound signing domain | **Improved** design choices |

## 9. Contract addresses / deployment (Coston2, chain id 114)

| Contract | Address |
|---|---|
| SolvencyRegistry | `0x523fb260db767c96BCc2D854215305723a13A3dC` |
| AttestorStaking | `0x6D2E0c4AFf375e7103cc9fca0D6474A6DBb394f5` |
| SolvencyVerifier | `0xda8429BEfF99D503416dA3a749792Decf73C451B` |
| VouchsafeInstructionSender | `0x818b7d42f28dBc00C32FFEEd0c052b8f65869f1c` |
| FxrpAgentBinding | `0xbF3E4fBbFe14AFba2f3468a1F020D5eE014f2fa8` |

Compiler: solc `0.8.25`, EVM `cancun`, optimizer 200 runs. Addresses also in `contracts/deployments/coston2.json`.

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
- Multi-attestor quorum + configurable per-issuer stake/penalty; mainnet FXRP.
- Range-proof / ZK option to keep reserves private (not just liabilities).

## Unresolved questions
- Real `TeeExtensionRegistry` address on Coston2 is not in `FlareContractRegistry` yet — needed for the full on-chain
  FCC round-trip (requires Flare indexer-DB credentials + the FCE Docker stack).
- Verifier/DA-layer placeholder API key is rate-limited; a production key is advisable for heavy demo use.
