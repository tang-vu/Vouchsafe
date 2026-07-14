import { JsonRpcProvider, Wallet, Contract, hexlify, randomBytes } from "ethers";
import { provePayment } from "@vouchsafe/tee-extension";
import { config } from "./config";
import { XRPL_RESERVE_PROOF_ABI } from "./abis";
import { createFundedXrplWallets, sendChallengePayment } from "./xrpl-client";

/**
 * XRPL-native reserve proof, end-to-end on live networks (~4–6 min):
 *   1. faucet-fund a throwaway XRPL testnet wallet — it stands in for the issuer's reserve address
 *   2. owner registers that address for the subject on XrplReserveProof (Coston2)
 *   3. the subject answers the contract's challenge: a 1-drop XRPL payment whose memo is the
 *      challenge reference
 *   4. FDC attests the payment (Payment type, sourceId testXRP); the proof is verified on-chain
 *      by proveControl — recording "control of the reserve address demonstrated at T".
 */
async function main() {
  const log = (m: string) => console.log(`  ${m}`);
  const address = config.addresses.XrplReserveProof;
  if (!address) throw new Error("XrplReserveProof missing from deployments — run deploy:xrpl-reserve-proof first");
  if (!config.privateKey) throw new Error("PRIVATE_KEY not set");

  const provider = new JsonRpcProvider(config.rpc);
  const wallet = new Wallet(config.privateKey, provider);
  const xrplProof = new Contract(address, XRPL_RESERVE_PROOF_ABI, wallet);
  const subject = wallet.address; // demo: the service key attests for itself as subject

  console.log("Vouchsafe XRPL reserve-control demo (Coston2 + XRPL testnet)");
  console.log(`  contract: ${address}`);
  console.log(`  subject:  ${subject}`);

  // 1. XRPL testnet wallets
  const wallets = await createFundedXrplWallets(log);
  try {
    // 2. register the reserve address (owner call — the demo key deployed the contract)
    if ((await xrplProof.xrplAddressOf(subject)) !== wallets.reserve.address) {
      await (await xrplProof.setXrplReserveAddress(subject, wallets.reserve.address)).wait();
      log(`registered XRPL reserve address for subject on-chain`);
    }

    // 3. challenge payment: memo carries the contract-derived reference for (subject, nonce)
    const nonce = BigInt(hexlify(randomBytes(16)));
    const ref: string = await xrplProof.challengeRef(subject, nonce);
    log(`challenge reference: ${ref}`);
    const payment = await sendChallengePayment(wallets, ref, log);
    log(`XRPL explorer: ${payment.explorerUrl}`);

    // 4. FDC Payment attestation + on-chain verification
    const proof = await provePayment({
      provider,
      wallet,
      verifierUrl: config.verifierUrl,
      apiKey: config.apiKey,
      daLayerUrl: config.daLayerUrl,
      xrplTxId: payment.txHash,
      log,
    });
    const tx = await (await xrplProof.proveControl(subject, nonce, proof)).wait();

    console.log("\nXRPL reserve-address control proven on-chain:");
    console.log(`  proveControl tx: ${config.explorer}/tx/${tx.hash}`);
    console.log(`  XRPL payment:    ${payment.explorerUrl}`);
    console.log(`  fresh (24h):     ${await xrplProof.isFresh(subject, 24 * 3600)}`);
  } finally {
    await wallets.client.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
