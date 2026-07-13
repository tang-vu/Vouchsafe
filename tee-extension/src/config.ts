import * as dotenv from "dotenv";
import * as path from "path";

// Load the root .env first (shared across workspaces), then any local override.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

/**
 * Operation identifiers, matching the on-chain InstructionSender and the Flare FCC OPType/OPCommand
 * routing model. These strings must stay identical across the extension and the contracts.
 */
export const OP_TYPE_SOLVENCY = "SOLVENCY";
export const OP_COMMAND_PROVE = "PROVE";

/** Domain tag binding a signature to the Vouchsafe scheme + version (mirrors SolvencyVerifier.DOMAIN). */
export const DOMAIN = "VOUCHSAFE_SOLVENCY_V1";

export const config = {
  port: Number(process.env.TEE_EXTENSION_PORT ?? 7800),
  // Simulated mode: a local ECDSA keypair stands in for the enclave key. In real Confidential Space
  // (MODE=0) the key is generated and held inside the enclave and never exported.
  simulated: (process.env.SIMULATED_TEE ?? "true").toLowerCase() === "true",
  mode: Number(process.env.MODE ?? 1), // 0 = production attestation, 1 = simulated attestation
  teeSignerPrivateKey: process.env.TEE_SIGNER_PRIVATE_KEY ?? "",
};
