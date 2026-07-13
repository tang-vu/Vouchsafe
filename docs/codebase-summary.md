# Vouchsafe — Codebase Summary

Monorepo (yarn workspaces). Everything targets Flare Coston2 (chain id 114); Flare contracts are resolved via
`FlareContractRegistry` (`0xaD67…6019`) — no hardcoded addresses.

## `contracts/` — Hardhat, Solidity 0.8.25 / EVM cancun

| File | Responsibility |
|---|---|
| `src/SolvencyRegistry.sol` | Append-only, commitment-only attestation store indexed by subject; verifier-gated writes + revoke. Deterministic id `keccak256(subject, attestor, inputHash, nonce)`. |
| `src/AttestorStaking.sol` | Native-C2FLR stake; `stake` / `requestUnstake` (cooldown) / `withdraw` (nonReentrant) / `slash` / `lockUntil`. `minStake` gate; challenge-window lock prevents exit-before-slash. |
| `src/SolvencyVerifier.sol` | Core. `recordSolvency(claim, teeSig, fdcProof)` verifies the TEE signature (`ecrecover == teeAddress` over a chain+verifier-bound EIP-191 digest), verifies the FDC Web2Json proof **from the subject's owner-registered source**, binds attested reserves to `reservesCommitment`, checks the timestamp is recent, gates on stake, records, locks stake. `raiseFraud(id, reserves, liabilities, salt)` = permissionless slashing: the reveal must open the stored `inputHash` with `reserves < liabilities` (no FDC needed — `inputHash` already fixes the asserted reserves). |
| `src/VouchsafeInstructionSender.sol` | FCC InstructionSender footprint. Routes via `TeeExtensionRegistry.sendInstructions` when configured; otherwise emits an FCC-tagged event the attestor-service watches. |
| `src/FxrpAgentBinding.sol` | Read-only: resolves FXRP `AssetManager` + agent metadata via the registry (binds a subject to a real agent). |
| `src/interfaces/*`, `src/mocks/MockWeb2JsonVerifier.sol` | Local interfaces + a test-only FDC verifier stub. |
| `scripts/` | `deploy.ts`, `verify.ts`, `fassets/{list-agents,agent-info}.ts`. |
| `test/` | 24 unit tests (registry, staking, verifier FDC+fraud, instruction sender). |

## `tee-extension/` — TypeScript confidential compute (simulated TEE)

| File | Responsibility |
|---|---|
| `src/solvency-compute.ts` | Sums reserves/liabilities, decides solvency, builds `inputHash` + `reservesCommitment`. Validates inputs. |
| `src/tee-signer.ts` | Holds the (simulated) enclave key; reproduces the on-chain `claimDigest` and signs EIP-191. |
| `src/action-handler.ts` | FCC action-handler pattern: decode → validate → compute (confidential) → sign. Raw figures never returned. |
| `src/server.ts` / `index.ts` | HTTP `/action` (FCC OPType/OPCommand), `/health`, `/pubkey`. |
| `src/fdc-reserves.ts` | FDC Web2Json round-trip (prepare → FdcHub → Relay finalize → DA proof), ported from the Flare starter helper. |
| `src/lib.ts` | Library surface consumed by the attestor-service. |
| `src/self-test.ts` | Dependency-free crypto + privacy checks. |

## `attestor-service/` — orchestrator + API + frontend

| File | Responsibility |
|---|---|
| `src/orchestrator.ts` | `attest` (TEE sign → FDC proof → record) and `commitFraud` (sign a lie → record → prove → slash); `readAttestation`. |
| `src/server.ts` / `index.ts` | Express API: `POST /api/attest`, `GET /api/attestation/:id`, `POST /api/fraud`, `GET /api/health`; serves the frontend. |
| `src/abis.ts` / `config.ts` | Human-readable ABIs; env + deployment address loading. |
| `src/demo.ts` | Unattended `yarn demo` (happy + fraud paths, live on Coston2). |
| `public/index.html` | Minimal 3-view UI: issue / verify / fraud. |

## Key invariants
- Raw reserves/liabilities never leave the enclave process — absent from output, logs, and chain.
- `recordSolvency` requires **both** a valid TEE signature and a valid FDC proof; the attested reserves must match
  the claim's `reservesCommitment`.
- Stake is locked for the challenge window on each assertion; slashing is only triggered by a cryptographically
  verifiable fraud proof (commitment reveal + FDC counter-proof of insolvency).
