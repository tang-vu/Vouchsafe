import { Client, Wallet as XrplWallet, Payment } from "xrpl";

/**
 * Minimal XRPL testnet client for the challenge-payment flow: fund throwaway wallets from the
 * public faucet, then send a 1-drop payment from the "reserve" wallet whose single memo carries
 * the 32-byte challenge reference (FDC's standard payment reference rule for XRPL).
 */
const XRPL_TESTNET_WS = "wss://s.altnet.rippletest.net:51233";
export const XRPL_TESTNET_EXPLORER = "https://testnet.xrpl.org";

export interface XrplTestWallets {
  client: Client;
  /** Stands in for the issuer's XRP reserve address (register this on-chain before proving). */
  reserve: XrplWallet;
  destination: XrplWallet;
}

export async function createFundedXrplWallets(log: (m: string) => void): Promise<XrplTestWallets> {
  const client = new Client(XRPL_TESTNET_WS);
  await client.connect();
  log("XRPL: connected to testnet, requesting faucet funding (two wallets)…");
  const [{ wallet: reserve }, { wallet: destination }] = await Promise.all([
    client.fundWallet(),
    client.fundWallet(),
  ]);
  log(`XRPL: reserve address ${reserve.address}, destination ${destination.address}`);
  return { client, reserve, destination };
}

export interface ChallengePaymentResult {
  txHash: string;
  explorerUrl: string;
}

/**
 * Send the challenge payment: 1 drop from the reserve address with exactly one memo whose
 * MemoData is the 32-byte challenge reference — FDC extracts it as `standardPaymentReference`.
 */
export async function sendChallengePayment(
  wallets: XrplTestWallets,
  referenceHex32: string,
  log: (m: string) => void
): Promise<ChallengePaymentResult> {
  const memoData = referenceHex32.replace(/^0x/i, "").toUpperCase();
  if (memoData.length !== 64) throw new Error("challenge reference must be 32 bytes");

  const payment: Payment = {
    TransactionType: "Payment",
    Account: wallets.reserve.address,
    Destination: wallets.destination.address,
    Amount: "1", // 1 drop — the memo is the payload, not the value
    Memos: [{ Memo: { MemoData: memoData } }],
  };

  log("XRPL: submitting challenge payment (memo = challenge reference)…");
  const result = await wallets.client.submitAndWait(payment, { autofill: true, wallet: wallets.reserve });
  const meta = result.result.meta;
  const code = typeof meta === "object" && meta !== null ? (meta as { TransactionResult?: string }).TransactionResult : undefined;
  if (code !== "tesSUCCESS") throw new Error(`XRPL payment failed: ${code ?? "unknown result"}`);

  const txHash = result.result.hash;
  log(`XRPL: payment validated (tx ${txHash})`);
  return { txHash, explorerUrl: `${XRPL_TESTNET_EXPLORER}/transactions/${txHash}` };
}
