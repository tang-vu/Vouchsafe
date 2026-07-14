import { JsonRpcProvider, Wallet, AbiCoder } from "ethers";
import { toUtf8Hex32, submitAndProve } from "./fdc-common";

/**
 * FDC Web2Json round-trip for the reserves endpoint:
 *   prepareRequest (verifier) -> FdcHub.requestAttestation -> wait for round finalization (Relay)
 *   -> fetch proof from the DA layer -> return an IWeb2Json.Proof ready for on-chain verification.
 * Ported from the flare-hardhat-starter FDC helper; all contract addresses resolved via the registry.
 */

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

  // 2. FdcHub submission -> round finalization -> DA-layer proof (shared plumbing).
  const round = await submitAndProve({ provider, wallet, abiEncodedRequest, daLayerUrl: opts.daLayerUrl, log });

  // 3. decode response_hex into the Response tuple and rebuild a plain object (stable re-encoding)
  const [decoded]: any = AbiCoder.defaultAbiCoder().decode([RESPONSE_TUPLE], round.responseHex);
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
  return { merkleProof: round.merkleProof, data };
}
