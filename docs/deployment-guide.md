# Vouchsafe — Deployment Guide (Coston2)

## Prerequisites
- Node 20+ (built on 24), Docker not required for the simulated path.
- `corepack enable && corepack prepare yarn@1.22.22 --activate`
- A Coston2 deployer key funded with C2FLR + test FXRP from the [faucet](https://faucet.flare.network/coston2).

## 1. Configure
```bash
yarn install
cp .env.example .env
```
Fill in `.env` (git-ignored):
- `PRIVATE_KEY` — funded Coston2 deployer (also the demo attestor).
- `TEE_SIGNER_PRIVATE_KEY` — simulated enclave signing key (any fresh key).
- FDC endpoints are pre-filled; `VERIFIER_API_KEY_TESTNET` defaults to the rate-limited placeholder UUID.
- `RESERVES_URL` — a **publicly reachable** endpoint returning `application/json` `{ "reserves": <int> }`.
  (The demo uses a GitHub gist proxied via `githack.com` for the correct content-type.)

## 2. Compile, test, deploy
```bash
yarn compile
yarn test                     # 24 unit tests
yarn deploy:coston2           # writes contracts/deployments/coston2.json + .env addresses
```
The deploy script deploys all five contracts and wires roles (`registry.verifier` + `staking.slasher` →
`SolvencyVerifier`), then prints explorer links.

## 3. Verify source on the explorer (optional)
```bash
yarn workspace @vouchsafe/contracts hardhat run scripts/verify.ts --network coston2
```
Blockscout ignores the API token value; the config supplies a placeholder so the plugin is satisfied.

## 4. Run
```bash
yarn demo                     # unattended happy + fraud paths, ~5 min (two FDC rounds)
yarn service                  # http://localhost:7900 — 3-view UI
```

## FDC reserves endpoint (content-type gotcha)
Flare's Web2Json verifier requires the fetched URL to return `Content-Type: application/json`, and its jq engine
does **not** support `fromjson`. A raw GitHub gist serves `text/plain`, so the demo proxies it through
`gist.githack.com`, which sets `application/json`; the field `.reserves` is then read directly.

## Upgrading to real Confidential Space (MODE=0)
1. Build the extension image with `MODE=0` and a reproducible `SOURCE_DATE_EPOCH`.
2. Run it in a GCP Confidential Space VM; register the TEE machine and whitelist the code hash (needs Flare
   indexer-DB credentials + the FCE Docker stack).
3. `SolvencyVerifier.setTeeAddress(<enclave address>)`, and point `VouchsafeInstructionSender` at the real
   `TeeExtensionRegistry`.

## Redeploy note
Re-running `deploy:coston2` deploys fresh contracts (new addresses). Update `.env` + anything referencing the old
addresses; prior attestations live on the previous verifier.
