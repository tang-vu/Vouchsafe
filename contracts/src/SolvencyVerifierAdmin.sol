// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {ISolvencyRegistry} from "./interfaces/ISolvencyRegistry.sol";
import {IAttestorStaking} from "./interfaces/IAttestorStaking.sol";
import {IWeb2JsonVerifier} from "./interfaces/IWeb2JsonVerifier.sol";

/**
 * @title SolvencyVerifierAdmin
 * @notice Storage, owner-gated configuration, and FDC-verifier resolution for the SolvencyVerifier.
 *         Global parameters (challenge window, slash penalty, stake floor) can be overridden per
 *         subject via `SubjectPolicy` — an issuer with more at stake can demand a higher bond,
 *         a harsher penalty, and a multi-attestor quorum before its attestations count as final.
 */
abstract contract SolvencyVerifierAdmin is Ownable {
    /// @dev Per-subject overrides; a zero field falls back to the global parameter.
    struct SubjectPolicy {
        uint256 minStake; // stake floor to record/endorse for this subject (0 = global minStake only)
        uint256 slashPenalty; // penalty per slashed party on proven fraud (0 = global slashPenalty)
        uint32 requiredEndorsements; // independent co-endorsements needed for quorum (0 = none)
    }

    ISolvencyRegistry public immutable registry;
    IAttestorStaking public immutable staking;

    address public teeAddress;
    uint64 public challengeWindow;
    uint256 public slashPenalty;

    /// @notice Max age (seconds) of a claim's asserted timestamp relative to block time; also bounds
    ///         future skew to `TIMESTAMP_FUTURE_SKEW`.
    uint64 public maxTimestampAge;
    uint64 public constant TIMESTAMP_FUTURE_SKEW = 300;

    /// @notice keccak256 of the approved reserves-source URL for each subject. Binds an FDC proof to a
    ///         source the owner vetted, so an attestor cannot fabricate reserves from their own endpoint.
    mapping(address => bytes32) public reservesSourceHash;

    /// @notice Per-subject stake / penalty / quorum overrides.
    mapping(address => SubjectPolicy) public subjectPolicy;

    /// @notice Test-only override for the FDC verifier, once-lockable to prevent a production bypass.
    address public fdcVerifierOverride;
    bool public fdcOverrideLocked;

    mapping(uint256 => bool) public usedNonce;

    event TeeAddressUpdated(address indexed teeAddress);
    event FdcVerifierOverrideUpdated(address indexed verifier);
    event FdcOverrideLocked();
    event ReservesSourceSet(address indexed subject, bytes32 urlHash);
    event SubjectPolicySet(
        address indexed subject,
        uint256 minStake,
        uint256 slashPenalty,
        uint32 requiredEndorsements
    );

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
        maxTimestampAge = 3600;
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

    function setMaxTimestampAge(uint64 _age) external onlyOwner {
        maxTimestampAge = _age;
    }

    /// @notice Register the approved reserves-source URL for a subject (its hash is stored).
    function setReservesSource(address subject, string calldata url) external onlyOwner {
        bytes32 h = keccak256(bytes(url));
        reservesSourceHash[subject] = h;
        emit ReservesSourceSet(subject, h);
    }

    /// @notice Set (or clear, with zeros) the stake / penalty / quorum policy for a subject.
    function setSubjectPolicy(
        address subject,
        uint256 _minStake,
        uint256 _slashPenalty,
        uint32 _requiredEndorsements
    ) external onlyOwner {
        subjectPolicy[subject] = SubjectPolicy({
            minStake: _minStake,
            slashPenalty: _slashPenalty,
            requiredEndorsements: _requiredEndorsements
        });
        emit SubjectPolicySet(subject, _minStake, _slashPenalty, _requiredEndorsements);
    }

    function setFdcVerifierOverride(address _override) external onlyOwner {
        require(!fdcOverrideLocked, "SolvencyVerifier: override locked");
        fdcVerifierOverride = _override;
        emit FdcVerifierOverrideUpdated(_override);
    }

    /// @notice Permanently disable the FDC verifier override (one-way), forcing registry resolution.
    function lockFdcVerifierOverride() external onlyOwner {
        fdcOverrideLocked = true;
        emit FdcOverrideLocked();
    }

    // --- effective parameters ---

    /// @notice Stake an attestor/endorser must hold to act for `subject`: the stricter of the
    ///         global `minStake` and the subject's policy floor.
    function requiredStakeFor(address subject) public view returns (uint256) {
        uint256 globalMin = staking.minStake();
        uint256 policyMin = subjectPolicy[subject].minStake;
        return policyMin > globalMin ? policyMin : globalMin;
    }

    /// @notice Penalty applied to each slashed party on a proven fraud against `subject`.
    function slashPenaltyFor(address subject) public view returns (uint256) {
        uint256 policyPenalty = subjectPolicy[subject].slashPenalty;
        return policyPenalty == 0 ? slashPenalty : policyPenalty;
    }

    // --- FDC verifier resolution ---

    function fdcVerifier() public view returns (IWeb2JsonVerifier) {
        if (fdcVerifierOverride != address(0)) return IWeb2JsonVerifier(fdcVerifierOverride);
        return IWeb2JsonVerifier(address(ContractRegistry.getFdcVerification()));
    }
}
