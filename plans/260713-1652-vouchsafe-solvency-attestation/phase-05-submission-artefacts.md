# Phase 5 — Submission Artefacts

**Priority:** P0 · **Status:** planned · Generated last, from the working system.

## Goal
Produce honest, complete submission docs mapped to the required DoraHacks fields, plus README + architecture diagram.

## SUBMISSION.md — mapped to the 9 required fields
1. **Project name** — Vouchsafe.
2. **Selected bounties** — Interoperable Asset Products + Confidential Compute Apps (justify both, truthfully).
3. **Short product description** — private, stake-backed proof-of-solvency for RWA issuers / FAsset agents.
4. **Target user** — FXRP agents, RWA issuers, custodians who must prove backing without disclosing books.
5. **Demo link/video** — placeholder + the `yarn demo` explorer links.
6. **GitHub repo** — this repo.
7. **How it uses Flare** — FXRP/FAssets binding, FDC Web2Json reserve proof, FCC/TEE confidential compute, all via
   `ContractRegistry`.
8. **New vs ported/integrated/improved** — scrupulously honest table (see below).
9. **Contract addresses / deployment details** — Coston2 addresses from P1/P3 deploy output + explorer links.
10. **Roadmap** — MODE=0 Confidential Space deploy, real XRPL XRPPayment proof, mainnet FXRP, multi-attestor quorum.

## "New vs integrated" honesty table (fill at submission)
| Component | Source |
|---|---|
| `flare-hardhat-starter` config, FDC/FAssets example scripts, `FassetsAgentInfo`/`ProofOfReserves` patterns | Flare starter (integrated) |
| `flare-*` skills knowledge, fce-* signing/verify pattern | Flare skills/repos (referenced) |
| `SolvencyRegistry`, `AttestorStaking`, `SolvencyVerifier`, `VouchsafeInstructionSender`, fraud/slash logic | **new** |
| tee-extension solvency compute + signer, attestor-service, frontend, `yarn demo` | **new** |
| Commitment binding (inputHash/reservesCommitment) + verifiable slashing | **new** |

## docs/architecture.md
Mermaid data-flow: inputs → tee-extension (enclave boundary) → signed attestation + FDC Web2Json proof →
SolvencyVerifier (ecrecover + verifyJsonApi + commitment bind + stake) → SolvencyRegistry; fraud → slash. Note
simulated-vs-real TEE clearly.

## README.md
Setup (corepack yarn, `.env` from `.env.example`, Coston2 faucet), per-workspace run instructions, `yarn demo`,
architecture summary, the two flagged corrections (0.8.25, MODE semantics), and simulated-vs-real TEE note.

## Related files
- Create: `SUBMISSION.md`, `README.md`, `docs/architecture.md`. Update `docs/` per documentation-management rules.

## Success criteria
All 6 acceptance criteria (plan.md) demonstrably met; SUBMISSION.md maps every required field; new-vs-integrated
section separates starter/skill-provided work from ours. Commit `docs: submission artefacts, README, architecture`.

## Next
Optional: record demo video; request Flare indexer-DB creds to run the full MODE=0 Confidential Space path.
