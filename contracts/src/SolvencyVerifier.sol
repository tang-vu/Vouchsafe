// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {ISolvencyRegistry} from "./interfaces/ISolvencyRegistry.sol";
import {IAttestorStaking} from "./interfaces/IAttestorStaking.sol";
import {IWeb2JsonVerifier} from "./interfaces/IWeb2JsonVerifier.sol";

/// @dev Shape of the FDC-attested reserves payload (the endpoint returns a single reserves total).
struct DataTransportObject {
    uint256 reserves;
}

/**
 * @title SolvencyVerifier
 * @notice Records a solvency attestation only when BOTH halves check out:
 *         1. Confidential compute: the assertion was signed inside the registered TEE
 *            (`ecrecover == teeAddress`), mirroring the Flare FCC settlement pattern.
 *         2. Interoperable data: an FDC Web2Json proof attests the off-chain reserves, and that
 *            attested figure is bound to the TEE claim via `reservesCommitment`.
 *         The attestor's stake backs the assertion and is slashed by an evidence-based fraud challenge.
 * @dev Raw reserves/liabilities never appear on-chain; only commitments and the boolean result do.
 *      The FDC verifier is resolved via `ContractRegistry.getFdcVerification()` in production, with an
 *      owner-settable override so unit tests can inject a mock.
 */
contract SolvencyVerifier is Ownable {
    using MessageHashUtils for bytes32;

    string public constant DOMAIN = "VOUCHSAFE_SOLVENCY_V1";

    struct SolvencyClaim {
        address subject;
        bytes32 inputHash; // keccak256(abi.encode(totalReserves, totalLiabilities, salt))
        bytes32 reservesCommitment; // keccak256(abi.encode(totalReserves))
        bool solvent;
        uint64 timestamp;
        uint256 nonce;
    }

    ISolvencyRegistry public immutable registry;
    IAttestorStaking public immutable staking;

    address public teeAddress;
    uint64 public challengeWindow;
    uint256 public slashPenalty;

    /// @notice Test-only override for the FDC verifier. Zero => resolve via ContractRegistry.
    address public fdcVerifierOverride;

    mapping(uint256 => bool) public usedNonce;

    event TeeAddressUpdated(address indexed teeAddress);
    event FdcVerifierOverrideUpdated(address indexed verifier);
    event SolvencyRecorded(bytes32 indexed id, address indexed subject, address indexed attestor, uint64 timestamp);
    event FraudProven(bytes32 indexed id, address indexed attestor, address indexed challenger, uint256 slashed);

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

    function setFdcVerifierOverride(address _override) external onlyOwner {
        fdcVerifierOverride = _override;
        emit FdcVerifierOverrideUpdated(_override);
    }

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

    // --- FDC verifier resolution ---

    function fdcVerifier() public view returns (IWeb2JsonVerifier) {
        if (fdcVerifierOverride != address(0)) return IWeb2JsonVerifier(fdcVerifierOverride);
        return IWeb2JsonVerifier(address(ContractRegistry.getFdcVerification()));
    }

    function _attestedReserves(IWeb2Json.Proof calldata fdcProof) internal view returns (uint256) {
        require(fdcVerifier().verifyWeb2Json(fdcProof), "SolvencyVerifier: bad FDC proof");
        DataTransportObject memory dto = abi.decode(fdcProof.data.responseBody.abiEncodedData, (DataTransportObject));
        return dto.reserves;
    }

    // --- core ---

    /**
     * @notice Record a solvency attestation. Requires a valid TEE signature AND a valid FDC reserves
     *         proof whose attested reserves total matches the claim's `reservesCommitment`.
     */
    function recordSolvency(
        SolvencyClaim calldata claim,
        bytes calldata teeSignature,
        IWeb2Json.Proof calldata fdcProof
    ) external returns (bytes32 id) {
        require(teeAddress != address(0), "SolvencyVerifier: tee not set");
        require(staking.stakeOf(msg.sender) >= staking.minStake(), "SolvencyVerifier: insufficient stake");
        require(!usedNonce[claim.nonce], "SolvencyVerifier: nonce used");
        require(claim.solvent, "SolvencyVerifier: not solvent");
        require(recoverSigner(claim, teeSignature) == teeAddress, "SolvencyVerifier: bad TEE signature");

        uint256 reserves = _attestedReserves(fdcProof);
        require(keccak256(abi.encode(reserves)) == claim.reservesCommitment, "SolvencyVerifier: reserves mismatch");

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

    /**
     * @notice Prove a recorded attestation was fraudulent and slash its attestor. Permissionless.
     * @dev The challenger reveals the committed `liabilities` + `salt` and supplies an FDC proof of the
     *      actual reserves. If the reveal opens the recorded `inputHash` (proving these are the exact
     *      committed figures) and the attested reserves are below the committed liabilities, then the
     *      "solvent" assertion was false. The slashed stake is paid to the challenger.
     */
    function raiseFraud(
        bytes32 id,
        uint256 liabilities,
        bytes32 salt,
        IWeb2Json.Proof calldata fdcProof
    ) external {
        ISolvencyRegistry.SolvencyAttestation memory att = registry.getAttestation(id);
        require(!att.revoked, "SolvencyVerifier: already revoked");

        uint256 reserves = _attestedReserves(fdcProof);
        require(
            keccak256(abi.encode(reserves, liabilities, salt)) == att.inputHash,
            "SolvencyVerifier: reveal mismatch"
        );
        require(reserves < liabilities, "SolvencyVerifier: not insolvent");

        registry.markRevoked(id);
        staking.slash(att.attestor, slashPenalty, msg.sender);

        emit FraudProven(id, att.attestor, msg.sender, slashPenalty);
    }
}
