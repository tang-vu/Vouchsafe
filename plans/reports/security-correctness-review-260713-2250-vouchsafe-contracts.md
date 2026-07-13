# Vouchsafe — Security & Correctness Review

Date: 2026-07-13 · Reviewer: code-reviewer (staff, production-readiness)
Scope: `contracts/src/*`, `contracts/src/interfaces/*`, `mocks/MockWeb2JsonVerifier`, `tee-extension/src/{solvency-compute,tee-signer,action-handler,server,fdc-reserves,config,types,prove-record-fdc}`, `attestor-service/src/{orchestrator,server,abis,config}`. Cross-checked against `contracts/test/*`.
Network: Flare Coston2 (114). Stack: Solidity 0.8.25/cancun, OZ v5, ethers v6.

## Verdict
The signature scheme is sound and byte-matches the TS signer (verified). The economic/fraud layer and the FDC "second proof" leg have real soundness gaps that would break the stake-backed guarantee in production even though every unit test passes. No finding lets an outsider steal funds without the owner or TEE key, but several let a malicious *staked attestor* escape slashing or fabricate the reserves side. Ranked below.

---

## HIGH

### H1 — FDC proof is not bound to the subject or to an approved reserves source
`contracts/src/SolvencyVerifier.sol:123-127` (`_attestedReserves`), used by `recordSolvency:146-147`.

`_attestedReserves` calls `verifyWeb2Json(fdcProof)` then decodes `responseBody.abiEncodedData` to a single `reserves` uint256. It never inspects `fdcProof.data.requestBody.url` and never relates the proof to `claim.subject`. The only binding is `keccak256(abi.encode(reserves)) == claim.reservesCommitment`.

The TEE (`action-handler.ts` → `solvency-compute.ts`) does **not** fetch reserves — it sums the caller-supplied `req.reserves[]` and commits them. So the *same actor* supplies (a) the reserves fed to the TEE and (b) the endpoint FDC attests (`RESERVES_URL`, a single global env var; a gist in the demo). FDC is supposed to be the independent ground-truth leg, but on-chain nothing pins which URL/source is acceptable or that it belongs to `subject`.

Failure scenario: a staked attestor stands up `https://evil.example/reserves` returning `{"reserves": 10_000_000}`, feeds the TEE `reserves=[10000000]`, gets a TEE signature (honest TEE, garbage input), gets FDC to attest their own endpoint, `reservesCommitment` matches → `recordSolvency` succeeds. A fabricated "solvent" attestation is now on-chain and, per H4, essentially un-slashable. `subject` is decorative; subject A can also be attested using subject B's reserves proof.

Fix: store an owner-approved source binding and enforce it, e.g. `require(keccak256(bytes(fdcProof.data.requestBody.url)) == approvedReservesSourceHash[claim.subject])` (or a per-subject source id), so the reserves proof must come from a source the subject/owner pre-registered. Without a trusted, non-attestor-controlled source, the FDC leg provides no guarantee.

### H2 — Attestor can escape slashing (and even revocation) by unbonding after the lock expires
`contracts/src/SolvencyVerifier.sol:176-196` (`raiseFraud`) + `contracts/src/AttestorStaking.sol:71-119` (`requestUnstake` / `slash`).

Three coupled issues:
1. `raiseFraud` enforces **no challenge-window deadline** — it can be called at any time.
2. `lockUntil` (set in `recordSolvency:164` to `block.timestamp + challengeWindow`) only blocks unbonding *during* the window. After it expires, `requestUnstake` moves funds to `pendingWithdrawal`, and `slash` (line 105-109) only debits `s.amount` — it **never touches `pendingWithdrawal`**. After `unbondingPeriod`, `withdraw` removes them entirely.
3. `slash` reverts with "nothing to slash" when `s.amount == 0` (line 107), and `raiseFraud` calls `registry.markRevoked(id)` *then* `staking.slash` atomically — so if slash reverts, **the whole tx reverts and the fraudulent attestation is not even marked revoked**.

Failure scenario: attestor records a lie, waits out `challengeWindow` (fraud often only discoverable later — liabilities are private), `requestUnstake(all)` → `withdraw`. A challenger who later obtains the figures calls `raiseFraud`: `s.amount == 0` → slash reverts → revocation reverts. The lie stands and no stake is lost.

Fixes (any/all): (a) record a trusted `recordedAt = block.timestamp` and `require(block.timestamp <= recordedAt + challengeWindow)` in `raiseFraud` — but note this shortens the detection window (see H4); or preferably (b) make `slash` draw from `pendingWithdrawal` as well as `amount` and keep stake locked through a dispute period; and (c) decouple `markRevoked` from slash success so a proven-fraudulent record can always be flagged even if the stake is already gone (cap slash to available, don't revert on zero).

### H3 — `raiseFraud` re-fetches *current* FDC reserves instead of the committed reserves, letting a guilty attestor escape when reserves change
`contracts/src/SolvencyVerifier.sol:185-190`.

`inputHash` committed the **record-time** reserves (`keccak256(reserves, liabilities, salt)`). `raiseFraud` computes `reserves` from a **fresh** FDC proof (current value) and requires `keccak256(reserves_now, liabilities, salt) == att.inputHash`. This only holds if `reserves_now == reserves_at_record`. If the reserves endpoint value changed at all between recording and the challenge, the reveal cannot open `inputHash` → `"reveal mismatch"` → fraud fails.

Failure scenario: fraudulent record at reserves=1,500,000; endpoint later returns 1,400,000 (natural drift, or attacker-controlled per H1). Honest challenger with correct `liabilities`+`salt` calls `raiseFraud` with a fresh proof (1,400,000) → reverts. Guilty attestor escapes. The fraud test (`solvency-verifier.test.ts:121-134`) only ever passes `buildProof(1000n)` matching the record — the divergent case is untested.

The FDC proof in `raiseFraud` is both **redundant** (inputHash already binds reserves, itself FDC-validated at record time) and **harmful** (adds a false equality constraint). Fix: drop `fdcProof` from `raiseFraud` entirely; verify the reveal against the stored `att.inputHash` (and optionally `att.reservesCommitment`) only, then `require(reserves < liabilities)`.

### H4 — Slashing is unenforceable without disclosure of the secret salt (fraud path is effectively opt-in)
`contracts/src/SolvencyVerifier.sol:176-189`; salt origin `attestor-service/src/orchestrator.ts:89`, `action-handler.ts` (salt taken from the request).

`raiseFraud` requires the challenger to supply `(liabilities, salt)` that open `inputHash`. `salt` is chosen by the attestor/caller and is never escrowed, committed-to-a-third-party, or revealed on-chain. A genuinely adversarial attestor simply never discloses `salt`, so **no one can ever construct a passing `raiseFraud`**, regardless of actual insolvency. The economic guarantee then collapses to "trust the TEE" — and an honest TEE would not have signed the lie in the first place.

This is arguably an intended limitation (challengers are expected to obtain figures off-chain under audit), but it directly undercuts the "stake-backed" framing and should be surfaced. Fix/mitigation: escrow the salt encrypted to a designated auditor/regulator key, or require the commitment be openable by a bonded dispute process, or document explicitly that slashing depends on off-chain salt disclosure.

---

## MEDIUM

### M1 — Raw reserves are exposed on-chain via FDC proof calldata; commitment is unsalted
`recordSolvency` `fdcProof` param; `solvency-compute.ts:45`; doc `interfaces/ISolvencyRegistry.sol:15`.

Contract/README claim "raw reserves never appear on-chain," but `recordSolvency` receives the full FDC proof as calldata, and `fdcProof.data.responseBody.abiEncodedData` decodes to the plaintext reserves. Transaction calldata is permanent and public → **reserves are effectively public**. `reservesCommitment = keccak256(abi.encode(reserves))` is unsalted, so even without the proof it is brute-forceable for realistic ranges. Also a doc bug: `ISolvencyRegistry.sol:15` states `reservesCommitment = keccak256(abi.encode(totalReserves, salt))` (salted) but the code uses no salt. Fix: correct the privacy claim and the interface comment; if reserves must stay private, the FDC-in-calldata design cannot deliver that. Liabilities do remain private (salted `inputHash`), so the exposure is bounded.

### M2 — `claim.timestamp` is attacker-controlled but treated as the attestation time
`recordSolvency:151-166` stores `claim.timestamp` (signed by TEE but caller-chosen) into the registry; third parties read it as "solvent at T." It is never checked against `block.timestamp`. The stake lock uses `block.timestamp` (correct), but the *recorded* time is forgeable → an attestor can back/post-date a solvency claim. Fix: store `recordedAt = uint64(block.timestamp)` and require `claim.timestamp` to be within a small delta of it. (Also needed for a sound H2 deadline.)

### M3 — FDC proof freshness / reuse not enforced
`recordSolvency` never inspects `fdcProof.data.votingRound` or `lowestUsedTimestamp`. A stale proof (reserves from weeks ago) or a proof reused across claims is accepted as long as the reserves value matches the commitment. For a solvency system, proving solvency with stale reserves is a real soundness gap. Fix: `require(fdcProof.data.lowestUsedTimestamp >= block.timestamp - maxProofAge)`.

### M4 — Owner is fully trusted; multiple rug/bypass vectors
`SolvencyVerifier.setTeeAddress:75`, `setFdcVerifierOverride:88`; `AttestorStaking.setSlasher:47` / `slash:100`.
- Owner can set `teeAddress` to a key it controls and forge arbitrary claims.
- `fdcVerifierOverride` is a "test-only" bypass that lives on the production contract with no network guard; owner can point it at a mock that returns `true`, bypassing FDC entirely on mainnet.
- Owner can `setSlasher(self)` then `slash(anyAttestor, amount, self)` to drain every attestor's active stake to itself.

For a decentralized proof-of-solvency these are single points of failure. Fix: timelock/renounce ownership post-setup; remove or compile-gate `fdcVerifierOverride` for production; constrain slash beneficiary to the fraud challenger (already the case in `raiseFraud`, but `slash` itself is owner-reachable via a swapped slasher).

---

## LOW

### L1 — Attestor identity not bound in the TEE signature (front-running/griefing)
`recordSolvency:135-144` uses `msg.sender` as the attestor, but the signed digest (`claimDigest:95-110`) omits it. A mempool observer can copy `(claim, teeSignature, fdcProof)` and submit first with their own address, consuming `usedNonce[claim.nonce]` and becoming the recorded attestor; the intended attestor's tx then reverts "nonce used." No direct theft (front-runner risks their own stake) but it is a griefing / attestor-spoofing vector. Fix: include the intended attestor address in the signed digest.

### L2 — Nonce derived from `Date.now()` ms → collisions & predictability
`orchestrator.ts:90,160`, `prove-record-fdc.ts:68`. Two attestations within the same millisecond collide on the global `usedNonce` and the second reverts. Fix: random or monotonic counter nonce.

### L3 — Weak salt randomness
`orchestrator.ts:89` uses `Math.random()` (non-CSPRNG) inside the salt preimage. Defense-in-depth for liabilities privacy and for salt secrecy (H4). Fix: `crypto.randomBytes(32)`.

### L4 — `VouchsafeInstructionSender.requestSolvencyProof` traps ETH in simulated mode
`VouchsafeInstructionSender.sol:55-77`. Function is `payable`; when `teeRegistry == address(0)` the `msg.value` is ignored and locked (no withdraw). Fix: `require(msg.value == 0)` in the simulated branch, or add an owner sweep.

### L5 — Public `/api/fraud` spends the server's own stake/gas
`attestor-service/src/server.ts:37-44`. Anyone can POST to trigger `commitFraud`, which self-slashes the service wallet and burns gas. Demo-only, but should be auth-gated or disabled outside demos.

---

## Positive observations (verified, do not regress)
- **Signature scheme is sound.** `claimDigest` binds `DOMAIN`, `block.chainid`, and `address(this)` → no cross-chain/cross-contract replay. `ECDSA.recover` (OZ v5) rejects high-`s` malleable sigs and reverts on invalid input (no zero-address footgun). `teeAddress != 0` checked before use.
- **TS ⇄ Solidity digest byte-match verified.** `tee-signer.ts:42-49` type list `["string","uint256","address","address","bytes32","bytes32","bool","uint64","uint256"]` matches `claimDigest` argument order/types one-for-one; `DOMAIN` constant identical (`config.ts:16`); EIP-191 `wallet.signMessage(getBytes(digest))` matches `MessageHashUtils.toEthSignedMessageHash`.
- **Replay within a chain/contract** blocked by global `usedNonce` + registry duplicate id guard.
- **Reentrancy** handled: `withdraw`/`slash` are `nonReentrant` with CEI; `raiseFraud` sets `markRevoked` before `slash`, and re-entry hits `require(!att.revoked)`; OZ's shared guard blocks `withdraw` re-entry during `slash`.
- **Access control** on registry writes (`onlyVerifier`) and slash/lock (`onlySlasher`) is correct and tested.
- **Input validation** in `computeSolvency`/`action-handler` is strict (non-negative integer strings, 32-byte salt, address/chainId checks). Server logs only non-sensitive metadata.

---

## Recommended actions (priority order)
1. H1: bind the FDC proof to an approved per-subject reserves source (URL hash / source id) and to `subject`.
2. H2: make slashing cover `pendingWithdrawal`, keep a dispute lock, and decouple `markRevoked` from slash success; add a trustworthy `recordedAt`.
3. H3: remove the FDC proof from `raiseFraud`; verify the reveal solely against the stored `inputHash`.
4. M2/M3: store `recordedAt = block.timestamp`, validate `claim.timestamp`, and enforce FDC proof freshness.
5. M4: timelock/renounce owner, compile-gate `fdcVerifierOverride` out of production.
6. M1: fix the privacy claim + `ISolvencyRegistry` comment; salt `reservesCommitment` if privacy is intended.
7. L1–L5: bind attestor in digest, robust nonce/salt RNG, guard `payable`/`/api/fraud`.

## Unresolved questions
- Intended trust model for `RESERVES_URL`: is it meant to be a per-subject, subject-controlled, or owner-registered source? H1's severity hinges on this.
- Is salt expected to be disclosed to challengers/auditors off-chain (making H4 by-design), or should the protocol enforce openability?
- Is `fdcVerifierOverride` intended to be removed before any mainnet/production deploy, or kept as an admin escape hatch?
