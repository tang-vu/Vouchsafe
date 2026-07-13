// Public library surface of the TEE extension, consumed by the attestor-service and demo.
export { createApp } from "./server";
export { TeeSigner } from "./tee-signer";
export { handleProveSolvency } from "./action-handler";
export { computeSolvency } from "./solvency-compute";
export { proveReserves } from "./fdc-reserves";
export type { Web2JsonProof, ProveReservesOptions } from "./fdc-reserves";
export { config as teeConfig, OP_TYPE_SOLVENCY, OP_COMMAND_PROVE, DOMAIN } from "./config";
export type { ProveSolvencyRequest, SolvencyAttestationResult } from "./types";
