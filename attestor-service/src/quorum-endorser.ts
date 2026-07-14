import {
  Contract,
  JsonRpcProvider,
  Wallet,
  concat,
  formatEther,
  getBytes,
  keccak256,
  parseEther,
  toUtf8Bytes,
} from "ethers";
import { config } from "./config";
import { REGISTRY_ABI, STAKING_ABI, VERIFIER_ABI } from "./abis";

type Logger = (msg: string) => void;

/** Native-token floor kept on the endorser wallet so its transactions never run out of gas
 *  (Coston2 gas prices reach ~1150 gwei; a stake tx alone costs ~0.05 C2FLR). */
const GAS_FLOOR = parseEther("0.5");

/**
 * Deterministic second attestor derived from the service key. The same wallet is reused across runs,
 * so its stake (locked for the challenge window after every endorsement) persists between demos.
 */
export function endorserWallet(provider: JsonRpcProvider): Wallet {
  const seed = keccak256(concat([getBytes(config.privateKey), toUtf8Bytes("vouchsafe/endorser/v1")]));
  return new Wallet(seed, provider);
}

export interface EndorseResult {
  endorser: string;
  txHash: string;
  explorerUrl: string;
  endorsements: number;
  quorate: boolean;
}

/** Owner call: require `required` independent endorsements before `subject` attestations are quorate. */
export async function ensureQuorumPolicy(subject: string, required: number) {
  const provider = new JsonRpcProvider(config.rpc);
  const owner = new Wallet(config.privateKey, provider);
  const verifier = new Contract(config.addresses.SolvencyVerifier, VERIFIER_ABI, owner);
  const policy = await verifier.subjectPolicy(subject);
  if (Number(policy.requiredEndorsements) !== required) {
    await (await verifier.setSubjectPolicy(subject, policy.minStake, policy.slashPenalty, required)).wait();
  }
}

/**
 * Endorse a recorded attestation with the derived second attestor: fund it (once), stake it up to the
 * subject's effective requirement (once), then put that stake behind the attestation.
 */
export async function endorseAttestation(id: string, log: Logger = console.log): Promise<EndorseResult> {
  const provider = new JsonRpcProvider(config.rpc);
  const funder = new Wallet(config.privateKey, provider);
  const endorser = endorserWallet(provider);

  const registry = new Contract(config.addresses.SolvencyRegistry, REGISTRY_ABI, provider);
  const verifier = new Contract(config.addresses.SolvencyVerifier, VERIFIER_ABI, endorser);
  const staking = new Contract(config.addresses.AttestorStaking, STAKING_ABI, endorser);

  const subject: string = (await registry.getAttestation(id)).subject;
  const required: bigint = await verifier.requiredStakeFor(subject);
  const staked: bigint = await staking.stakeOf(endorser.address);
  const topUp = staked >= required ? 0n : required - staked;

  const balance = await provider.getBalance(endorser.address);
  const needed = topUp + GAS_FLOOR;
  if (balance < needed) {
    log(`funding endorser ${endorser.address} with ${formatEther(needed - balance)} C2FLR`);
    await (await funder.sendTransaction({ to: endorser.address, value: needed - balance })).wait();
  }
  if (topUp > 0n) {
    log(`endorser staking ${formatEther(topUp)} C2FLR`);
    await (await staking.stake({ value: topUp })).wait();
  }

  const receipt = await (await verifier.endorse(id)).wait();
  const endorsements = Number(await verifier.endorsementCount(id));
  const quorate: boolean = await verifier.isQuorate(id);
  log(`endorsed by ${endorser.address} — endorsements=${endorsements}, quorate=${quorate}`);

  return {
    endorser: endorser.address,
    txHash: receipt.hash,
    explorerUrl: `${config.explorer}/tx/${receipt.hash}`,
    endorsements,
    quorate,
  };
}
