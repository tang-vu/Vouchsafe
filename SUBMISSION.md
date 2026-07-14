# Vouchsafe — Flare Summer Signal Submission

## 1. Project name
**Vouchsafe** — private, stake-backed proof-of-solvency for RWA issuers and FAsset agents on Flare.

## 2. Selected bounties
- **Interoperable Asset Products** — binds attestations to a real FXRP agent on Coston2 and uses **two FDC
  attestation types**: **Web2Json** brings off-chain reserve totals on-chain, and **Payment (XRPL)** proves the
  subject controls its XRP-ledger reserve address via a challenge payment — an XRPL-native rail with no custodian
  API in the loop.
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
- `yarn demo` — unattended end-to-end on Coston2 (happy path + quorum endorsement + fraud/slash).
- `yarn demo:xrpl` — XRPL-native rail: real XRPL testnet challenge payment → FDC Payment proof → on-chain record.
- Video: **https://youtu.be/1t-Nm9hdITs** (3:02, 1080p, narrated + English subtitles; captured from the live UI
  incl. the real-enclave Act I and the on-chain slash).
- Live evidence (Coston2 explorer, v2 deployment):
  - Solvency recorded (TEE sig + FDC proof): [`0xb453bf85…`](https://coston2-explorer.flare.network/tx/0xb453bf855e2fdeff63f1c9701e1246b52a710aca11b76d09efd6799bc099df2a)
  - Quorum endorsement (independent stake, `quorate` false → true): [`0x4d632ff3…`](https://coston2-explorer.flare.network/tx/0x4d632ff3803de7b51d8bdfa784c397c86c71f90cd7fc931b94c09578e4a7dd03)
  - Fraud proven → stake slashed (1.0 → 0.0 C2FLR): [`0xcfa391b0…`](https://coston2-explorer.flare.network/tx/0xcfa391b0077b180ebc29b5406f55d044ba7e639c8f009b79e0a1991b803f2347)
  - **XRPL control proven** (FDC Payment, challenge memo): Coston2 [`0x354c0811…`](https://coston2-explorer.flare.network/tx/0x354c0811f8084604e6c4289217e985fce1500fdbe22e30396911619356d464e9)
    ← XRPL testnet payment [`FDA9BA6A…`](https://testnet.xrpl.org/transactions/FDA9BA6A13897A3A0FD674A2659A56CD00031C3168E7E6B4371CA725A5FC6DBD)
  - **REAL TEE — solvency recorded with a signature born inside GCP Confidential Space (AMD SEV)**:
    [`0x8f0595ba…`](https://coston2-explorer.flare.network/tx/0x8f0595ba1a94b29988df6e9bb139a5cbe8c94f4c580dbc23fefe3ed641202d47)
    — enclave address `0x8dCdC4017e4a65BB2e0266E8CD26aA7C10bA9E51`, image digest `sha256:848c6b62…` bound in a
    Google-signed attestation token (`hwmodel: GCP_AMD_SEV`, `dbgstat: disabled-since-boot`); quorum endorsement
    on the same record: [`0x8ccb9e95…`](https://coston2-explorer.flare.network/tx/0x8ccb9e95405a61ab206ee4e78d6a53bda8d16841fd308ec94247194ddd101ba4).
    Full evidence: `plans/260714-1037-flare-submission-final-push/confidential-space-live-run-evidence.md`.
  - Frontend (5 acts: prove / verify / slash / quorum + history / XRPL, MetaMask-enabled): `yarn service` → http://localhost:7900
  - Public judge-testable hosting: `READ_ONLY=1` mode + root `Dockerfile` + `fly.toml` ship in the repo
    (`fly deploy` — hosted URL to be added here).

## 6. GitHub repo
This repository.

## 7. How it uses Flare
- **FAssets/FXRP:** subject bound to a real FXRP agent vault; `AssetManagerFXRP` + `AgentOwnerRegistry` resolved via
  `FlareContractRegistry`.
- **FDC:** two attestation types through the full round-trip (prepare → `FdcHub.requestAttestation` → `Relay`
  finalization → DA-layer proof → on-chain verify): **Web2Json** attests off-chain reserve totals
  (`verifyWeb2Json`), and **Payment** attests a real XRPL challenge payment (`verifyPayment`) proving control of
  the registered XRP reserve address.
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
| `XrplReserveProof` — XRPL reserve-address control via FDC **Payment** (challenge memo, replay-safe, freshness) | **New** |
| `fdc-payment.ts` + `fdc-common.ts` (shared FDC plumbing) + `xrpl-client.ts` (xrpl.js challenge payment) + `yarn demo:xrpl` | **New** |
| Confidential Space scaffolding: `tee-extension/Dockerfile`, `/attestation` token endpoint, one-command gcloud deploy script + guide | **New** |
| Public-demo hosting: `READ_ONLY` service mode, root `Dockerfile`, `fly.toml`, Act V XRPL UI | **New** |
| Deterministic attestation id; chain+verifier-bound signing domain | **Improved** design choices |

## 9. Contract addresses / deployment (Coston2, chain id 114)

| Contract | Address |
|---|---|
| SolvencyRegistry | `0x7dE3581C791F040B2df07520B4334C93DeF5C3E8` |
| AttestorStaking | `0x24d5f0B559E84d50f651b7e45577Baf638978e1E` |
| SolvencyVerifier | `0x59b044B0a2d17FE10336367B1d9f25C6DcB76686` |
| VouchsafeInstructionSender | `0x38e53EF3eF09BE3cF0C10Fdbb36c702747F32FfE` |
| FxrpAgentBinding | `0xc98F898f4717879237FB5eB5d82afe7BFD874ccc` |
| XrplReserveProof | `0x878Fe3305cC23aDfa6CfF10E1B9e811e9A2Ac9f0` |

Compiler: solc `0.8.25`, EVM `cancun`, optimizer 200 runs. All six **source-verified** on the Coston2 Blockscout
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
Real on Coston2: confidential computation, TEE signature + on-chain `ecrecover`, both FDC round-trips (Web2Json +
XRPL Payment), FXRP agent binding, staking/slashing, XRPL reserve-address control proofs — **and the enclave
itself**: the extension was deployed to **GCP Confidential Space (AMD SEV, production image, debug disabled)**
via the repo's one-command setup (`tee-extension/confidential-space/`), the signing key was generated in-enclave,
and a solvency attestation was recorded on Coston2 with that key (evidence links in §5; Google-signed attestation
token binds the exact image digest). The `yarn demo` fraud act intentionally refuses to run against the real
enclave — a genuine TEE will not sign a false claim (it exists to demo the compromised-key scenario in simulated
mode). Still simulated/pending: the `TeeExtensionRegistry` round-trip (Flare has not published that registry on
Coston2 yet). Signing and on-chain verification are identical in both modes.

## 11. Roadmap
- ~~Multi-attestor quorum + configurable per-issuer stake/penalty~~ — **shipped** (endorse/quorum + `SubjectPolicy`).
- ~~XRPL-native FDC path alongside Web2Json~~ — **shipped** (`XrplReserveProof` + FDC Payment, live evidence above).
- ~~Confidential Space packaging~~ — **shipped as scaffolding** (image, attestation endpoint, deploy script);
  running it needs a billing-enabled GCP project, then `setTeeAddress` flips the trust root to the real enclave.
- Point `VouchsafeInstructionSender` at the live `TeeExtensionRegistry` once Flare publishes it on Coston2.
- Mainnet FXRP; unbonding/lock parameter tuning.
- Range-proof / ZK option to keep reserves private (not just liabilities).

## Unresolved questions
- Real `TeeExtensionRegistry` address on Coston2 is not in `FlareContractRegistry` yet — needed for the full on-chain
  FCC round-trip (requires Flare indexer-DB credentials + the FCE Docker stack).
- Verifier/DA-layer placeholder API key is rate-limited; a production key is advisable for heavy demo use.
- Confidential Space run + public demo hosting + video recording are user actions: enable GCP billing then run
  `setup-confidential-space.sh`; `fly deploy` for the hosted demo; record per the storyboard script.
