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
  addresses: deployments.contracts as DeployedAddresses,
};
