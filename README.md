# Vouchsafe

**Private, stake-backed proof-of-solvency for RWA issuers and FAsset agents on Flare.**
Prove you can cover your liabilities without revealing your books — and lose your stake if you lied.

Built for the **Flare Summer Signal** hackathon, targeting both the **Interoperable Asset Products** and
**Confidential Compute Apps** bounties. All development and demos run on **Flare Testnet Coston2 (chain id 114)**.

## What it does

An issuer feeds sensitive figures (bank balances, XRP holdings, off-chain positions) into a **confidential compute
(TEE) extension**. Inside the enclave it checks `reserves ≥ liabilities` and publishes a single signed attestation —
a commitment to the inputs plus the boolean result, **never the raw numbers**. An **FDC Web2Json** proof brings the
off-chain reserves on-chain, and the attestation is bound to a **real FXRP agent**. An **FDC Payment** proof adds an
**XRPL-native rail**: the subject proves control of its registered XRP reserve address by answering an on-chain
challenge with a real XRPL payment — no custodian API in the loop. The attestor **stakes** collateral;
if the claim is later proven false, the stake is **slashed**. Independent attestors can **endorse** a recorded
attestation with their own stake — a per-issuer **quorum policy** decides when the claim counts as final, and a
proven fraud slashes the recorder and every endorser. Private (TEE) + accountable (economic).

See [`docs/architecture.md`](docs/architecture.md) for the full data-flow diagram.

## Repo layout (yarn workspaces)

```
contracts/         Hardhat, Solidity 0.8.25 / EVM cancun — registry, staking, verifier, agent binding, XRPL proof
tee-extension/     TypeScript confidential solvency compute + signer + /action server + Confidential Space image
attestor-service/  Orchestrator (TEE sign → FDC proof → on-chain record) + API + frontend + XRPL demo
docs/              architecture, deployment guides (incl. GCP Confidential Space), roadmap
```

## Setup

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate   # yarn classic
yarn install
cp .env.example .env                                          # then fill PRIVATE_KEY etc.
```

Fund the deployer with C2FLR (and test FXRP) from the [Coston2 faucet](https://faucet.flare.network/coston2).
`.env` is git-ignored — never commit real keys. FDC verifier/DA-layer endpoints are pre-filled in `.env.example`;
`RESERVES_URL` must be a **publicly reachable** endpoint returning `application/json` `{ "reserves": <int> }` (FDC
fetches it server-side).

## Build, test, deploy

```bash
yarn compile                 # hardhat compile (0.8.25 / cancun)
yarn test                    # 56 contract unit tests
yarn deploy:coston2          # deploy the core contracts, write contracts/deployments/coston2.json
yarn workspace @vouchsafe/contracts deploy:xrpl-reserve-proof   # add the XRPL control-proof contract
```

## Run the demo

```bash
yarn demo                    # unattended: happy + quorum-endorse + fraud paths, live on Coston2 (~5 min, 2 FDC rounds)
yarn demo:xrpl               # XRPL rail: testnet challenge payment → FDC Payment proof → on-chain record (~4 min)
yarn service                 # http://localhost:7900 — 5-act UI (prove / verify / fraud / quorum / XRPL + history)
```

The web UI supports **MetaMask**: connect, auto-add Coston2, stake, and endorse attestations with your own key.
`GET /api/attestations` serves an event-indexed history of every attestation with live quorum status;
`GET /api/xrpl-proof/:subject` reports the XRPL reserve-address control status.

**Public read-only hosting** for judges: `READ_ONLY=1 yarn service` (no server key needed), or `fly deploy`
with the bundled root `Dockerfile` + `fly.toml` — write paths return 403, MetaMask actions still work.

The demo prints explorer links for the recorded attestation and the slash transaction. A third party can verify
"solvent at T" with the input hash and **no underlying numbers**.

## Two corrections vs. common assumptions (per live Flare docs)

- **Solidity `0.8.25` / EVM `cancun`** — matching the Flare starter. `cancun` requires solc ≥ 0.8.24, so 0.8.19
  cannot compile it.
- **FCC `MODE` semantics:** `MODE=0` = production attestation (FTDC-accepted); `MODE=1` = simulated. This project
  runs the simulated path and keeps a clean switch to real Confidential Space.

## Simulated vs. real (honesty note)

Real on Coston2: the confidential computation, the TEE signature + on-chain `ecrecover`, both FDC round-trips
(Web2Json + XRPL Payment), the FXRP agent binding, staking/slashing, and XRPL reserve-address control proofs.
Simulated: the enclave itself (a local process) and the `TeeExtensionRegistry` round-trip (not yet published on
Coston2). A **one-command GCP Confidential Space deployment** ships in the repo
(`bash tee-extension/confidential-space/setup-confidential-space.sh`, guide in
[`docs/confidential-space-deployment-guide.md`](docs/confidential-space-deployment-guide.md)) — with a
billing-enabled GCP project it runs the extension in a real enclave with a Google-signed attestation token.
The cryptography and on-chain verification are identical in both modes. See
[`tee-extension/README.md`](tee-extension/README.md) and [`SUBMISSION.md`](SUBMISSION.md) for the full
new-vs-integrated breakdown.

## Never hardcode addresses

Every Flare contract is resolved through `FlareContractRegistry`
(`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`, same on all networks) via the periphery `ContractRegistry` library.
