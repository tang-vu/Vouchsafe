# Vouchsafe — Private, Stake-Backed Proof-of-Solvency on Flare

**Hackathon:** Flare Summer Signal (DoraHacks, deadline 14 Aug 2026). Targets **both** bounties:
Interoperable Asset Products (FXRP + FDC) and Confidential Compute Apps (FCC/TEE).

**One line:** prove you can cover your liabilities without revealing your books, and lose your stake if you lied.

## Locked decisions (user-approved)
- **FCC depth:** Hybrid — TEE extension in *simulated* mode (free, unattended) **+** a real `InstructionSender`
  registered on `TeeExtensionRegistry` (Coston2) for genuine on-chain FCC footprint; MODE=0 Confidential-Space
  upgrade documented, not required for the demo.
- **TEE language:** TypeScript (unifies extension + attestor-service + frontend).
- **FDC reserve proof:** Web2Json (attest an off-chain reserves API).

## Corrections applied vs master prompt (per live Flare docs)
- **Solidity `0.8.25` + `cancun`** (starter's version; `0.8.19` cannot compile cancun — needs ≥0.8.24).
- **FCC MODE semantics:** `MODE=0`=production attestation, `MODE=1`=simulated. Simulated dev path =
  `SIMULATED_TEE=true` + `LOCAL_MODE=true`/`MODE=1`. Labeled correctly throughout.
- **Never hardcode addresses** — resolve via `ContractRegistry` (periphery lib wraps `FlareContractRegistry`).

## Core flow
Issuer figures → attestor-service → **tee-extension** (compute reserves≥liabilities, sign result, never reveal raw)
→ attestor-service builds **FDC Web2Json** reserve proof → on-chain **SolvencyVerifier** requires *both* TEE
signature **and** FDC proof **and** active attestor stake → writes **SolvencyRegistry** → fraud path slashes via
**AttestorStaking**. Subject can be a real **FXRP agent** on Coston2 (agent info read via `getAgentInfo`).

## Contracts (Solidity 0.8.25, cancun) — detail in phase-01
- `SolvencyRegistry.sol` — stores/indexes attestations by subject; `onlyVerifier` writes; revoke on slash.
- `AttestorStaking.sol` — stake / cooldown-unstake / `slash` (onlySlasher); `minStake` gate; reentrancy-guarded.
- `SolvencyVerifier.sol` — verifies TEE EIP-191 signature (`ecrecover==teeAddress`) + `IWeb2Json` FDC proof +
  stake, records attestation, exposes verifiable `raiseFraud` → slash. Resolves FDC via `ContractRegistry`.
- `VouchsafeInstructionSender.sol` — real FCC on-chain footprint; routes a `SOLVENCY/PROVE` instruction through
  `TeeExtensionRegistry` (Hybrid path).

## Phases (stop for approval after each; compile + test + deploy where relevant; commit at end)
| # | Phase | File | Gate |
|---|-------|------|------|
| 1 | Scaffolding & on-chain skeleton | [phase-01](phase-01-scaffolding-onchain-skeleton.md) | compile + unit tests + deploy to Coston2 |
| 2 | Confidential Compute extension (simulated) | [phase-02](phase-02-confidential-compute-extension.md) | local run: inputs→signed attestation→verified on Coston2 |
| 3 | FAssets + FDC integration | [phase-03](phase-03-fassets-fdc-integration.md) | full FDC round-trip + agent bind; both proofs required |
| 4 | Attestor-service + frontend + `yarn demo` | [phase-04](phase-04-attestor-service-frontend-demo.md) | unattended happy path + fraud/slash on Coston2 |
| 5 | Submission artefacts | [phase-05](phase-05-submission-artefacts.md) | SUBMISSION.md, README, architecture.md honest & complete |

## Acceptance criteria (definition of done)
- `yarn demo` runs the full happy path on Coston2 unattended, prints explorer link to a recorded attestation.
- Third party verifies "solvent at T" **without** seeing the numbers (only inputHash).
- Fraud path slashes an attestor's stake.
- Both TEE attestation **and** FDC proof required to record solvency.
- Tests pass; contracts deployed to Coston2 with addresses in SUBMISSION.md.
- SUBMISSION.md honestly separates new work from starter/skill-provided work.

## Key risks
- FDC round finalization latency (~90–180s) → retry/poll with backoff in scripts.
- No available FXRP agent on Coston2 at demo time → fall back to a labeled agent address, still read live registry.
- Verifier/DA-layer rate limits on placeholder API keys → document key setup; keep retries.
