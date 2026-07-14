import { JsonRpcProvider, Contract, ZeroHash } from "ethers";
import { config } from "./config";
import { XRPL_RESERVE_PROOF_ABI } from "./abis";
import { XRPL_TESTNET_EXPLORER } from "./xrpl-client";

/** Read a subject's XRPL reserve-address control status from the XrplReserveProof contract. */
export async function readXrplControl(subject: string) {
  const address = config.addresses.XrplReserveProof;
  if (!address) throw new Error("XrplReserveProof not deployed (missing from deployments file)");

  const xrpl = new Contract(address, XRPL_RESERVE_PROOF_ABI, new JsonRpcProvider(config.rpc));
  const [registeredAddress, control, fresh] = await Promise.all([
    xrpl.xrplAddressOf(subject),
    xrpl.lastProof(subject),
    xrpl.isFresh(subject, 24 * 3600),
  ]);

  const proven = control.xrplTxId !== ZeroHash;
  const txHash = proven ? (control.xrplTxId as string).replace(/^0x/, "").toUpperCase() : null;
  return {
    subject,
    xrplAddress: registeredAddress || null,
    proven,
    xrplTxId: proven ? control.xrplTxId : null,
    xrplExplorerUrl: txHash ? `${XRPL_TESTNET_EXPLORER}/transactions/${txHash}` : null,
    xrplTimestamp: proven ? Number(control.xrplTimestamp) : null,
    provenAt: proven ? Number(control.provenAt) : null,
    freshWithin24h: fresh as boolean,
  };
}
