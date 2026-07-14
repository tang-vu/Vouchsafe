import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const deployments = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../contracts/deployments/coston2.json"), "utf8")
);

export interface DeployedAddresses {
  SolvencyRegistry: string;
  AttestorStaking: string;
  SolvencyVerifier: string;
  VouchsafeInstructionSender: string;
  FxrpAgentBinding: string;
  /** Optional: only present after deploy-xrpl-reserve-proof has run against this network. */
  XrplReserveProof?: string;
}

export const config = {
  rpc: "https://coston2-api.flare.network/ext/C/rpc",
  chainId: 114,
  explorer: "https://coston2-explorer.flare.network",
  privateKey: process.env.PRIVATE_KEY ?? "",
  reservesUrl: process.env.RESERVES_URL ?? "",
  verifierUrl: process.env.VERIFIER_URL_TESTNET ?? "",
  apiKey: process.env.VERIFIER_API_KEY_TESTNET ?? "",
  daLayerUrl: process.env.COSTON2_DA_LAYER_URL ?? "",
  port: Number(process.env.ATTESTOR_SERVICE_PORT ?? 7900),
  // Public-demo hosting: disables every endpoint that spends the server's own key/stake.
  // Reads + MetaMask (user-side) transactions keep working.
  readOnly: /^(1|true)$/i.test(process.env.READ_ONLY ?? ""),
  addresses: deployments.contracts as DeployedAddresses,
  // The deploy key doubles as the demo subject/attestor — lets the UI prefill lookups.
  deployer: (deployments.deployer ?? "") as string,
  // First block of the deployment — lower bound for event scans (0 = unknown, scan a recent window).
  startBlock: Number(deployments.startBlock ?? 0),
};
