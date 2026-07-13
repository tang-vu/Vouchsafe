import {
  JsonRpcProvider,
  Wallet,
  Contract,
  keccak256,
  toUtf8Bytes,
  AbiCoder,
  formatEther,
} from "ethers";
import { createApp, TeeSigner, proveReserves, teeConfig } from "@vouchsafe/tee-extension";
import { config } from "./config";
import { VERIFIER_ABI, STAKING_ABI, REGISTRY_ABI } from "./abis";

const coder = AbiCoder.defaultAbiCoder();
type Logger = (msg: string) => void;

function provider(): JsonRpcProvider {
  return new JsonRpcProvider(config.rpc);
}
function makeSigner(): TeeSigner {
  return new TeeSigner(teeConfig.teeSignerPrivateKey, teeConfig.simulated);
}

/** Start the confidential extension in-process (stands in for the enclave endpoint). */
async function startExtension(signer: TeeSigner): Promise<{ url: string; close: () => void }> {
  const app = createApp(signer);
  const server = await new Promise<import("http").Server>((res) => {
    const s = app.listen(0, () => res(s));
  });
  const port = (server.address() as import("net").AddressInfo).port;
  return { url: `http://localhost:${port}`, close: () => server.close() };
}

/** Ensure the verifier knows the TEE signer and the attestor is staked. */
async function ensureSetup(verifier: Contract, staking: Contract, signer: TeeSigner, wallet: Wallet) {
  if ((await verifier.teeAddress()).toLowerCase() !== signer.address.toLowerCase()) {
    await (await verifier.setTeeAddress(signer.address)).wait();
  }
  const minStake: bigint = await staking.minStake();
  if ((await staking.stakeOf(wallet.address)) < minStake) {
    await (await staking.stake({ value: minStake })).wait();
  }
}

async function fetchReserveProof(wallet: Wallet, p: JsonRpcProvider, log: Logger) {
  return proveReserves({
    provider: p,
    wallet,
    verifierUrl: config.verifierUrl,
    apiKey: config.apiKey,
    daLayerUrl: config.daLayerUrl,
    reservesUrl: config.reservesUrl,
    log,
  });
}

export interface AttestInput {
  subject: string;
  reserves: string[];
  liabilities: string[];
}

export interface AttestResult {
  attestationId: string;
  txHash: string;
  explorerUrl: string;
  subject: string;
  solvent: boolean;
  timestamp: number;
  inputHash: string;
}

/** Happy path: TEE signs an honest claim, FDC attests reserves, record with both proofs. */
export async function attest(input: AttestInput, log: Logger = console.log): Promise<AttestResult> {
  const p = provider();
  const wallet = new Wallet(config.privateKey, p);
  const signer = makeSigner();

  const ext = await startExtension(signer);
  let attestation: any;
  try {
    const body = {
      opType: "SOLVENCY",
      opCommand: "PROVE",
      message: {
        subject: input.subject,
        reserves: input.reserves,
        liabilities: input.liabilities,
        salt: keccak256(toUtf8Bytes(`vouchsafe-${Date.now()}-${Math.random()}`)),
        nonce: Date.now().toString(),
        chainId: config.chainId,
        verifier: config.addresses.SolvencyVerifier,
      },
    };
    const resp = await fetch(`${ext.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    attestation = await resp.json();
    if (!resp.ok) throw new Error("extension error: " + JSON.stringify(attestation));
  } finally {
    ext.close();
  }
  log(`TEE signed: subject=${attestation.subject} solvent=${attestation.solvent}`);

  const proof = await fetchReserveProof(wallet, p, log);

  const verifier = new Contract(config.addresses.SolvencyVerifier, VERIFIER_ABI, wallet);
  const staking = new Contract(config.addresses.AttestorStaking, STAKING_ABI, wallet);
  await ensureSetup(verifier, staking, signer, wallet);

  const claim = {
    subject: attestation.subject,
    inputHash: attestation.inputHash,
    reservesCommitment: attestation.reservesCommitment,
    solvent: attestation.solvent,
    timestamp: attestation.timestamp,
    nonce: attestation.nonce,
  };
  const id: string = await verifier.recordSolvency.staticCall(claim, attestation.signature, proof);
  const receipt = await (await verifier.recordSolvency(claim, attestation.signature, proof)).wait();

  return {
    attestationId: id,
    txHash: receipt.hash,
    explorerUrl: `${config.explorer}/tx/${receipt.hash}`,
    subject: attestation.subject,
    solvent: attestation.solvent,
    timestamp: attestation.timestamp,
    inputHash: attestation.inputHash,
  };
}

export interface FraudResult {
  attestationId: string;
  recordTx: string;
  fraudTx: string;
  fraudExplorerUrl: string;
  stakeBefore: string;
  stakeAfter: string;
}

/**
 * Fraud path: a malicious attestor uses their TEE key to sign solvent=true over inputs that are
 * actually insolvent (reserves < liabilities). It records, then anyone proves the fraud (reveal +
 * FDC proof) and the stake is slashed. `reserves` must equal the public reserves endpoint value.
 */
export async function commitFraud(input: AttestInput, log: Logger = console.log): Promise<FraudResult> {
  const p = provider();
  const wallet = new Wallet(config.privateKey, p);
  const signer = makeSigner();

  const totalReserves = input.reserves.reduce((a, b) => a + BigInt(b), 0n);
  const totalLiabilities = input.liabilities.reduce((a, b) => a + BigInt(b), 0n);
  const salt = keccak256(toUtf8Bytes(`fraud-${Date.now()}`));
  const inputHash = keccak256(coder.encode(["uint256", "uint256", "bytes32"], [totalReserves, totalLiabilities, salt]));
  const reservesCommitment = keccak256(coder.encode(["uint256"], [totalReserves]));
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Date.now().toString();

  // Malicious signature: solvent=true even though totalReserves < totalLiabilities.
  const digest = signer.digest({
    chainId: config.chainId,
    verifier: config.addresses.SolvencyVerifier,
    subject: input.subject,
    inputHash,
    reservesCommitment,
    solvent: true,
    timestamp,
    nonce: BigInt(nonce),
  });
  const sig = await signer.sign(digest);
  log(`Malicious attestor signed solvent=true (reserves ${totalReserves} < liabilities ${totalLiabilities})`);

  const proof = await fetchReserveProof(wallet, p, log);

  const verifier = new Contract(config.addresses.SolvencyVerifier, VERIFIER_ABI, wallet);
  const staking = new Contract(config.addresses.AttestorStaking, STAKING_ABI, wallet);
  await ensureSetup(verifier, staking, signer, wallet);

  const claim = { subject: input.subject, inputHash, reservesCommitment, solvent: true, timestamp, nonce };
  const id = keccak256(coder.encode(["address", "address", "bytes32", "uint256"], [input.subject, wallet.address, inputHash, BigInt(nonce)]));

  const stakeBefore: bigint = await staking.stakeOf(wallet.address);
  const recordReceipt = await (await verifier.recordSolvency(claim, sig, proof)).wait();
  log("Fraudulent 'solvent' attestation recorded on-chain");

  const fraudReceipt = await (await verifier.raiseFraud(id, totalLiabilities, salt, proof)).wait();
  const stakeAfter: bigint = await staking.stakeOf(wallet.address);
  log("Fraud proven -> attestor slashed");

  return {
    attestationId: id,
    recordTx: recordReceipt.hash,
    fraudTx: fraudReceipt.hash,
    fraudExplorerUrl: `${config.explorer}/tx/${fraudReceipt.hash}`,
    stakeBefore: formatEther(stakeBefore),
    stakeAfter: formatEther(stakeAfter),
  };
}

export async function readAttestation(id: string) {
  const registry = new Contract(config.addresses.SolvencyRegistry, REGISTRY_ABI, provider());
  const a = await registry.getAttestation(id);
  return {
    subject: a.subject,
    attestor: a.attestor,
    solvent: a.solvent,
    timestamp: Number(a.timestamp),
    inputHash: a.inputHash,
    revoked: a.revoked,
  };
}
