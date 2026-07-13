/**
 * Request accepted by the extension. `reserves` and `liabilities` are the PRIVATE inputs — they are
 * consumed inside the enclave to compute the result and are never echoed back or logged.
 */
export interface ProveSolvencyRequest {
  subject: string; // 0x address the assertion is about (e.g. an FXRP agent)
  reserves: string[]; // integer strings (private)
  liabilities: string[]; // integer strings (private)
  salt: string; // 0x bytes32 — blinds the input commitment
  nonce: string | number; // unique per assertion (uint256)
  timestamp?: number; // assertion time T (seconds); defaults to now
  chainId: number; // domain binding
  verifier: string; // SolvencyVerifier address — domain binding
}

/**
 * The signed attestation returned by the extension. Contains only commitments + the boolean result;
 * the raw reserves/liabilities are intentionally absent.
 */
export interface SolvencyAttestationResult {
  subject: string;
  inputHash: string; // bytes32: keccak256(abi.encode(totalReserves, totalLiabilities, salt))
  reservesCommitment: string; // bytes32: keccak256(abi.encode(totalReserves))
  solvent: boolean;
  timestamp: number;
  nonce: string;
  chainId: number;
  verifier: string;
  signature: string; // EIP-191 signature over the verifier's claimDigest
  teeAddress: string; // expected on-chain signer
  domain: string;
  simulated: boolean;
}

/** FCC-style instruction envelope: routes on (opType, opCommand). */
export interface ActionEnvelope {
  opType: string;
  opCommand: string;
  message: ProveSolvencyRequest;
}
