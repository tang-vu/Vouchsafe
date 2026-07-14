import { JsonRpcProvider, Wallet, AbiCoder } from "ethers";
import { toUtf8Hex32, submitAndProve, sleep } from "./fdc-common";

/**
 * FDC Payment round-trip for an XRPL testnet transaction (sourceId `testXRP`):
 *   prepareRequest (xrp verifier; polled until the tx is indexed) -> FdcHub.requestAttestation
 *   -> round finalization -> DA-layer proof -> an IPayment.Proof ready for on-chain verification.
 * Used by the XrplReserveProof challenge-payment flow (proof of reserve-address control).
 */

// The Payment Response tuple, used to decode the DA layer's response_hex.
const RESPONSE_TUPLE =
  "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, " +
  "tuple(bytes32 transactionId, uint256 inUtxo, uint256 utxo) requestBody, " +
  "tuple(uint64 blockNumber, uint64 blockTimestamp, bytes32 sourceAddressHash, bytes32 sourceAddressesRoot, " +
  "bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, int256 intendedSpentAmount, " +
  "int256 receivedAmount, int256 intendedReceivedAmount, bytes32 standardPaymentReference, bool oneToOne, uint8 status) responseBody)";

export interface PaymentProof {
  merkleProof: string[];
  data: unknown;
}

export interface ProvePaymentOptions {
  provider: JsonRpcProvider;
  wallet: Wallet;
  verifierUrl: string;
  apiKey: string;
  daLayerUrl: string;
  /** XRPL transaction hash (64 hex chars, with or without 0x prefix). */
  xrplTxId: string;
  log?: (msg: string) => void;
}

/** Poll prepareRequest until the XRPL tx is indexed by the verifier (it rejects until then). */
async function preparePaymentRequest(opts: ProvePaymentOptions, log: (m: string) => void): Promise<string> {
  const txId = "0x" + opts.xrplTxId.replace(/^0x/i, "").toLowerCase();
  const prepUrl = `${opts.verifierUrl}/verifier/xrp/Payment/prepareRequest`;
  const body = JSON.stringify({
    attestationType: toUtf8Hex32("Payment"),
    sourceId: toUtf8Hex32("testXRP"),
    requestBody: { transactionId: txId, inUtxo: "0", utxo: "0" },
  });

  // XRPL testnet indexing typically lags 1–3 minutes behind ledger close.
  for (let i = 0; i < 30; i++) {
    const r = await fetch(prepUrl, {
      method: "POST",
      headers: { "X-API-KEY": opts.apiKey, "Content-Type": "application/json" },
      body,
    });
    if (r.ok) {
      const json = (await r.json()) as { status?: string; abiEncodedRequest?: string };
      if (json.abiEncodedRequest && (!json.status || json.status === "VALID")) {
        return json.abiEncodedRequest;
      }
      log(`FDC: verifier not ready for the XRPL tx yet (status ${json.status ?? "?"}) — retrying`);
    } else {
      log(`FDC: prepareRequest ${r.status} — XRPL tx not indexed yet, retrying`);
    }
    await sleep(15000);
  }
  throw new Error("verifier did not accept the XRPL Payment request in time");
}

export async function provePayment(opts: ProvePaymentOptions): Promise<PaymentProof> {
  const log = opts.log ?? console.log;

  const abiEncodedRequest = await preparePaymentRequest(opts, log);
  log("FDC: prepared Payment attestation request");

  const round = await submitAndProve({
    provider: opts.provider,
    wallet: opts.wallet,
    abiEncodedRequest,
    daLayerUrl: opts.daLayerUrl,
    log,
  });

  // decode response_hex into the Payment Response tuple and rebuild a plain object
  const [decoded]: any = AbiCoder.defaultAbiCoder().decode([RESPONSE_TUPLE], round.responseHex);
  const rb = decoded[4];
  const resp = decoded[5];
  const data = {
    attestationType: decoded[0],
    sourceId: decoded[1],
    votingRound: decoded[2],
    lowestUsedTimestamp: decoded[3],
    requestBody: { transactionId: rb[0], inUtxo: rb[1], utxo: rb[2] },
    responseBody: {
      blockNumber: resp[0],
      blockTimestamp: resp[1],
      sourceAddressHash: resp[2],
      sourceAddressesRoot: resp[3],
      receivingAddressHash: resp[4],
      intendedReceivingAddressHash: resp[5],
      spentAmount: resp[6],
      intendedSpentAmount: resp[7],
      receivedAmount: resp[8],
      intendedReceivedAmount: resp[9],
      standardPaymentReference: resp[10],
      oneToOne: resp[11],
      status: resp[12],
    },
  };
  return { merkleProof: round.merkleProof, data };
}
