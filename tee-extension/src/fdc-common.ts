import { JsonRpcProvider, Wallet, Contract } from "ethers";

/**
 * Shared FDC plumbing used by every attestation type (Web2Json reserves, XRPL Payment):
 * fee lookup + FdcHub submission, voting-round derivation, Relay finalization wait, and the
 * DA-layer proof fetch. All contract addresses resolved via FlareContractRegistry.
 */
export const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Right-pad a UTF-8 string to a bytes32 hex value (FDC attestationType / sourceId encoding). */
export function toUtf8Hex32(s: string): string {
  return "0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
}

export async function contractAddress(provider: JsonRpcProvider, name: string): Promise<string> {
  const reg = new Contract(
    FLARE_CONTRACT_REGISTRY,
    ["function getContractAddressByName(string) view returns (address)"],
    provider
  );
  return reg.getContractAddressByName(name);
}

export interface FdcRoundProof {
  roundId: number;
  merkleProof: string[];
  responseHex: string;
}

export interface SubmitAndProveOptions {
  provider: JsonRpcProvider;
  wallet: Wallet;
  abiEncodedRequest: string;
  daLayerUrl: string;
  log?: (msg: string) => void;
}

/** Submit a prepared FDC request to FdcHub, wait for the round to finalize, fetch the DA-layer proof. */
export async function submitAndProve(opts: SubmitAndProveOptions): Promise<FdcRoundProof> {
  const log = opts.log ?? console.log;
  const { provider, wallet, abiEncodedRequest } = opts;

  // submit to FdcHub with the required fee
  const fdcHubAddr = await contractAddress(provider, "FdcHub");
  const feeCfgAddr = await contractAddress(provider, "FdcRequestFeeConfigurations");
  const feeCfg = new Contract(feeCfgAddr, ["function getRequestFee(bytes) view returns (uint256)"], provider);
  const fee = await feeCfg.getRequestFee(abiEncodedRequest);
  const fdcHub = new Contract(fdcHubAddr, ["function requestAttestation(bytes) payable"], wallet);
  const submitTx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
  const receipt = await submitTx.wait();
  log(`FDC: request submitted (tx ${receipt.hash})`);

  // compute the voting round id from the submission block timestamp
  const fsmAddr = await contractAddress(provider, "FlareSystemsManager");
  const fsm = new Contract(
    fsmAddr,
    ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"],
    provider
  );
  const block = await provider.getBlock(receipt.blockNumber);
  const firstTs = BigInt(await fsm.firstVotingRoundStartTs());
  const duration = BigInt(await fsm.votingEpochDurationSeconds());
  const roundId = Number((BigInt(block!.timestamp) - firstTs) / duration);
  log(`FDC: voting round ${roundId}`);

  // wait for finalization
  const relayAddr = await contractAddress(provider, "Relay");
  const fdcVerifAddr = await contractAddress(provider, "FdcVerification");
  const relay = new Contract(relayAddr, ["function isFinalized(uint256,uint256) view returns (bool)"], provider);
  const fdcVerif = new Contract(fdcVerifAddr, ["function fdcProtocolId() view returns (uint8)"], provider);
  const protocolId = await fdcVerif.fdcProtocolId();
  log("FDC: waiting for round finalization…");
  while (!(await relay.isFinalized(protocolId, roundId))) {
    await sleep(20000);
  }
  log("FDC: round finalized");

  // fetch the proof from the DA layer
  const daUrl = `${opts.daLayerUrl}/api/v1/fdc/proof-by-request-round-raw`;
  let proof: any;
  for (let i = 0; i < 30; i++) {
    const r = await fetch(daUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ votingRoundId: roundId, requestBytes: abiEncodedRequest }),
    });
    proof = await r.json();
    if (proof && proof.response_hex) break;
    await sleep(10000);
  }
  if (!proof || !proof.response_hex) throw new Error("DA layer did not return a proof in time");
  log("FDC: proof retrieved from DA layer");

  return { roundId, merkleProof: proof.proof, responseHex: proof.response_hex };
}
