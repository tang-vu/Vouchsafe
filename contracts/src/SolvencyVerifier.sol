// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISolvencyRegistry} from "./interfaces/ISolvencyRegistry.sol";
import {IAttestorStaking} from "./interfaces/IAttestorStaking.sol";

/**
 * @title SolvencyVerifier
 * @notice Entry point that gates recording a solvency attestation. It enforces the attestor's stake,
 *         records the attestation into the registry, and locks the stake for a challenge window.
 * @dev This is the skeleton: `recordSolvency` accepts a stubbed claim and does not yet verify the TEE
 *      signature or the FDC reserve proof. Those checks (ecrecover == teeAddress; verifyJsonApi) and an
 *      evidence-based fraud path are added on top of this same surface without changing the storage layout.
 */
contract SolvencyVerifier is Ownable {
    /// @dev Mirror of ISolvencyRegistry commitment fields plus the asserted result, as signed by the TEE.
    struct SolvencyClaim {
        address subject;
        bytes32 inputHash;
        bytes32 reservesCommitment;
        bool solvent;
        uint256 nonce;
    }

    ISolvencyRegistry public immutable registry;
    IAttestorStaking public immutable staking;

    /// @notice Registered TEE signer whose signature authenticates a claim (wired up with the extension).
    address public teeAddress;

    /// @notice Seconds an attestor's stake stays locked after an assertion, allowing a fraud challenge.
    uint64 public challengeWindow;

    /// @notice Default amount slashed on a proven fraud.
    uint256 public slashPenalty;

    /// @notice Consumed nonces, preventing replay of a signed attestation.
    mapping(uint256 => bool) public usedNonce;

    event TeeAddressUpdated(address indexed teeAddress);
    event SolvencyRecorded(bytes32 indexed id, address indexed subject, address indexed attestor);
    event FraudProven(bytes32 indexed id, address indexed attestor, uint256 slashed);

    constructor(
        ISolvencyRegistry _registry,
        IAttestorStaking _staking,
        uint64 _challengeWindow,
        uint256 _slashPenalty
    ) Ownable(msg.sender) {
        registry = _registry;
        staking = _staking;
        challengeWindow = _challengeWindow;
        slashPenalty = _slashPenalty;
    }

    // --- admin ---

    function setTeeAddress(address _teeAddress) external onlyOwner {
        teeAddress = _teeAddress;
        emit TeeAddressUpdated(_teeAddress);
    }

    function setChallengeWindow(uint64 _window) external onlyOwner {
        challengeWindow = _window;
    }

    function setSlashPenalty(uint256 _penalty) external onlyOwner {
        slashPenalty = _penalty;
    }

    // --- core ---

    /**
     * @notice Record a solvency attestation for `msg.sender` as the accountable attestor.
     * @dev Skeleton verification: stake gate + nonce + result check. The TEE-signature and FDC-proof
     *      checks are layered on this method's inputs subsequently.
     */
    function recordSolvency(SolvencyClaim calldata claim) external returns (bytes32 id) {
        require(staking.stakeOf(msg.sender) >= staking.minStake(), "SolvencyVerifier: insufficient stake");
        require(!usedNonce[claim.nonce], "SolvencyVerifier: nonce used");
        require(claim.solvent, "SolvencyVerifier: not solvent");

        usedNonce[claim.nonce] = true;

        id = registry.recordAttestation(
            ISolvencyRegistry.SolvencyAttestation({
                subject: claim.subject,
                attestor: msg.sender,
                inputHash: claim.inputHash,
                reservesCommitment: claim.reservesCommitment,
                timestamp: uint64(block.timestamp),
                nonce: claim.nonce,
                solvent: claim.solvent,
                revoked: false
            })
        );

        staking.lockUntil(msg.sender, uint64(block.timestamp) + challengeWindow);

        emit SolvencyRecorded(id, claim.subject, msg.sender);
    }

    /**
     * @notice Placeholder fraud path: revoke an attestation and slash its attestor.
     * @dev Owner-gated for now; superseded by an evidence-based challenge (commitment reveal + FDC
     *      counter-proof of insolvency) that anyone can call. Kept here so the slash wiring is exercised
     *      end-to-end from the verifier.
     */
    function adminProveFraud(bytes32 id, address attestor, address beneficiary) external onlyOwner {
        registry.markRevoked(id);
        staking.slash(attestor, slashPenalty, beneficiary);
        emit FraudProven(id, attestor, slashPenalty);
    }
}
