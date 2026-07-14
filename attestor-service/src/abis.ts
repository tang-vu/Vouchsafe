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
  "function reservesSourceHash(address) view returns (bytes32)",
  "function setReservesSource(address subject, string url)",
  `function recordSolvency(${CLAIM} claim, bytes teeSignature, ${FDC_PROOF} fdcProof) returns (bytes32)`,
  "function raiseFraud(bytes32 id, uint256 reserves, uint256 liabilities, bytes32 salt)",
  // quorum + per-subject policy
  "function endorse(bytes32 id)",
  "function endorsementCount(bytes32 id) view returns (uint256)",
  "function endorsersOf(bytes32 id) view returns (address[])",
  "function isQuorate(bytes32 id) view returns (bool)",
  "function requiredStakeFor(address subject) view returns (uint256)",
  "function slashPenaltyFor(address subject) view returns (uint256)",
  "function subjectPolicy(address subject) view returns (uint256 minStake, uint256 slashPenalty, uint32 requiredEndorsements)",
  "function setSubjectPolicy(address subject, uint256 minStake, uint256 slashPenalty, uint32 requiredEndorsements)",
];

export const STAKING_ABI = [
  "function stake() payable",
  "function stakeOf(address) view returns (uint256)",
  "function minStake() view returns (uint256)",
];

export const REGISTRY_ABI = [
  "function getAttestation(bytes32) view returns (tuple(address subject,address attestor,bytes32 inputHash,bytes32 reservesCommitment,uint64 timestamp,uint256 nonce,bool solvent,bool revoked))",
  "event SolvencyAsserted(bytes32 indexed id, address indexed subject, address indexed attestor, bytes32 inputHash, uint64 timestamp)",
  "event AttestationRevoked(bytes32 indexed id, address indexed subject)",
];
