# GCP Confidential Space Deployment Guide (MODE=0)

Turns the simulated enclave into a **real TEE**: the Vouchsafe extension runs inside GCP
Confidential Space (AMD SEV confidential VM), the signing key is generated **inside the enclave**,
and Google's attestation token proves *which image* is running on *real TEE hardware*.

## What changes vs. simulated mode

| | Simulated (`MODE=1`) | Confidential Space (`MODE=0`) |
|---|---|---|
| Enclave | local Node process | container in a Confidential VM (AMD SEV) |
| Signing key | `TEE_SIGNER_PRIVATE_KEY` env | generated in-enclave at boot, never exported |
| Remote attestation | none | Google-signed OIDC token via `GET /attestation` |
| Code identity | trust the operator | image **digest** bound into the attestation token |

Signing + on-chain verification are **identical** in both modes — `setTeeAddress` is the only switch.

## Prerequisites (the only manual steps)

1. A GCP project with **billing enabled**:
   ```bash
   gcloud auth login
   gcloud config set project <PROJECT_ID>
   gcloud beta billing projects link <PROJECT_ID> --billing-account=<BILLING_ACCOUNT_ID>
   ```
   (`gcloud beta billing accounts list` shows your billing account ids.)
2. `gcloud` CLI ≥ 450 (no local Docker needed — the image builds on Cloud Build).

Cost note: `n2d-standard-2` ≈ $0.07–0.10/h. Delete the VM after the demo (teardown below).

## Deploy (one command)

```bash
bash tee-extension/confidential-space/setup-confidential-space.sh
```

The script (idempotent) enables the APIs, builds `tee-extension/Dockerfile` on Cloud Build, creates
the `vouchsafe-cs` service account with `confidentialcomputing.workloadUser`, and boots a
`confidential-space` VM whose `tee-image-reference` pins the image **digest**. Env vars reach the
container only through `tee-env-*` metadata (`MODE=0`, `SIMULATED_TEE=false`) — no key is provided,
so the enclave generates its own.

## Verify + wire on-chain

```bash
curl http://<VM_IP>:7800/pubkey        # → { teeAddress } — the enclave's identity
curl http://<VM_IP>:7800/attestation   # → Google-signed OIDC token (image digest + TEE claims)
```

Decode the attestation token (any JWT tool) and check:
- `submods.container.image_digest` equals the digest the script printed;
- `hwmodel` is a Confidential Computing platform (e.g. `GCP_AMD_SEV`);
- issuer is `https://confidentialcomputing.googleapis.com`.

Then flip the trust root on Coston2 (owner key):

```bash
# SolvencyVerifier.setTeeAddress(<teeAddress from /pubkey>)
# All subsequent recordSolvency calls now require signatures born inside the real enclave.
```

Point the attestor-service at the enclave and run the normal demo — one line in `.env`:

```bash
TEE_EXTENSION_URL=http://<VM_IP>:7800   # orchestrator now signs inside the real enclave
yarn demo                                # records solvency with an enclave-born signature
```

The service reads the enclave's address from `/pubkey` and registers it via `setTeeAddress`
automatically. The fraud act intentionally refuses to run in this mode — a real enclave will not
sign a false claim (unset `TEE_EXTENSION_URL` and `setTeeAddress` back to the simulated key to
demo it again).

**One session is enough for permanent evidence.** The `recordSolvency` transaction (signed by the
enclave-born key) lives on-chain forever, and the saved attestation token + image digest prove the
enclave context. Suggested order: deploy → `curl /attestation` (save the token) → `yarn demo` →
record the video segment → save explorer links into SUBMISSION.md → teardown. Total cost well
under $1.

## Teardown

```bash
gcloud compute instances delete vouchsafe-tee --zone us-central1-a
gcloud compute firewall-rules delete allow-vouchsafe-tee
```

## Honest status & remaining gaps

- The firewall rule opens 7800 publicly for the demo — restrict `--source-ranges` in production.
- Reproducible builds (bit-identical digest from source) are future work; the digest in the
  attestation token still pins the exact running image.
- Flare's `TeeExtensionRegistry` is not yet published on Coston2, so the FCC registry round-trip
  (code-hash whitelisting on-chain) remains blocked on Flare — the attestation token covers the same
  guarantee off-chain in the meantime.
