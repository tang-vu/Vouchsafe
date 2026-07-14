# Phase 03 — Confidential Space MODE=0 Scaffolding

## Context links
[plan.md](plan.md) · `tee-extension/README.md` · Flare FCC docs (dev.flare.network) · GCP Confidential Space docs

## Overview
Priority: HIGH (Bounty 2 credibility). Status: done (scaffolding; GCP run needs user's account).
Everything needed to run the tee-extension inside real GCP Confidential Space, so the only manual
steps left are billing/account clicks.

## Requirements
- Reproducible container build for `tee-extension` (pinned base, lockfile-frozen, no dev deps).
- MODE=0 behavior: enclave-generated signer key (never leaves the container), attestation-token
  endpoint exposing the Confidential Space launcher token, identity endpoint for `setTeeAddress`.
- gcloud setup script + operator guide (image push, workload identity pool, confidential VM create).

## Architecture
```
GCP Confidential Space VM (TDX) → container launcher → tee-extension image
  /identity        → enclave address (operator calls setTeeAddress with it)
  /attestation     → launcher OIDC token (proves image digest + TEE) from
                     /run/container_launcher/attestation_verifier_claims_token
  MODE=0           → key generated in-enclave at boot (no TEE_SIGNER_PRIVATE_KEY env)
```

## Related code files
- Create: `tee-extension/Dockerfile`, `tee-extension/.dockerignore`,
  `tee-extension/src/confidential-space-attestation.ts`,
  `tee-extension/confidential-space/setup-confidential-space.sh`,
  `docs/confidential-space-deployment-guide.md`
- Modify: `tee-extension/src/config.ts` (MODE=0 key handling), `tee-extension/src/server.ts` (endpoints)

## Implementation steps
1. Dockerfile (multi-stage: yarn install --frozen-lockfile → tsc → slim runtime).
2. MODE=0: generate signer key in-process when no env key; log address only.
3. `/attestation` + `/identity` endpoints (404 attestation gracefully outside Confidential Space).
4. gcloud script: artifact registry push, service account, workload identity pool + provider with
   image-digest condition, `gcloud compute instances create` with confidential-space image + tee-env metadata.
5. Operator guide in docs/.

## Todo
- [x] Dockerfile builds (local docker if available; else syntax-reviewed)
- [x] MODE=0 key + endpoints, `tsc` clean
- [x] setup script + guide

## Success criteria
`docker build` succeeds; guide takes an operator from zero → live enclave + `setTeeAddress` in <1 h.

## Risk assessment
No GCP account here → cannot smoke-test the VM path; mitigate with exact command provenance from GCP docs
and honest labeling in SUBMISSION.md. TeeExtensionRegistry still absent on Coston2 (Flare-side blocker).

## Security considerations
Key never persisted/exported; attestation token only proves image identity (no secrets); guide warns
to whitelist image digest, not tag.

## Next steps
User runs the script with GCP billing; then `setTeeAddress(enclaveAddr)` flips the trust root to real TEE.
