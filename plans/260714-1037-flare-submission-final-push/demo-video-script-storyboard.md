# Vouchsafe — Demo Video Script (target 4:30)

Record at 1080p, dark theme, browser + terminal side-by-side. Prep BEFORE recording:
- `yarn service` running at http://localhost:7900 (full mode, funded key).
- One fresh attestation already recorded (so history isn't empty) + its id copied.
- Explorer tabs pre-opened: record tx, quorum tx, slash tx, proveControl tx (links in SUBMISSION.md §5).
- MetaMask on Coston2 with a small stake already posted.
- Terminal font ≥ 16pt. Do a silent dry run once.

| # | Time | Screen | Say (VN or EN — keep sentences short) |
|---|------|--------|------|
| 1 | 0:00–0:20 | Landing hero | "This is Vouchsafe: an RWA issuer or FXRP agent proves reserves ≥ liabilities — without revealing a single number. Private, because the check runs in a confidential enclave. Accountable, because the attestor stakes collateral they lose if they lied." |
| 2 | 0:20–0:45 | Scroll pipeline section | "Every record needs two independent proofs: a TEE signature over a commitment, and a Flare FDC proof of the reserves. The verifier contract refuses either one alone." |
| 3 | 0:45–1:35 | Act I: fill figures, click Prove | "Reserves and liabilities go into the enclave only. Watch the live trace: enclave signs → FDC Web2Json round-trip on Coston2 → recordSolvency. This runs a real FDC voting round, about 90 seconds." (While waiting, show the commitment builder: change a digit → hashes change.) |
| 4 | 1:35–2:00 | Result + explorer tab | "On-chain: subject, attestor, timestamp, two hashes. No amounts. Anyone can verify 'solvent at T' — here on Blockscout." |
| 5 | 2:00–2:30 | Act II: paste id, Verify | "A counterparty pastes the attestation id and reads the registry directly. Reserves, liabilities, salt: structurally absent." |
| 6 | 2:30–3:00 | Act IV: MetaMask endorse | "Solvency is only final when independent capital agrees. My second wallet stakes and endorses — its bond now backs the same claim. isQuorate flips when the issuer's policy is met." |
| 7 | 3:00–3:30 | Act III: Run fraud → slash | "Now the attestor lies. The enclave key signs 'solvent' over insolvent figures, it records — and anyone who reveals the committed figures slashes the recorder AND every endorser. Stake: 1.0 → 0.0." (Pre-recorded clip is fine if timing is tight.) |
| 8 | 3:30–4:00 | Act V: XRPL check + testnet.xrpl.org tab | "New: an XRPL-native rail. The subject proves control of its XRP reserve address by answering an on-chain challenge with a real XRPL payment — FDC's Payment attestation carries it on-chain. No custodian API in the loop." |
| 9 | 4:00–4:30 | README honest-scope table + confidential-space guide | "Everything you saw is live on Coston2 — contracts source-verified. The enclave is simulated today; the repo ships a one-command GCP Confidential Space deploy that flips the same trust root to real TEE hardware. That's Vouchsafe: prove you're solvent, reveal nothing." |

Fallbacks: if FDC is slow on camera, cut to the pre-recorded Act I result; never wait silently >10 s.
Upload unlisted to YouTube; paste the link into SUBMISSION.md §5 and the DoraHacks form.
