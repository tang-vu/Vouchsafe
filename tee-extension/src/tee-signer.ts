import { BaseWallet, Wallet, AbiCoder, keccak256, getBytes } from "ethers";
import { DOMAIN } from "./config";

const abi = AbiCoder.defaultAbiCoder();

export interface ClaimDigestParams {
  chainId: number;
  verifier: string;
  subject: string;
  inputHash: string;
  reservesCommitment: string;
  solvent: boolean;
  timestamp: number;
  nonce: bigint;
}

/**
 * Holds the TEE signing key and produces the attestation signature.
 *
 * In SIMULATED mode this is a local ECDSA keypair standing in for the enclave key. In real
 * Confidential Space (MODE=0) the equivalent key is generated inside the enclave and used via the
 * node's sign port — the extension code never sees the raw key. The digest construction and the
 * EIP-191 signing are identical in both modes, so the on-chain verification is unchanged.
 */
export class TeeSigner {
  private readonly wallet: BaseWallet;
  readonly simulated: boolean;

  constructor(privateKey: string, simulated: boolean) {
    this.wallet = privateKey ? new Wallet(privateKey) : Wallet.createRandom();
    this.simulated = simulated;
  }

  get address(): string {
    return this.wallet.address;
  }

  /**
   * Recompute the exact digest that `SolvencyVerifier.claimDigest` produces on-chain. The ABI type
   * list must match the Solidity `abi.encode` argument list one-for-one.
   */
  digest(p: ClaimDigestParams): string {
    return keccak256(
      abi.encode(
        ["string", "uint256", "address", "address", "bytes32", "bytes32", "bool", "uint64", "uint256"],
        [DOMAIN, p.chainId, p.verifier, p.subject, p.inputHash, p.reservesCommitment, p.solvent, p.timestamp, p.nonce]
      )
    );
  }

  /** EIP-191 personal-sign over the 32-byte digest (matches OZ MessageHashUtils.toEthSignedMessageHash). */
  async sign(digest: string): Promise<string> {
    return this.wallet.signMessage(getBytes(digest));
  }
}
