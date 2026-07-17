// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ISolvencyRegistry} from "./interfaces/ISolvencyRegistry.sol";
import {IAttestorStaking} from "./interfaces/IAttestorStaking.sol";
import {SolvencyVerifierAdmin} from "./SolvencyVerifierAdmin.sol";

/// @dev Shape of the FDC-attested reserves payload in plain mode (the endpoint returns a single
///      reserves total). In confidential mode the payload is a single `bytes32` salted commitment
///      instead; both are one 32-byte ABI word, decoded per the subject's mode.
struct DataTransportObject {
    uint256 reserves;
}

/**
 * @title SolvencyVerifier
 * @notice Records a solvency attestation only when BOTH halves check out:
 *         1. Confidential compute: the assertion was signed inside the registered TEE
 *            (`ecrecover == teeAddress`) over a chain- and verifier-bound EIP-191 digest.
 *         2. Interoperable data: an FDC Web2Json proof, fetched from the reserves source registered for
 *            the subject, whose attested reserves total matches the TEE claim's `reservesCommitment`.
 *         The attestor's stake backs the assertion; independent staked attestors can `endorse` it,
 *         putting their own stake behind the same claim until a per-subject quorum is reached.
 *         A proven fraud slashes the recorder AND every endorser.
 * @dev Liabilities always stay private (only committed via `inputHash`). Reserves privacy is
 *      per-subject: in plain mode the endpoint publishes the raw total (public); in confidential mode
 *      (`confidentialReserves[subject]`) the endpoint publishes a SALTED commitment
 *      `keccak256(abi.encode(totalReserves, reservesSalt))` and the raw figure never appears on-chain
 *      or on the endpoint — the TEE opens both commitments privately and asserts the inequality.
 *      Fraud is proven by revealing the committed reserves/liabilities/salt that open `inputHash` with
 *      `reserves < liabilities` — no FDC proof is needed at challenge time, so reserve drift after
 *      recording cannot shield a fraudulent attestation.
 */
contract SolvencyVerifier is SolvencyVerifierAdmin {
    using MessageHashUtils for bytes32;

    string public constant DOMAIN = "VOUCHSAFE_SOLVENCY_V1";

    /// @notice Cap on endorsers per attestation, bounding the fraud-slash loop's gas.
    uint256 public constant MAX_ENDORSERS = 32;

    struct SolvencyClaim {
        address subject;
        bytes32 inputHash; // keccak256(abi.encode(totalReserves, totalLiabilities, salt))
        bytes32 reservesCommitment; // keccak256(abi.encode(totalReserves))
        bool solvent;
        uint64 timestamp;
        uint256 nonce;
    }

    mapping(bytes32 => address[]) private _endorsers;
    mapping(bytes32 => mapping(address => bool)) public hasEndorsed;

    event SolvencyRecorded(bytes32 indexed id, address indexed subject, address indexed attestor, uint64 timestamp);
    event AttestationEndorsed(bytes32 indexed id, address indexed endorser, uint256 endorsements);
    event FraudProven(bytes32 indexed id, address indexed attestor, address indexed challenger, uint256 slashed);
    event EndorserSlashed(bytes32 indexed id, address indexed endorser, uint256 slashed);

    constructor(
        ISolvencyRegistry _registry,
        IAttestorStaking _staking,
        uint64 _challengeWindow,
        uint256 _slashPenalty
    ) SolvencyVerifierAdmin(_registry, _staking, _challengeWindow, _slashPenalty) {}

    // --- signature scheme ---

    function claimDigest(SolvencyClaim calldata claim) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN,
                    block.chainid,
                    address(this),
                    claim.subject,
                    claim.inputHash,
                    claim.reservesCommitment,
                    claim.solvent,
                    claim.timestamp,
                    claim.nonce
                )
            );
    }

    function recoverSigner(SolvencyClaim calldata claim, bytes calldata signature) public view returns (address) {
        return ECDSA.recover(claimDigest(claim).toEthSignedMessageHash(), signature);
    }

    // --- FDC proof ---

    /// @dev Verify an FDC proof, require it came from the subject's approved source, and return the
    ///      reserves commitment it binds to: `keccak256(abi.encode(reserves))` over the attested raw
    ///      total in plain mode, or the endpoint's attested salted commitment in confidential mode
    ///      (the raw reserves figure never touches the chain).
    function _attestedReservesCommitment(
        IWeb2Json.Proof calldata fdcProof,
        address subject
    ) internal view returns (bytes32) {
        require(fdcVerifier().verifyWeb2Json(fdcProof), "SolvencyVerifier: bad FDC proof");
        bytes32 srcHash = reservesSourceHash[subject];
        require(srcHash != bytes32(0), "SolvencyVerifier: source not set");
        require(
            keccak256(bytes(fdcProof.data.requestBody.url)) == srcHash,
            "SolvencyVerifier: source mismatch"
        );
        if (confidentialReserves[subject]) {
            return abi.decode(fdcProof.data.responseBody.abiEncodedData, (bytes32));
        }
        DataTransportObject memory dto = abi.decode(fdcProof.data.responseBody.abiEncodedData, (DataTransportObject));
        return keccak256(abi.encode(dto.reserves));
    }

    // --- core ---

    /**
     * @notice Record a solvency attestation. Requires a valid TEE signature AND a valid FDC reserves
     *         proof (from the subject's approved source) whose attested reserves match the claim's
     *         `reservesCommitment`. The asserted timestamp must be recent. The caller must hold the
     *         effective stake for the subject (global floor or stricter per-subject policy).
     */
    function recordSolvency(
        SolvencyClaim calldata claim,
        bytes calldata teeSignature,
        IWeb2Json.Proof calldata fdcProof
    ) external returns (bytes32 id) {
        require(teeAddress != address(0), "SolvencyVerifier: tee not set");
        require(staking.stakeOf(msg.sender) >= requiredStakeFor(claim.subject), "SolvencyVerifier: insufficient stake");
        require(!usedNonce[claim.nonce], "SolvencyVerifier: nonce used");
        require(claim.solvent, "SolvencyVerifier: not solvent");
        require(
            claim.timestamp <= block.timestamp + TIMESTAMP_FUTURE_SKEW &&
                claim.timestamp + maxTimestampAge >= block.timestamp,
            "SolvencyVerifier: stale timestamp"
        );
        require(recoverSigner(claim, teeSignature) == teeAddress, "SolvencyVerifier: bad TEE signature");

        require(
            _attestedReservesCommitment(fdcProof, claim.subject) == claim.reservesCommitment,
            "SolvencyVerifier: reserves mismatch"
        );

        usedNonce[claim.nonce] = true;

        id = registry.recordAttestation(
            ISolvencyRegistry.SolvencyAttestation({
                subject: claim.subject,
                attestor: msg.sender,
                inputHash: claim.inputHash,
                reservesCommitment: claim.reservesCommitment,
                timestamp: claim.timestamp,
                nonce: claim.nonce,
                solvent: claim.solvent,
                revoked: false
            })
        );

        staking.lockUntil(msg.sender, uint64(block.timestamp) + challengeWindow);

        emit SolvencyRecorded(id, claim.subject, msg.sender, claim.timestamp);
    }

    // --- quorum endorsements ---

    /**
     * @notice Put your own stake behind an already-recorded attestation. An endorser is slashed
     *         alongside the recording attestor if the attestation is later proven fraudulent, so an
     *         endorsement is only rational after independently re-running the confidential check.
     * @dev The endorser's stake is locked for a fresh challenge window from now (conservative: an
     *      endorsement close to the window's end still leaves the endorser slashable for a full window).
     */
    function endorse(bytes32 id) external {
        ISolvencyRegistry.SolvencyAttestation memory att = registry.getAttestation(id); // reverts on unknown id
        require(!att.revoked, "SolvencyVerifier: revoked");
        require(msg.sender != att.attestor, "SolvencyVerifier: self endorse");
        require(!hasEndorsed[id][msg.sender], "SolvencyVerifier: already endorsed");
        require(_endorsers[id].length < MAX_ENDORSERS, "SolvencyVerifier: endorser cap");
        require(staking.stakeOf(msg.sender) >= requiredStakeFor(att.subject), "SolvencyVerifier: insufficient stake");

        hasEndorsed[id][msg.sender] = true;
        _endorsers[id].push(msg.sender);
        staking.lockUntil(msg.sender, uint64(block.timestamp) + challengeWindow);

        emit AttestationEndorsed(id, msg.sender, _endorsers[id].length);
    }

    function endorsementCount(bytes32 id) external view returns (uint256) {
        return _endorsers[id].length;
    }

    function endorsersOf(bytes32 id) external view returns (address[] memory) {
        return _endorsers[id];
    }

    /// @notice True when the attestation is live and has reached the subject's endorsement quorum.
    function isQuorate(bytes32 id) external view returns (bool) {
        ISolvencyRegistry.SolvencyAttestation memory att = registry.getAttestation(id);
        return !att.revoked && _endorsers[id].length >= subjectPolicy[att.subject].requiredEndorsements;
    }

    // --- fraud ---

    /**
     * @notice Prove a recorded attestation was fraudulent; slash its attestor and every endorser.
     *         Permissionless.
     * @dev The challenger reveals the exact committed `reserves`, `liabilities`, and `salt`. If they open
     *      the recorded `inputHash` and `reserves < liabilities`, the "solvent" assertion was false. No FDC
     *      proof is used here: `inputHash` already fixes the reserves that were asserted, so post-recording
     *      reserve drift cannot shield a fraud. The revocation is applied even if there is nothing to slash.
     *      Revocation happens before any payout, so a re-entering challenger hits "already revoked".
     */
    function raiseFraud(bytes32 id, uint256 reserves, uint256 liabilities, bytes32 salt) external {
        ISolvencyRegistry.SolvencyAttestation memory att = registry.getAttestation(id);
        require(!att.revoked, "SolvencyVerifier: already revoked");
        require(
            keccak256(abi.encode(reserves, liabilities, salt)) == att.inputHash,
            "SolvencyVerifier: reveal mismatch"
        );
        require(reserves < liabilities, "SolvencyVerifier: not insolvent");

        registry.markRevoked(id);

        uint256 penalty = slashPenaltyFor(att.subject);
        uint256 slashed = staking.slash(att.attestor, penalty, msg.sender);

        // Every endorser vouched for the same false claim with their own stake — slash them too.
        address[] storage endorsers = _endorsers[id];
        for (uint256 i = 0; i < endorsers.length; i++) {
            uint256 endorserSlashed = staking.slash(endorsers[i], penalty, msg.sender);
            emit EndorserSlashed(id, endorsers[i], endorserSlashed);
        }

        emit FraudProven(id, att.attestor, msg.sender, slashed);
    }
}
