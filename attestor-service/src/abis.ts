// Human-readable ABIs for the Vouchsafe contracts. The IWeb2Json.Proof tuple is spelled out inline.
const FDC_PROOF =
  "(bytes32[] merkleProof, (bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp," +
  "(string url,string httpMethod,string headers,string queryParams,string body,string postProcessJq,string abiSignature) requestBody," +
  "(bytes abiEncodedData) responseBody) data)";

const CLAIM =
  "(address subject,bytes32 inputHash,bytes32 reservesCommitment,bool solvent,uint64 timestamp,uint256 nonce)";

export const VERIFIER_ABI = [
  "function teeAddress() view returns (address)",
  "function setTeeAddress(address)",
  `function recordSolvency(${CLAIM} claim, bytes teeSignature, ${FDC_PROOF} fdcProof) returns (bytes32)`,
  `function raiseFraud(bytes32 id, uint256 liabilities, bytes32 salt, ${FDC_PROOF} fdcProof)`,
];

export const STAKING_ABI = [
  "function stake() payable",
  "function stakeOf(address) view returns (uint256)",
  "function minStake() view returns (uint256)",
];

export const REGISTRY_ABI = [
  "function getAttestation(bytes32) view returns (tuple(address subject,address attestor,bytes32 inputHash,bytes32 reservesCommitment,uint64 timestamp,uint256 nonce,bool solvent,bool revoked))",
];
