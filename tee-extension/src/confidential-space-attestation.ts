import * as fs from "fs";

/**
 * GCP Confidential Space integration: inside a Confidential Space VM the container launcher writes
 * an OIDC attestation token (image digest + TEE hardware claims, signed by Google) to a well-known
 * path. Exposing it lets any relying party verify WHICH image is running and THAT it runs in a real
 * TEE — the missing piece that turns the simulated-enclave demo into a production trust root.
 * Outside Confidential Space the file does not exist and callers get a graceful null.
 */
const ATTESTATION_TOKEN_PATH = "/run/container_launcher/attestation_verifier_claims_token";

export function isConfidentialSpace(): boolean {
  return fs.existsSync(ATTESTATION_TOKEN_PATH);
}

export function readAttestationToken(): string | null {
  try {
    return fs.readFileSync(ATTESTATION_TOKEN_PATH, "utf8").trim();
  } catch {
    return null;
  }
}
