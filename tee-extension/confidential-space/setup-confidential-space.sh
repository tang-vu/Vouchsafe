#!/usr/bin/env bash
set -euo pipefail

# One-shot GCP Confidential Space deployment for the Vouchsafe TEE extension.
# Prerequisite (one manual step): billing enabled on the project —
#   gcloud beta billing projects link "$PROJECT" --billing-account=<BILLING_ACCOUNT_ID>
# Everything else (APIs, image build, service account, confidential VM, firewall) is automated.
# Uses Cloud Build, so no local Docker is required. Run from anywhere:
#   bash tee-extension/confidential-space/setup-confidential-space.sh

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
REPO="${REPO:-vouchsafe}"
VM_NAME="${VM_NAME:-vouchsafe-tee}"
SA_NAME="vouchsafe-cs"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/tee-extension"

echo "Project: ${PROJECT} | Region: ${REGION} | Zone: ${ZONE}"

echo "[1/6] Enabling required APIs…"
gcloud services enable compute.googleapis.com confidentialcomputing.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com --project "${PROJECT}"

echo "[2/6] Creating Artifact Registry repo (idempotent)…"
gcloud artifacts repositories create "${REPO}" --repository-format=docker \
  --location="${REGION}" --project "${PROJECT}" 2>/dev/null || true

echo "[3/6] Building the workload image with Cloud Build…"
cd "$(dirname "$0")/.."
gcloud builds submit --tag "${IMAGE}:latest" --project "${PROJECT}" .

DIGEST=$(gcloud artifacts docker images describe "${IMAGE}:latest" \
  --format='value(image_summary.digest)' --project "${PROJECT}")
echo "Image digest (the enclave identity relying parties whitelist): ${DIGEST}"

echo "[4/6] Creating workload service account + roles (idempotent)…"
gcloud iam service-accounts create "${SA_NAME}" --project "${PROJECT}" 2>/dev/null || true
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${SA}" --role=roles/confidentialcomputing.workloadUser --quiet >/dev/null
gcloud artifacts repositories add-iam-policy-binding "${REPO}" --location="${REGION}" \
  --member="serviceAccount:${SA}" --role=roles/artifactregistry.reader --project "${PROJECT}" --quiet >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${SA}" --role=roles/logging.logWriter --quiet >/dev/null

echo "[5/6] Creating the Confidential Space VM (AMD SEV, n2d)…"
# tee-image-reference pins the DIGEST — a retagged image will not attest.
gcloud compute instances create "${VM_NAME}" \
  --project "${PROJECT}" --zone "${ZONE}" \
  --machine-type=n2d-standard-2 \
  --confidential-compute-type=SEV \
  --shielded-secure-boot \
  --maintenance-policy=TERMINATE \
  --image-family=confidential-space \
  --image-project=confidential-space-images \
  --service-account="${SA}" \
  --scopes=cloud-platform \
  --tags=vouchsafe-tee \
  --metadata="^~^tee-image-reference=${IMAGE}@${DIGEST}~tee-container-log-redirect=true"
# NOTE: MODE=0 / SIMULATED_TEE=false are baked into the image (Dockerfile ENV) on purpose — the
# Confidential Space launcher rejects tee-env-* overrides unless the image allow-lists them, and
# baked-in env is part of the attested image identity anyway.

echo "[6/6] Opening the extension port (demo only — restrict source ranges in production)…"
gcloud compute firewall-rules create allow-vouchsafe-tee --project "${PROJECT}" \
  --allow=tcp:7800 --target-tags=vouchsafe-tee 2>/dev/null || true

IP=$(gcloud compute instances describe "${VM_NAME}" --zone "${ZONE}" --project "${PROJECT}" \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)')

cat <<EOF

Confidential Space enclave is booting (allow ~2 minutes). Then:
  1. Enclave identity:       curl http://${IP}:7800/pubkey
  2. Attestation token:      curl http://${IP}:7800/attestation   (Google-signed image+TEE claims)
  3. Register on Coston2:    SolvencyVerifier.setTeeAddress(<teeAddress from step 1>)
  4. Point the service:      set the attestor-service extension URL to http://${IP}:7800
Teardown when done:
  gcloud compute instances delete ${VM_NAME} --zone ${ZONE} --project ${PROJECT}
EOF
