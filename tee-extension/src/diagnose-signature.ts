import * as fs from "fs";
import * as path from "path";
import { JsonRpcProvider, Contract, keccak256, toUtf8Bytes } from "ethers";
import { TeeSigner } from "./tee-signer";
import { computeSolvency } from "./solvency-compute";
import { config } from "./config";

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const CHAIN_ID = 114;
const SUBJECT = "0x000000000000000000000000000000000000dEaD";

const ABI = [
  "function claimDigest((address subject,bytes32 inputHash,bytes32 reservesCommitment,bool solvent,uint64 timestamp,uint256 nonce) claim) view returns (bytes32)",
  "function recoverSigner((address subject,bytes32 inputHash,bytes32 reservesCommitment,bool solvent,uint64 timestamp,uint256 nonce) claim, bytes signature) view returns (address)",
  "function teeAddress() view returns (address)",
];

async function main() {
  const deployments = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../contracts/deployments/coston2.json"), "utf8")
  );
  const verifierAddr = deployments.contracts.SolvencyVerifier;

  const signer = new TeeSigner(config.teeSignerPrivateKey, config.simulated);
  const salt = keccak256(toUtf8Bytes("diagnose-salt"));
  const { solvent, inputHash, reservesCommitment } = computeSolvency(["1500000"], ["900000"], salt);
  const timestamp = 1_700_000_000;
  const nonce = 424242n;

  const tsDigest = signer.digest({ chainId: CHAIN_ID, verifier: verifierAddr, subject: SUBJECT, inputHash, reservesCommitment, solvent, timestamp, nonce });
  const sig = await signer.sign(tsDigest);

  const provider = new JsonRpcProvider(RPC);
  const verifier = new Contract(verifierAddr, ABI, provider);
  const claim = { subject: SUBJECT, inputHash, reservesCommitment, solvent, timestamp, nonce };

  const onchainDigest = await verifier.claimDigest(claim);
  const onchainRecovered = await verifier.recoverSigner(claim, sig);
  const onchainTee = await verifier.teeAddress();

  console.log("tsDigest       :", tsDigest);
  console.log("onchainDigest  :", onchainDigest);
  console.log("digest match   :", tsDigest === onchainDigest);
  console.log("signer.address :", signer.address);
  console.log("recovered      :", onchainRecovered);
  console.log("recover match  :", onchainRecovered.toLowerCase() === signer.address.toLowerCase());
  console.log("onchain tee    :", onchainTee);
}

main().catch((e) => { console.error(e); process.exit(1); });
