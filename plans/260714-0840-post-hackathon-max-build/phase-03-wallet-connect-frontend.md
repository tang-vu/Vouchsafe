# Phase 3 — Wallet-connect + quorum/history UI (frontend)

## Overview
Roadmap item: "Frontend polish + wallet-connect." Adds MetaMask connect (auto add/switch Coston2),
an "Act IV — quorum" section (stake + endorse from the browser wallet), and an attestation history table.

## Design
- New `attestor-service/public/wallet.js` (~180 loc): EIP-1193 detect, connect, `wallet_addEthereumChain`
  (chainId 0x72 = 114), minimal ABI encoding for `stake()`, `endorse(bytes32)` via `eth_sendTransaction`,
  read stake via `eth_call`. No bundler — hand-rolled selectors, keccak from existing `keccak256.js`.
- New `attestor-service/public/history.js` (~120 loc): fetch `/api/attestations`, render table with
  status (active/revoked/quorate), explorer links, endorse buttons wired to wallet.js.
- `index.html`: nav connect button, Act IV section, history section. `app.js` untouched except boot hooks.

## Todo
- [x] wallet.js connect + chain switch + stake/endorse
- [x] history.js + table UI
- [x] index.html sections + styles

## Success criteria
Frontend loads with no console errors; without MetaMask the sections degrade gracefully;
history renders from live Coston2 events.
