// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/**
 * @title ISolvencyRegistry
 * @notice On-chain record of private solvency attestations. Stores only a commitment to the
 *         issuer's inputs (`inputHash`) and the asserted result — never the raw financial figures.
 */
interface ISolvencyRegistry {
    /**
     * @dev A single recorded solvency attestation.
     * @param subject            Entity whose solvency is asserted (e.g. an FXRP agent vault/management address).
     * @param attestor           Staked address that submitted (and is economically accountable for) the assertion.
     * @param inputHash          Commitment to the private inputs: keccak256(abi.encode(reserves, liabilities, salt)).
     * @param reservesCommitment Commitment binding the assertion to FDC-attested reserves: keccak256(abi.encode(totalReserves, salt)).
     * @param timestamp          Time the assertion was recorded on-chain (block time).
     * @param nonce              Unique per-assertion value; prevents replay of a signed attestation.
     * @param solvent            Asserted result: reserves >= liabilities.
     * @param revoked            Set true if the attestation was later slashed as fraudulent.
     */
    struct SolvencyAttestation {
        address subject;
        address attestor;
        bytes32 inputHash;
        bytes32 reservesCommitment;
        uint64 timestamp;
        uint256 nonce;
        bool solvent;
        bool revoked;
    }

    event SolvencyAsserted(
        bytes32 indexed id,
        address indexed subject,
        address indexed attestor,
        bytes32 inputHash,
        uint64 timestamp
    );
    event AttestationRevoked(bytes32 indexed id, address indexed subject);
    event VerifierUpdated(address indexed verifier);

    /// @notice Record a new attestation. Restricted to the configured verifier contract.
    /// @return id Deterministic id: keccak256(abi.encode(subject, attestor, inputHash, nonce)).
    function recordAttestation(SolvencyAttestation calldata a) external returns (bytes32 id);

    /// @notice Flag an attestation as revoked (called on a proven fraud/slash). Verifier-only.
    function markRevoked(bytes32 id) external;

    function getAttestation(bytes32 id) external view returns (SolvencyAttestation memory);

    /// @notice Id of the most recent attestation for a subject, or bytes32(0) if none.
    function latestForSubject(address subject) external view returns (bytes32);

    function attestationCountForSubject(address subject) external view returns (uint256);
}
