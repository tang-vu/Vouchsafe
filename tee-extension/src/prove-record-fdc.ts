import * as fs from "fs";
import * as path from "path";
import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes, formatEther } from "ethers";
import { createApp } from "./server";
import { TeeSigner } from "./tee-signer";
import { config } from "./config";
import { proveReserves } from "./fdc-reserves";
import { ProveSolvencyRequest } from "./types";

/**
 * Full Phase 3 live flow on Coston2:
 *   private figures -> TEE extension (sign) -> FDC Web2Json reserve proof -> recordSolvency (BOTH proofs).
 * Binds the attestation to a real FXRP agent vault and prints the recorded, number-free attestation.
 */
const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const CHAIN_ID = 114;
const EXPLORER = "https://coston2-explorer.flare.network";
// A real FXRP agent vault on Coston2 (from scripts/fassets/list-agents.ts).
const SUBJECT_AGENT_VAULT = "0x5b89514d1F060AdbEA8B7294AFf81ed8dbAa7fC5";
// Reserves total must equal the value the public RESERVES_URL returns (gist = 1,500,000).
const RESERVES = ["1500000"];
const LIABILITIES = ["900000"];

const RECORD_ABI = [
  "function teeAddress() view returns (address)",
  "function setTeeAddress(address)",
  "function recordSolvency((address subject,bytes32 inputHash,bytes32 reservesCommitment,bool solvent,uint64 timestamp,uint256 nonce) claim, bytes teeSignature, (bytes32[] merkleProof, (bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp,(string url,string httpMethod,string headers,string queryParams,string body,string postProcessJq,string abiSignature) requestBody,(bytes abiEncodedData) responseBody) data) fdcProof) returns (bytes32)",
];
const STAKING_ABI = [
  "function stake() payable",
  "function stakeOf(address) view returns (uint256)",
  "function minStake() view returns (uint256)",
];
const REGISTRY_ABI = [
  "function getAttestation(bytes32) view returns (tuple(address subject,address attestor,bytes32 inputHash,bytes32 reservesCommitment,uint64 timestamp,uint256 nonce,bool solvent,bool revoked))",
];

async function main() {
  const pk = process.env.PRIVATE_KEY;
  const reservesUrl = process.env.RESERVES_URL;
  const verifierUrl = process.env.VERIFIER_URL_TESTNET;
  const apiKey = process.env.VERIFIER_API_KEY_TESTNET ?? "";
  const daLayerUrl = process.env.COSTON2_DA_LAYER_URL;
  if (!pk) throw new Error("PRIVATE_KEY not set");
  if (!reservesUrl) throw new Error("RESERVES_URL not set");
  if (!verifierUrl || !daLayerUrl) throw new Error("VERIFIER_URL_TESTNET / COSTON2_DA_LAYER_URL not set");

  const deployments = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../contracts/deployments/coston2.json"), "utf8")
  );
  const { SolvencyVerifier: verifierAddr, AttestorStaking: stakingAddr, SolvencyRegistry: registryAddr } =
    deployments.contracts;

  // 1. TEE extension signs the solvency claim (private figures never leave the process).
  const signer = new TeeSigner(config.teeSignerPrivateKey, config.simulated);
  const app = createApp(signer);
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as import("net").AddressInfo).port;

  const message: ProveSolvencyRequest = {
    subject: SUBJECT_AGENT_VAULT,
    reserves: RESERVES,
    liabilities: LIABILITIES,
    salt: keccak256(toUtf8Bytes(`vouchsafe-fdc-${Date.now()}`)),
    nonce: Date.now().toString(),
    chainId: CHAIN_ID,
    verifier: verifierAddr,
  };
  const resp = await fetch(`http://localhost:${port}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ opType: "SOLVENCY", opCommand: "PROVE", message }),
  });
  const attestation: any = await resp.json();
  server.close();
  if (!resp.ok) throw new Error("extension error: " + JSON.stringify(attestation));
  console.log(`TEE attestation: subject=${attestation.subject} solvent=${attestation.solvent}`);
  console.log(`  inputHash=${attestation.inputHash}`);
  console.log(`  reservesCommitment=${attestation.reservesCommitment}`);

  // 2. FDC Web2Json reserve proof (real round-trip; ~90-180s finalization).
  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(pk, provider);
  console.log("\nRequesting FDC Web2Json reserve proof…");
  const fdcProof = await proveReserves({ provider, wallet, verifierUrl, apiKey, daLayerUrl, reservesUrl });

  // 3. Ensure the TEE + stake are set, then record with BOTH proofs.
  const verifier = new Contract(verifierAddr, RECORD_ABI, wallet);
  const staking = new Contract(stakingAddr, STAKING_ABI, wallet);
  const registry = new Contract(registryAddr, REGISTRY_ABI, provider);

  if ((await verifier.teeAddress()).toLowerCase() !== signer.address.toLowerCase()) {
    console.log(`Registering TEE signer ${signer.address}`);
    await (await verifier.setTeeAddress(signer.address)).wait();
  }
  const minStake: bigint = await staking.minStake();
  if ((await staking.stakeOf(wallet.address)) < minStake) {
    console.log(`Staking ${formatEther(minStake)} C2FLR`);
    await (await staking.stake({ value: minStake })).wait();
  }

  const claim = {
    subject: attestation.subject,
    inputHash: attestation.inputHash,
    reservesCommitment: attestation.reservesCommitment,
    solvent: attestation.solvent,
    timestamp: attestation.timestamp,
    nonce: attestation.nonce,
  };
  console.log("\nRecording solvency with BOTH the TEE signature and the FDC proof…");
  const id: string = await verifier.recordSolvency.staticCall(claim, attestation.signature, fdcProof);
  const tx = await verifier.recordSolvency(claim, attestation.signature, fdcProof);
  const receipt = await tx.wait();

  console.log(`\nRecorded attestation id: ${id}`);
  console.log(`Tx: ${EXPLORER}/tx/${receipt!.hash}`);

  const stored = await registry.getAttestation(id);
  console.log("\nThird-party view (no raw figures):");
  console.log(`  subject (FXRP agent): ${stored.subject}`);
  console.log(`  solvent:              ${stored.solvent}`);
  console.log(`  at T:                 ${stored.timestamp}`);
  console.log(`  inputHash:            ${stored.inputHash}`);
  console.log(`  Registry: ${EXPLORER}/address/${registryAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
