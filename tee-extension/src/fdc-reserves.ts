import { JsonRpcProvider, Wallet, Contract, AbiCoder } from "ethers";

/**
 * FDC Web2Json round-trip for the reserves endpoint:
 *   prepareRequest (verifier) -> FdcHub.requestAttestation -> wait for round finalization (Relay)
 *   -> fetch proof from the DA layer -> return an IWeb2Json.Proof ready for on-chain verification.
 * Ported from the flare-hardhat-starter FDC helper; all contract addresses resolved via the registry.
 */
const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Right-pad a UTF-8 string to a bytes32 hex value (FDC attestationType / sourceId encoding). */
function toUtf8Hex32(s: string): string {
  return "0x" + Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
}

async function contractAddress(provider: JsonRpcProvider, name: string): Promise<string> {
  const reg = new Contract(
    FLARE_CONTRACT_REGISTRY,
    ["function getContractAddressByName(string) view returns (address)"],
    provider
  );
  return reg.getContractAddressByName(name);
}

// The Web2Json Response tuple, used to decode the DA layer's response_hex.
const RESPONSE_TUPLE =
  "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, " +
  "tuple(string url, string httpMethod, string headers, string queryParams, string body, string postProcessJq, string abiSignature) requestBody, " +
  "tuple(bytes abiEncodedData) responseBody)";

export interface Web2JsonProof {
  merkleProof: string[];
  data: unknown;
}

export interface ProveReservesOptions {
  provider: JsonRpcProvider;
  wallet: Wallet;
  verifierUrl: string;
  apiKey: string;
  daLayerUrl: string;
  reservesUrl: string;
  log?: (msg: string) => void;
}

export async function proveReserves(opts: ProveReservesOptions): Promise<Web2JsonProof> {
  const log = opts.log ?? console.log;
  const { provider, wallet } = opts;

  // 1. prepareRequest — the reserves endpoint returns {"reserves": <int>}; keep only that field.
  const requestBody = {
    url: opts.reservesUrl,
    httpMethod: "GET",
    headers: "{}",
    queryParams: "{}",
    body: "{}",
    postProcessJq: "{reserves: .reserves}",
    abiSignature: JSON.stringify({
      components: [{ internalType: "uint256", name: "reserves", type: "uint256" }],
      name: "task",
      type: "tuple",
    }),
  };
  const prepUrl = `${opts.verifierUrl}/verifier/web2/Web2Json/prepareRequest`;
  const prep = await fetch(prepUrl, {
    method: "POST",
    headers: { "X-API-KEY": opts.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      attestationType: toUtf8Hex32("Web2Json"),
      sourceId: toUtf8Hex32("PublicWeb2"),
      requestBody,
    }),
  });
  if (!prep.ok) throw new Error(`prepareRequest failed ${prep.status}: ${await prep.text()}`);
  const { abiEncodedRequest } = (await prep.json()) as { abiEncodedRequest: string };
  log("FDC: prepared attestation request");

  // 2. submit to FdcHub with the required fee
  const fdcHubAddr = await contractAddress(provider, "FdcHub");
  const feeCfgAddr = await contractAddress(provider, "FdcRequestFeeConfigurations");
  const feeCfg = new Contract(feeCfgAddr, ["function getRequestFee(bytes) view returns (uint256)"], provider);
  const fee = await feeCfg.getRequestFee(abiEncodedRequest);
  const fdcHub = new Contract(fdcHubAddr, ["function requestAttestation(bytes) payable"], wallet);
  const submitTx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
  const receipt = await submitTx.wait();
  log(`FDC: request submitted (tx ${receipt.hash})`);

  // 3. compute the voting round id from the submission block timestamp
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

  // 4. wait for finalization
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

  // 5. fetch the proof from the DA layer
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

  // 6. decode response_hex into the Response tuple and rebuild a plain object (stable re-encoding)
  const [decoded]: any = AbiCoder.defaultAbiCoder().decode([RESPONSE_TUPLE], proof.response_hex);
  const rb = decoded[4];
  const resp = decoded[5];
  const data = {
    attestationType: decoded[0],
    sourceId: decoded[1],
    votingRound: decoded[2],
    lowestUsedTimestamp: decoded[3],
    requestBody: {
      url: rb[0],
      httpMethod: rb[1],
      headers: rb[2],
      queryParams: rb[3],
      body: rb[4],
      postProcessJq: rb[5],
      abiSignature: rb[6],
    },
    responseBody: { abiEncodedData: resp[0] },
  };
  return { merkleProof: proof.proof, data };
}
