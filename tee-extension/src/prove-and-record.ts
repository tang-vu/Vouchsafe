import * as fs from "fs";
import * as path from "path";
import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes, formatEther } from "ethers";
import { createApp } from "./server";
import { TeeSigner } from "./tee-signer";
import { config } from "./config";
import { ProveSolvencyRequest } from "./types";

/**
 * End-to-end Phase 2 demo: private figures go INTO the (in-process) extension server over HTTP; only a
 * signed attestation comes out; that attestation is verified and recorded on Coston2. A third party can
 * then read "solvent at T" plus the input hash — with no underlying numbers on-chain.
 */
const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const CHAIN_ID = 114;
const EXPLORER = "https://coston2-explorer.flare.network";
const DEMO_SUBJECT = "0x000000000000000000000000000000000000dEaD"; // placeholder subject; real FXRP agent in Phase 3

const VERIFIER_ABI = [
  "function teeAddress() view returns (address)",
  "function owner() view returns (address)",
  "function setTeeAddress(address)",
  "function recordSolvency((address subject,bytes32 inputHash,bytes32 reservesCommitment,bool solvent,uint64 timestamp,uint256 nonce) claim, bytes signature) returns (bytes32)",
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
  if (!pk) throw new Error("PRIVATE_KEY not set in .env");

  const deployments = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../contracts/deployments/coston2.json"), "utf8")
  );
  const { SolvencyVerifier: verifierAddr, AttestorStaking: stakingAddr, SolvencyRegistry: registryAddr } =
    deployments.contracts;

  // 1. Start the confidential extension in-process and call it over real HTTP.
  const signer = new TeeSigner(config.teeSignerPrivateKey, config.simulated);
  const app = createApp(signer);
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as import("net").AddressInfo).port;
  console.log(`TEE extension up on :${port} (teeAddress=${signer.address}, simulated=${signer.simulated})`);

  const message: ProveSolvencyRequest = {
    subject: DEMO_SUBJECT,
    reserves: ["1000000", "500000"], // 1,500,000 — PRIVATE
    liabilities: ["900000"], // 900,000 — PRIVATE
    salt: keccak256(toUtf8Bytes(`vouchsafe-demo-${Date.now()}`)),
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

  console.log("\nAttestation returned by the enclave (no raw figures present):");
  console.log(
    JSON.stringify(
      {
        subject: attestation.subject,
        solvent: attestation.solvent,
        inputHash: attestation.inputHash,
        reservesCommitment: attestation.reservesCommitment,
        timestamp: attestation.timestamp,
        nonce: attestation.nonce,
        signature: attestation.signature.slice(0, 20) + "…",
      },
      null,
      2
    )
  );

  // 2. Submit on-chain: ensure TEE registered + attestor staked, then record.
  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(pk, provider);
  const verifier = new Contract(verifierAddr, VERIFIER_ABI, wallet);
  const staking = new Contract(stakingAddr, STAKING_ABI, wallet);
  const registry = new Contract(registryAddr, REGISTRY_ABI, provider);

  const currentTee: string = await verifier.teeAddress();
  if (currentTee.toLowerCase() !== signer.address.toLowerCase()) {
    console.log(`\nRegistering TEE signer on verifier: ${signer.address}`);
    await (await verifier.setTeeAddress(signer.address)).wait();
  }

  const minStake: bigint = await staking.minStake();
  const staked: bigint = await staking.stakeOf(wallet.address);
  if (staked < minStake) {
    console.log(`Staking ${formatEther(minStake)} C2FLR as attestor…`);
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
  const id: string = await verifier.recordSolvency.staticCall(claim, attestation.signature);
  const tx = await verifier.recordSolvency(claim, attestation.signature);
  const receipt = await tx.wait();

  console.log(`\nRecorded attestation id: ${id}`);
  console.log(`Tx: ${EXPLORER}/tx/${receipt!.hash}`);

  // 3. Read back what any third party sees — no numbers.
  const stored = await registry.getAttestation(id);
  console.log("\nWhat a third party reads on-chain:");
  console.log(`  subject:   ${stored.subject}`);
  console.log(`  solvent:   ${stored.solvent}`);
  console.log(`  at T:      ${stored.timestamp} (${new Date(Number(stored.timestamp) * 1000).toISOString()})`);
  console.log(`  inputHash: ${stored.inputHash}`);
  console.log(`  revoked:   ${stored.revoked}`);
  console.log(`  Registry:  ${EXPLORER}/address/${registryAddr}`);
  console.log("\nNote: reserves/liabilities never left the enclave and are absent on-chain.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
