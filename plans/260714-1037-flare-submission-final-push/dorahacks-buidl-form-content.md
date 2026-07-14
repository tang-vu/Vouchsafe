# DoraHacks BUIDL Form — Paste-Ready Content

Copy each block into the matching field. English throughout (international judges).

## Profile tab

**BUIDL (project) name**
```
Vouchsafe
```

**BUIDL logo** — upload `vouchsafe-logo-480.png` (repo root, 480×480 PNG, generated from the app's shield mark).

**Vision** (219 chars — limit 256)
```
Private, stake-backed proof of solvency on Flare. RWA issuers and FXRP agents prove reserves >= liabilities inside a real TEE - revealing nothing. FDC anchors reserves on-chain; staked attestors get slashed if they lied.
```

**Category** — pick the closest to: `DeFi` (fallback: `Infrastructure`). Tags if free-form: `Flare, DeFi, RWA, Confidential Compute, XRP`.

**Is this BUIDL an AI Agent?** — `No`

## Links

**GitHub**
```
https://github.com/tang-vu/Vouchsafe
```

**Project website** — leave blank for now, or paste the Fly URL after `fly deploy` (read-only public demo ships in the repo).

**Demo video**
```
https://youtu.be/1t-Nm9hdITs
```

**Social links**
```
https://x.com/tangvu_dev
https://github.com/tang-vu
```

## Details tab (Markdown editor — paste everything between the fences)

~~~markdown
**Private, stake-backed proof of solvency for RWA issuers and FAsset agents on Flare.**

https://youtu.be/1t-Nm9hdITs

## The problem

Issuers and FXRP agents must convince counterparties they can cover their liabilities — but publishing the books leaks positions, customers, and strategy. Today's choice is bad: **full disclosure or blind trust**.

## How Vouchsafe works — three pillars

1. **Confidential** — the solvency check (`reserves ≥ liabilities`) runs inside a TEE; only a signed commitment reaches the chain, never the raw numbers. Deployed on **real GCP Confidential Space (AMD SEV, production image)**: the signing key was generated in-enclave, and a live Coston2 attestation carries its signature — with a **Google-signed attestation token** pinning the exact image digest.
2. **Interoperable** — two Flare **FDC** attestation types gate every record: `Web2Json` attests the off-chain reserve total, and `Payment (XRPL)` proves control of the XRP reserve address via an on-chain challenge answered by a **real XRPL payment** — no custodian API in the loop. Subjects bind to real **FXRP agent vaults**; every Flare contract resolves via `FlareContractRegistry`.
3. **Accountable** — attestors stake C2FLR. Anyone who reveals committed figures showing `reserves < liabilities` **slashes the recorder and every endorser** in one transaction. A per-issuer quorum policy decides when a claim counts as final (`isQuorate`).

`recordSolvency` requires **both** the enclave signature **and** the FDC proof — neither bounty is decorative.

## Live on Coston2 (all source-verified)

| Evidence | Link |
|---|---|
| Solvency recorded with a **real-TEE** signature (enclave key `0x8dCdC401…`) | [tx 0x8f0595ba…](https://coston2-explorer.flare.network/tx/0x8f0595ba1a94b29988df6e9bb139a5cbe8c94f4c580dbc23fefe3ed641202d47) |
| **XRPL control proof** — testnet payment → FDC Payment → `proveControl` | [tx 0x354c0811…](https://coston2-explorer.flare.network/tx/0x354c0811f8084604e6c4289217e985fce1500fdbe22e30396911619356d464e9) |
| Fraud proven → stake slashed **1.0 → 0.0 C2FLR** | [tx 0xcfa391b0…](https://coston2-explorer.flare.network/tx/0xcfa391b0077b180ebc29b5406f55d044ba7e639c8f009b79e0a1991b803f2347) |
| Quorum endorsement (independent stake, `quorate` flips true) | [tx 0x8ccb9e95…](https://coston2-explorer.flare.network/tx/0x8ccb9e95405a61ab206ee4e78d6a53bda8d16841fd308ec94247194ddd101ba4) |

56 unit tests · 6 verified contracts · unattended `yarn demo` · 5-act web UI with MetaMask staking/endorsing · one-command Confidential Space deploy.

## Try it

```bash
git clone https://github.com/tang-vu/Vouchsafe && cd Vouchsafe
yarn install && cp .env.example .env   # fill PRIVATE_KEY (Coston2 faucet)
yarn demo        # happy + quorum + fraud, live on Coston2 (~5 min)
yarn demo:xrpl   # XRPL challenge payment → FDC Payment proof (~4 min)
yarn service     # http://localhost:7900 — the 5-act UI from the video
```

Built for **Flare Summer Signal** — Interoperable Asset Products + Confidential Compute Apps. Honest new-vs-integrated breakdown, security review notes, and roadmap in [`SUBMISSION.md`](https://github.com/tang-vu/Vouchsafe/blob/main/SUBMISSION.md).
~~~

<details><summary>Old plain-text version (superseded)</summary>

```
Vouchsafe is private, stake-backed proof-of-solvency for RWA issuers and FAsset agents on Flare.

THE PROBLEM
Issuers and FXRP agents must convince counterparties they can cover their liabilities - but publishing the books leaks positions, customers, and strategy. Today's choice is bad: full disclosure or blind trust.

HOW IT WORKS
1) Confidential: the solvency check (reserves >= liabilities) runs inside a TEE. Only a signed commitment reaches the chain - never the raw numbers. Deployed and proven on real GCP Confidential Space (AMD SEV, production image): the signing key was generated in-enclave and a live attestation on Coston2 carries its signature, with a Google-signed attestation token pinning the exact image digest.
2) Interoperable: two Flare FDC attestation types gate every record. Web2Json attests the off-chain reserve total; Payment (XRPL) proves control of the XRP reserve address via an on-chain challenge answered by a real XRPL payment - no custodian API in the loop. Subjects bind to real FXRP agent vaults; every Flare contract resolves via FlareContractRegistry.
3) Accountable: attestors stake C2FLR. Anyone who reveals committed figures showing reserves < liabilities slashes the recorder AND every endorser in one transaction. Per-issuer quorum policy decides when a claim is final (isQuorate).

LIVE ON COSTON2 (all source-verified)
- recordSolvency requires BOTH the enclave signature and the FDC proof - neither bounty is decorative.
- Real-TEE record: tx 0x8f0595ba... signed by enclave key 0x8dCdC401...
- XRPL control proof: XRPL testnet payment FDA9BA6A... -> proveControl tx 0x354c0811...
- Fraud -> slash: stake 1.0 -> 0.0 C2FLR, on-chain.
- 56 unit tests; 6 verified contracts; unattended `yarn demo` + 5-act web UI with MetaMask staking/endorsing.

Judges can run it: `yarn demo` (repo README), or READ_ONLY=1 hosting with no server key.
```

</details>

## Team tab
```
Solo builder - full-stack + smart contracts. Everything (contracts, TEE extension, FDC integrations, UI, video) built during Flare Summer Signal on top of the flare-hardhat-starter patterns (honest breakdown in SUBMISSION.md).
```

## Submission tab (bounty answers)
- Selected bounties: **Interoperable Asset Products** + **Confidential Compute Apps** (one flow exercises both — see `SUBMISSION.md` §2/§7 for the full text to paste).
- What was newly built during the program: paste the table from `SUBMISSION.md` §8.
- Contract addresses: paste `SUBMISSION.md` §9 (six verified Coston2 addresses).
- Roadmap/next steps: paste `SUBMISSION.md` §11.

## YouTube upload (vouchsafe-demo.mp4)

**Title** (88/100 chars)
```
Vouchsafe — Private Proof of Solvency on Flare | TEE + FDC + XRPL | Flare Summer Signal
```

**Description**
```
Vouchsafe lets an RWA issuer or FXRP agent prove reserves >= liabilities without revealing a single number — private (real TEE) and accountable (staked collateral, slashed on a proven lie). Everything in this video runs live on Flare Coston2; Act I is signed inside a real GCP Confidential Space enclave (AMD SEV).

Chapters:
0:00 The problem — prove solvency, reveal nothing
0:25 Two independent proofs (TEE signature + FDC)
0:39 Act I — the enclave signs, FDC attests, on-chain record (real voting round)
1:11 What the chain sees: commitments only
1:24 Act II — verify without the numbers
1:38 Act IV — quorum: independent stakes back the claim
1:55 Act III — lie, and lose the stake (1.0 -> 0.0 C2FLR)
2:21 Act V — XRPL-native reserve proof (FDC Payment)
2:43 Evidence: verified contracts, Google-signed attestation token

GitHub: https://github.com/tang-vu/Vouchsafe
Real-TEE record tx: https://coston2-explorer.flare.network/tx/0x8f0595ba1a94b29988df6e9bb139a5cbe8c94f4c580dbc23fefe3ed641202d47
XRPL control proof: https://coston2-explorer.flare.network/tx/0x354c0811f8084604e6c4289217e985fce1500fdbe22e30396911619356d464e9

Built for the Flare Summer Signal hackathon — Interoperable Asset Products + Confidential Compute Apps bounties.
#Flare #DeFi #RWA #XRP #ConfidentialComputing
```

**Thumbnail** — upload `vouchsafe-thumbnail-1280x720.png` (repo root).

**Form choices**: Đối tượng người xem → "Không, nội dung này không dành cho trẻ em" · Giới hạn độ tuổi → không giới hạn ·
Nội dung trả phí quảng cáo → không · Danh sách phát → bỏ qua · Chế độ hiển thị → Không công khai (unlisted) là đủ cho chấm giải.
Phụ đề: sau khi upload, vào Subtitles → tải lên `vouchsafe-demo.srt` (English).

## Unresolved
- YouTube link (user uploads video) and optional Fly URL — fill before final submit.
