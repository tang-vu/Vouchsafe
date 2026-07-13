// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISolvencyRegistry} from "./interfaces/ISolvencyRegistry.sol";

/**
 * @title SolvencyRegistry
 * @notice Append-only store of solvency attestations, indexed by subject. Holds only commitments to
 *         the private inputs and the asserted result — a third party can verify "solvent at time T"
 *         without ever seeing the underlying numbers.
 * @dev Writes are restricted to the verifier contract, which is the only component that checks the
 *      TEE signature, the FDC proof, and the attestor's stake before recording.
 */
contract SolvencyRegistry is Ownable, ISolvencyRegistry {
    /// @notice Contract allowed to record and revoke attestations.
    address public verifier;

    mapping(bytes32 => SolvencyAttestation) private _attestations;
    mapping(bytes32 => bool) private _exists;
    mapping(address => bytes32[]) private _bySubject;

    uint256 public totalAttestations;

    modifier onlyVerifier() {
        require(msg.sender == verifier, "SolvencyRegistry: not verifier");
        _;
    }

    constructor() Ownable(msg.sender) {}

    /// @notice Set the verifier contract permitted to write. Owner-only.
    function setVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "SolvencyRegistry: zero verifier");
        verifier = _verifier;
        emit VerifierUpdated(_verifier);
    }

    /// @inheritdoc ISolvencyRegistry
    function recordAttestation(SolvencyAttestation calldata a)
        external
        onlyVerifier
        returns (bytes32 id)
    {
        // Deterministic, off-chain-predictable id. Excludes `timestamp` so the id can be computed
        // before submission; uniqueness comes from the globally-unique nonce plus the binding fields.
        id = keccak256(abi.encode(a.subject, a.attestor, a.inputHash, a.nonce));
        require(!_exists[id], "SolvencyRegistry: duplicate");

        _attestations[id] = a;
        _exists[id] = true;
        _bySubject[a.subject].push(id);
        totalAttestations += 1;

        emit SolvencyAsserted(id, a.subject, a.attestor, a.inputHash, a.timestamp);
    }

    /// @inheritdoc ISolvencyRegistry
    function markRevoked(bytes32 id) external onlyVerifier {
        require(_exists[id], "SolvencyRegistry: unknown id");
        SolvencyAttestation storage a = _attestations[id];
        a.revoked = true;
        emit AttestationRevoked(id, a.subject);
    }

    /// @inheritdoc ISolvencyRegistry
    function getAttestation(bytes32 id) external view returns (SolvencyAttestation memory) {
        require(_exists[id], "SolvencyRegistry: unknown id");
        return _attestations[id];
    }

    /// @inheritdoc ISolvencyRegistry
    function latestForSubject(address subject) external view returns (bytes32) {
        bytes32[] storage ids = _bySubject[subject];
        if (ids.length == 0) return bytes32(0);
        return ids[ids.length - 1];
    }

    /// @inheritdoc ISolvencyRegistry
    function attestationCountForSubject(address subject) external view returns (uint256) {
        return _bySubject[subject].length;
    }

    function exists(bytes32 id) external view returns (bool) {
        return _exists[id];
    }
}
