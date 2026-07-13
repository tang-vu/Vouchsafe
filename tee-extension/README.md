# Vouchsafe TEE Extension (Confidential Solvency Compute)

Computes `reserves >= liabilities` **inside the enclave boundary** and emits a signed attestation
(`inputHash` + `reservesCommitment` + `solvent` + `timestamp` + `nonce`) — **never the raw figures**.
The on-chain `SolvencyVerifier` recovers the signer and requires it to equal the registered TEE address,
exactly as Flare's `fce-weather-insurance` `settle()` verifies its TEE signature.

## Run

```bash
# from repo root
yarn workspace @vouchsafe/tee-extension self-test        # crypto + privacy checks, no chain
yarn workspace @vouchsafe/tee-extension start            # run the HTTP extension (POST /action)
yarn workspace @vouchsafe/tee-extension prove-and-record # full loop: private inputs -> attestation -> Coston2
```

`POST /action` accepts an FCC-style envelope `{ opType: "SOLVENCY", opCommand: "PROVE", message: {...} }`
or a bare request. `message` = `{ subject, reserves[], liabilities[], salt, nonce, chainId, verifier }`.

## Signature scheme (identical in simulated and real modes)

```
digest = keccak256(abi.encode(
  "VOUCHSAFE_SOLVENCY_V1", chainId, verifier,
  subject, inputHash, reservesCommitment, solvent, timestamp, nonce))
signature = personalSign(digest)           // EIP-191
on-chain:  ecrecover(eip191(digest)) == teeAddress
```

`inputHash = keccak256(abi.encode(totalReserves, totalLiabilities, salt))` — commits to the full private
computation. `reservesCommitment = keccak256(abi.encode(totalReserves))` — binds the reserves total to the
FDC-attested reserves (used in Phase 3).

## Simulated vs. real Confidential Space

| Concern | Simulated (this workspace) | Real Confidential Space (`MODE=0`) |
|---|---|---|
| Enclave | local Node process | GCP Confidential Space VM (AMD SEV) |
| TEE key | local ECDSA key (`TEE_SIGNER_PRIVATE_KEY`) | generated + held **inside** the enclave; never exported |
| Attestation | `SIMULATED_TEE=true`, `MODE=1`; code hash `0x194844cf…` | measured code hash, FTDC-whitelisted on-chain |
| Signature construction | `VOUCHSAFE_SOLVENCY_V1` digest, EIP-191 | same digest; signed via the enclave sign port |
| On-chain verification | `ecrecover == teeAddress` | **identical** |
| Instruction routing | `VouchsafeInstructionSender` emits an event the attestor-service watches | `TeeExtensionRegistry.sendInstructions` routes to TEE machines |

> **MODE semantics (per Flare docs):** `MODE=0` = production attestation (FTDC-accepted); `MODE=1` = simulated
> (rejected on testnet/mainnet). This is the reverse of a common misconception. The signing and on-chain
> verification are the same in both modes — only key custody and the attestation differ.

## What is simulated vs. real here

- **Real:** the confidential computation, the commitment scheme, the EIP-191 TEE signature, and the on-chain
  `ecrecover == teeAddress` verification (exercised live on Coston2).
- **Simulated:** the enclave itself (local process instead of a Confidential Space VM), the remote attestation /
  code-hash whitelisting, and the `TeeExtensionRegistry` round-trip (event-anchored instead, since the FCC
  registry is not yet published in the Coston2 `FlareContractRegistry`).

To go production: build the image with `MODE=0` + a reproducible `SOURCE_DATE_EPOCH`, run it in Confidential
Space, register the TEE + whitelist the code hash, set the enclave address via `SolvencyVerifier.setTeeAddress`,
and point `VouchsafeInstructionSender` at the real `TeeExtensionRegistry`.
