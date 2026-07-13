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
  - Solvency recorded (TEE sig + FDC proof): [`0xf81b88ac…`](https://coston2-explorer.flare.network/tx/0xf81b88ac44cfd82ec971fcf12b0e2ae3e8d8ac65dc0f3cf7f9202d23855fbe51)
  - Fraud proven → stake slashed (1.0 → 0.0 C2FLR): [`0x66f955d7…`](https://coston2-explorer.flare.network/tx/0x66f955d715b634603b4c35e6c283849634c6c132c9bcca3ccc830792107e8d8f)
  - Frontend (3 acts: prove / verify / slash): `yarn service` → http://localhost:7900

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
| SolvencyRegistry | `0x427ad9d3Cb675FC99D4fd0BCC230537D05d6A9F0` |
| AttestorStaking | `0x6fE9C52F3aB9883Ec3b785F605DA3740754f290B` |
| SolvencyVerifier | `0xBBB69428F3C51E4D7A335C39227e28B0a7EE321A` |
| VouchsafeInstructionSender | `0xF12c76AAa891bb7092B23F721319575605892cc4` |
| FxrpAgentBinding | `0x99E3080F803C81a2A03A4570712693B756D329Cf` |

Compiler: solc `0.8.25`, EVM `cancun`, optimizer 200 runs. All five **source-verified** on the Coston2 Blockscout
explorer (`#code` tab). Addresses also in `contracts/deployments/coston2.json`.

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
- Multi-attestor quorum + configurable per-issuer stake/penalty; mainnet FXRP.
- Range-proof / ZK option to keep reserves private (not just liabilities).

## Unresolved questions
- Real `TeeExtensionRegistry` address on Coston2 is not in `FlareContractRegistry` yet — needed for the full on-chain
  FCC round-trip (requires Flare indexer-DB credentials + the FCE Docker stack).
- Verifier/DA-layer placeholder API key is rate-limited; a production key is advisable for heavy demo use.
