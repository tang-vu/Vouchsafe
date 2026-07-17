# Vouchsafe — Codebase Summary

Monorepo (yarn workspaces). Everything targets Flare Coston2 (chain id 114); Flare contracts are resolved via
`FlareContractRegistry` (`0xaD67…6019`) — no hardcoded addresses.

## `contracts/` — Hardhat, Solidity 0.8.25 / EVM cancun

| File | Responsibility |
|---|---|
| `src/SolvencyRegistry.sol` | Append-only, commitment-only attestation store indexed by subject; verifier-gated writes + revoke. Deterministic id `keccak256(subject, attestor, inputHash, nonce)`. |
| `src/AttestorStaking.sol` | Native-C2FLR stake; `stake` / `requestUnstake` (cooldown) / `withdraw` (nonReentrant) / `slash` / `lockUntil`. `minStake` gate; challenge-window lock prevents exit-before-slash. |
| `src/SolvencyVerifier.sol` | Core. `recordSolvency(claim, teeSig, fdcProof)` verifies the TEE signature (`ecrecover == teeAddress` over a chain+verifier-bound EIP-191 digest), verifies the FDC Web2Json proof **from the subject's owner-registered source**, binds attested reserves to `reservesCommitment`, checks the timestamp is recent, gates on the subject's effective stake, records, locks stake. `endorse(id)` lets an independent staked attestor back the claim (capped at `MAX_ENDORSERS=32`, stake locked a fresh window); `isQuorate(id)` reports the per-subject quorum. `raiseFraud(id, reserves, liabilities, salt)` = permissionless slashing of the recorder **and every endorser**: the reveal must open the stored `inputHash` with `reserves < liabilities` (no FDC needed — `inputHash` already fixes the asserted reserves). |
| `src/SolvencyVerifierAdmin.sol` | Abstract base: storage, owner-gated setters, FDC verifier resolution, per-subject `confidentialReserves` flag (endpoint serves a salted commitment instead of the raw total — reserves figure never on-chain), and `SubjectPolicy` (`minStake` / `slashPenalty` / `requiredEndorsements` per subject; zero = global fallback) with `requiredStakeFor` / `slashPenaltyFor`. |
| `src/VouchsafeInstructionSender.sol` | FCC InstructionSender footprint. Routes via `TeeExtensionRegistry.sendInstructions` when configured; otherwise emits an FCC-tagged event the attestor-service watches. |
| `src/FxrpAgentBinding.sol` | Read-only: resolves FXRP `AssetManager` + agent metadata via the registry (binds a subject to a real agent). |
| `src/XrplReserveProof.sol` | XRPL-native reserve-address control via FDC **Payment**: owner registers a subject's XRP address (standard hash); `challengeRef(subject, nonce)` derives a chain+contract-bound 32-byte memo reference; `proveControl` verifies the FDC proof, source-address hash, reference, success status, freshness — replay-safe via per-subject nonce + used-tx guards. `lastProof` / `isFresh` views. |
| `src/interfaces/*`, `src/mocks/Mock{Web2Json,Payment}Verifier.sol` | Local interfaces + test-only FDC verifier stubs. |
| `scripts/` | `deploy.ts` (records `startBlock` for event scans), `deploy-xrpl-reserve-proof.ts` (appends to deployments), `verify.ts`, `fassets/{list-agents,agent-info}.ts`. |
| `test/` | 63 unit tests (registry, staking, verifier FDC+fraud, confidential reserves, quorum+policy, instruction sender, XRPL proof). |

## `tee-extension/` — TypeScript confidential compute (simulated TEE)

| File | Responsibility |
|---|---|
| `src/solvency-compute.ts` | Sums reserves/liabilities, decides solvency, builds `inputHash` + `reservesCommitment` (salted with the private `reservesSalt` in confidential-reserves mode). Validates inputs. |
| `src/tee-signer.ts` | Holds the (simulated) enclave key; reproduces the on-chain `claimDigest` and signs EIP-191. |
| `src/action-handler.ts` | FCC action-handler pattern: decode → validate → compute (confidential) → sign. Raw figures never returned. |
| `src/server.ts` / `index.ts` | HTTP `/action` (FCC OPType/OPCommand), `/health`, `/pubkey`. |
| `src/fdc-common.ts` | Shared FDC plumbing for every attestation type: FdcHub fee+submit, voting-round derivation, Relay finalization wait, DA-layer proof fetch. |
| `src/fdc-reserves.ts` | FDC Web2Json round-trip (prepare + response decode over `fdc-common`), ported from the Flare starter helper. |
| `src/fdc-payment.ts` | FDC Payment (XRPL) round-trip: polls prepareRequest until the XRPL tx is indexed, then submit/finalize/decode into an `IPayment.Proof`. |
| `src/confidential-space-attestation.ts` | Reads the Confidential Space launcher's Google-signed attestation token (graceful null outside an enclave). |
| `src/lib.ts` | Library surface consumed by the attestor-service. |
| `src/self-test.ts` | Dependency-free crypto + privacy checks. |
| `Dockerfile` + `confidential-space/setup-confidential-space.sh` | Confidential Space workload image (MODE=0, in-enclave key) + one-command GCP deploy (Cloud Build, SA, confidential VM). |

## `attestor-service/` — orchestrator + API + frontend

| File | Responsibility |
|---|---|
| `src/orchestrator.ts` | `attest` (TEE sign → FDC proof → record) and `commitFraud` (sign a lie → record → prove → slash); `readAttestation` (incl. endorsements + quorum). |
| `src/attestation-history.ts` | Event-indexed history: paged `getLogs` over `SolvencyAsserted`/`AttestationRevoked` from the deployment `startBlock`, joined with live quorum state. |
| `src/quorum-endorser.ts` | Derived second attestor (deterministic key from the service key): funds/stakes itself once, `endorse(id)`; `ensureQuorumPolicy` owner helper. |
| `src/server.ts` / `index.ts` | Express API: `POST /api/attest`, `GET /api/attestation/:id`, `GET /api/attestations`, `POST /api/endorse`, `POST /api/fraud`, `GET /api/xrpl-proof/:subject`, `GET /api/health`; serves the frontend. `READ_ONLY=1` 403-gates every server-key-spending endpoint for public hosting. |
| `src/abis.ts` / `config.ts` | Human-readable ABIs (incl. `IPayment.Proof` tuple); env + deployment address + `startBlock` loading. |
| `src/demo.ts` / `src/xrpl-demo.ts` | Unattended `yarn demo` (happy + quorum + fraud) and `yarn demo:xrpl` (XRPL challenge payment → FDC Payment → `proveControl`), live on Coston2. |
| `src/xrpl-client.ts` / `src/xrpl-status.ts` | xrpl.js testnet client (faucet wallets, 1-drop memo challenge payment) and on-chain control-status reader. |
| `public/index.html` | 5-act UI: prove / verify / fraud / quorum+history / XRPL. |
| `public/wallet-connect.js` | EIP-1193 wallet integration: connect, add/switch Coston2, hand-rolled ABI encoding for `stake()` / `endorse(bytes32)` + reads. |
| `public/attestation-history.js` | Quorum panel + history table; endorses via the connected wallet or the service endorser fallback. |

## Key invariants
- Raw reserves/liabilities never leave the enclave process — absent from output, logs, and chain.
- `recordSolvency` requires **both** a valid TEE signature and a valid FDC proof; the attested reserves (plain
  mode) or the endpoint's salted commitment (confidential mode) must match the claim's `reservesCommitment`.
- Stake is locked for the challenge window on each assertion; slashing is only triggered by a cryptographically
  verifiable fraud proof (commitment reveal + FDC counter-proof of insolvency).
- Endorsing an attestation makes the endorser's stake slashable for the same claim; a subject's attestation is
  only `isQuorate` once its policy's `requiredEndorsements` independent endorsers have signed on.
