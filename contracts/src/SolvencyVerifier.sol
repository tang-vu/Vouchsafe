// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ISolvencyRegistry} from "./interfaces/ISolvencyRegistry.sol";
import {IAttestorStaking} from "./interfaces/IAttestorStaking.sol";

/**
 * @title SolvencyVerifier
 * @notice Gates recording a solvency attestation. It verifies that the assertion was produced and
 *         signed inside the registered TEE (the confidential-compute half), enforces the attestor's
 *         stake, records the attestation, and locks the stake for a challenge window.
 * @dev The TEE signs a domain-separated digest of the claim with its enclave key; this contract
 *      recovers the signer and requires it to equal `teeAddress`. This mirrors the Flare Confidential
 *      Compute settlement pattern (recover the TEE signer and require it equals the registered TEE
 *      address) used by fce-weather-insurance, adapted with an EIP-191 domain-separated digest so the
 *      signature is bound to this chain and this verifier. The FDC reserve-proof requirement is layered
 *      on this same surface subsequently.
 */
contract SolvencyVerifier is Ownable {
    using MessageHashUtils for bytes32;

    /// @dev Domain tag binding a signature to the Vouchsafe solvency-attestation scheme + version.
    string public constant DOMAIN = "VOUCHSAFE_SOLVENCY_V1";

    /// @dev The claim signed by the TEE and recorded on-chain. Raw figures never appear here — only
    ///      the commitments produced inside the enclave.
    struct SolvencyClaim {
        address subject;
        bytes32 inputHash; // keccak256(abi.encode(reserves, liabilities, salt))
        bytes32 reservesCommitment; // keccak256(abi.encode(totalReserves, salt))
        bool solvent; // reserves >= liabilities
        uint64 timestamp; // assertion time T, as evaluated inside the enclave
        uint256 nonce; // unique per assertion; replay guard
    }

    ISolvencyRegistry public immutable registry;
    IAttestorStaking public immutable staking;

    /// @notice Registered TEE signer address whose signature authenticates a claim.
    address public teeAddress;

    /// @notice Seconds an attestor's stake stays locked after an assertion, allowing a fraud challenge.
    uint64 public challengeWindow;

    /// @notice Default amount slashed on a proven fraud.
    uint256 public slashPenalty;

    /// @notice Consumed nonces, preventing replay of a signed attestation.
    mapping(uint256 => bool) public usedNonce;

    event TeeAddressUpdated(address indexed teeAddress);
    event SolvencyRecorded(bytes32 indexed id, address indexed subject, address indexed attestor, uint64 timestamp);
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

    // --- signature scheme ---

    /// @notice The domain-separated digest the TEE signs (pre EIP-191 prefix). Exposed for off-chain
    ///         signers and frontends so both sides derive the identical message.
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

    /// @notice Recover the signer of a claim under the EIP-191 personal-sign scheme.
    function recoverSigner(SolvencyClaim calldata claim, bytes calldata signature) public view returns (address) {
        bytes32 ethSigned = claimDigest(claim).toEthSignedMessageHash();
        return ECDSA.recover(ethSigned, signature);
    }

    // --- core ---

    /**
     * @notice Record a solvency attestation for `msg.sender` (the accountable attestor).
     * @param claim        The solvency claim, as computed and signed inside the TEE.
     * @param teeSignature The enclave signature over `claimDigest(claim)` (EIP-191).
     */
    function recordSolvency(SolvencyClaim calldata claim, bytes calldata teeSignature) external returns (bytes32 id) {
        require(teeAddress != address(0), "SolvencyVerifier: tee not set");
        require(staking.stakeOf(msg.sender) >= staking.minStake(), "SolvencyVerifier: insufficient stake");
        require(!usedNonce[claim.nonce], "SolvencyVerifier: nonce used");
        require(claim.solvent, "SolvencyVerifier: not solvent");
        require(recoverSigner(claim, teeSignature) == teeAddress, "SolvencyVerifier: bad TEE signature");

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
