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
yarn test                     # 56 unit tests
yarn deploy:coston2           # writes contracts/deployments/coston2.json + .env addresses
yarn workspace @vouchsafe/contracts deploy:xrpl-reserve-proof   # appends XrplReserveProof to the same file
```
The deploy script deploys the five core contracts and wires roles (`registry.verifier` + `staking.slasher` →
`SolvencyVerifier`), then prints explorer links. The XRPL control-proof contract deploys separately and never
requires redeploying the core.

## 3. Verify source on the explorer (optional)
```bash
yarn workspace @vouchsafe/contracts hardhat run scripts/verify.ts --network coston2
```
Blockscout ignores the API token value; the config supplies a placeholder so the plugin is satisfied.

## 4. Run
```bash
yarn demo                     # unattended happy + quorum + fraud paths, ~5 min (two FDC rounds)
yarn demo:xrpl                # XRPL testnet challenge payment → FDC Payment proof → proveControl (~4 min)
yarn service                  # http://localhost:7900 — 5-act UI
```

## 5. Public read-only hosting (judge-testable demo)
`READ_ONLY=1` disables every endpoint that spends the server's key/stake (403); history, verification, XRPL
status, and MetaMask writes keep working, and no `PRIVATE_KEY` is required in the container.
```bash
READ_ONLY=1 yarn service      # local read-only run
fly auth login && fly launch --copy-config --no-deploy && fly deploy   # Fly.io via root Dockerfile + fly.toml
```
Any Docker host works: `docker build -t vouchsafe-demo . && docker run -p 7900:7900 vouchsafe-demo`.

## FDC reserves endpoint (content-type gotcha)
Flare's Web2Json verifier requires the fetched URL to return `Content-Type: application/json`, and its jq engine
does **not** support `fromjson`. A raw GitHub gist serves `text/plain`, so the demo proxies it through
`gist.githack.com`, which sets `application/json`; the field `.reserves` is then read directly.

## Upgrading to real Confidential Space (MODE=0)
One command once GCP billing is enabled:
```bash
bash tee-extension/confidential-space/setup-confidential-space.sh
```
Full walkthrough (image build on Cloud Build, attestation-token verification, `setTeeAddress`, teardown, costs):
[`confidential-space-deployment-guide.md`](confidential-space-deployment-guide.md). The on-chain
`TeeExtensionRegistry` round-trip stays pending until Flare publishes that registry on Coston2.

## Redeploy note
Re-running `deploy:coston2` deploys fresh contracts (new addresses). Update `.env` + anything referencing the old
addresses; prior attestations live on the previous verifier.
