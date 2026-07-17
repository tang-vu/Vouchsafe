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
  "function confidentialReserves(address) view returns (bool)",
  "function setConfidentialReserves(address subject, bool enabled)",
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

// IPayment.Proof tuple (FDC Payment attestation), spelled out inline for the XRPL control proof.
const PAYMENT_PROOF =
  "(bytes32[] merkleProof, (bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp," +
  "(bytes32 transactionId,uint256 inUtxo,uint256 utxo) requestBody," +
  "(uint64 blockNumber,uint64 blockTimestamp,bytes32 sourceAddressHash,bytes32 sourceAddressesRoot," +
  "bytes32 receivingAddressHash,bytes32 intendedReceivingAddressHash,int256 spentAmount,int256 intendedSpentAmount," +
  "int256 receivedAmount,int256 intendedReceivedAmount,bytes32 standardPaymentReference,bool oneToOne,uint8 status) responseBody) data)";

export const XRPL_RESERVE_PROOF_ABI = [
  "function setXrplReserveAddress(address subject, string xrplAddress)",
  "function xrplAddressHash(address) view returns (bytes32)",
  "function xrplAddressOf(address) view returns (string)",
  "function challengeRef(address subject, uint256 nonce) view returns (bytes32)",
  `function proveControl(address subject, uint256 nonce, ${PAYMENT_PROOF} proof)`,
  "function lastProof(address subject) view returns (tuple(bytes32 xrplTxId, uint64 xrplTimestamp, uint64 provenAt, uint256 nonce))",
  "function isFresh(address subject, uint64 maxAge) view returns (bool)",
];

export const REGISTRY_ABI = [
  "function getAttestation(bytes32) view returns (tuple(address subject,address attestor,bytes32 inputHash,bytes32 reservesCommitment,uint64 timestamp,uint256 nonce,bool solvent,bool revoked))",
  "event SolvencyAsserted(bytes32 indexed id, address indexed subject, address indexed attestor, bytes32 inputHash, uint64 timestamp)",
  "event AttestationRevoked(bytes32 indexed id, address indexed subject)",
];
