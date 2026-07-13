# Phase 1 — Scaffolding & On-Chain Skeleton

**Priority:** P0 · **Status:** planned · Base = `flare-hardhat-starter` (cloned to scratchpad).

## Goal
Monorepo (yarn workspaces) + Hardhat `contracts/` workspace from the starter. Implement the three core contracts
with interfaces, events, NatSpec. Verifier accepts a **stubbed** attestation format this phase (real TEE+FDC wiring
lands in P2/P3). Unit tests for staking/slashing + registry storage. Deploy to Coston2, print addresses.

## Repo layout
```
vouchsafe/  package.json (workspaces: contracts, tee-extension, attestor-service, frontend)
├── contracts/   hardhat.config.ts (0.8.25/cancun, coston2=114), src/, scripts/deploy.ts, test/
├── tee-extension/       (P2)   ├── attestor-service/ (P4)   ├── frontend/ (P4)
├── .env.example  README.md  docs/architecture.md
```
- yarn classic (1.22.22 via corepack). Copy starter's `hardhat.config.ts`, `.env.example`, periphery deps.
- Contracts live under `contracts/src/` (config `paths.sources`), keep starter examples out of build path.

## Contract interfaces (0.8.25, cancun; OZ ^5 for Ownable/ReentrancyGuard)

```solidity
// SolvencyRegistry.sol — storage + index
struct SolvencyAttestation {
    address subject;      // issuer/agent (may be an FXRP agent vault/mgmt address)
    address attestor;     // who staked + submitted
    bytes32 inputHash;    // commitment to private inputs; raw numbers never on-chain
    bytes32 reservesRef;  // hash/commitment tying to the FDC-attested reserves (P3)
    uint64  timestamp;    // assertion time T
    bool    solvent;      // asserted result
    bool    revoked;      // set true on slash
}
event SolvencyAsserted(bytes32 indexed id, address indexed subject, address indexed attestor, bytes32 inputHash, uint64 timestamp);
event AttestationRevoked(bytes32 indexed id, address indexed subject);
function recordAttestation(SolvencyAttestation calldata a) external returns (bytes32 id); // onlyVerifier
function markRevoked(bytes32 id) external;                                                 // onlyVerifier
function getAttestation(bytes32 id) external view returns (SolvencyAttestation memory);
function latestForSubject(address subject) external view returns (bytes32 id);

// AttestorStaking.sol — economic accountability
function stake() external payable;                       // adds to msg.sender stake
function requestUnstake(uint256 amount) external;        // starts cooldown
function withdraw() external;                            // after cooldown, if not locked; nonReentrant
function slash(address attestor, uint256 amount, address beneficiary) external; // onlySlasher(verifier)
function lockUntil(address attestor, uint64 ts) external; // onlySlasher; bumps stake lock on new attestation
function stakeOf(address a) external view returns (uint256);
function minStake() external view returns (uint256);
event Staked(address indexed a, uint256 amount); event Slashed(address indexed a, uint256 amount, address beneficiary);

// SolvencyVerifier.sol — the brain (stub verify this phase)
function teeAddress() external view returns (address); // registered TEE signer (settable by owner in P2)
function recordSolvency(/* claim, teeSignature, fdcProof */) external; // stub -> real in P2/P3
```

## Related files
- Create: `contracts/src/{SolvencyRegistry,AttestorStaking,SolvencyVerifier}.sol`,
  `contracts/src/interfaces/{ISolvencyRegistry,IAttestorStaking}.sol`, `contracts/scripts/deploy.ts`,
  `contracts/test/*.ts`, root `package.json`, `contracts/hardhat.config.ts`, `.env.example`.
- Reference (read-only): scratchpad `flare-hardhat-starter/{hardhat.config.ts,package.json}`, `FassetsAgentInfo.sol`.

## Implementation steps
1. Root `package.json` workspaces + corepack yarn. 2. `contracts/` from starter config; prune unused example
dirs from source path. 3. Write registry (storage/index/events/NatSpec). 4. Write staking (stake/cooldown-unstake/
slash/lock, ReentrancyGuard, minStake, Ownable sets slasher=verifier). 5. Write verifier skeleton (stores
registry+staking+teeAddress; `recordSolvency` stub writes registry after a placeholder check). 6. `deploy.ts`
deploys all three, wires slasher/verifier roles, prints addresses. 7. Unit tests (ethers v6 + chai): stake→attest→
slash reduces stake; unstake cooldown blocks early withdraw; registry stores + revokes; access control reverts.

## Success criteria
`yarn workspace contracts hardhat compile` clean; all unit tests green; deployed to Coston2 with printed addresses
+ explorer links. Commit `feat: on-chain solvency registry, staking, verifier skeleton`.

## Security
Access control (onlyVerifier writes registry; onlySlasher slashes). ReentrancyGuard on withdraw. Unstake cooldown
prevents dodging a pending slash. No raw financial values on-chain (only `inputHash`). No secrets committed.

## Next
P2 replaces the verifier stub with real TEE EIP-191 signature verification + sets `teeAddress` from the extension.
