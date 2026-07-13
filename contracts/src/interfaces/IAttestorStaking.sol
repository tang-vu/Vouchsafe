// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/**
 * @title IAttestorStaking
 * @notice Economic accountability layer: attestors post a stake to make solvency assertions and
 *         lose it if an assertion is later proven fraudulent. Stake is time-locked while an
 *         assertion is within its challenge window, so an attestor cannot exit ahead of a slash.
 */
interface IAttestorStaking {
    event Staked(address indexed attestor, uint256 amount);
    event UnstakeRequested(address indexed attestor, uint256 amount, uint64 withdrawableAt);
    event Withdrawn(address indexed attestor, uint256 amount);
    event Slashed(address indexed attestor, uint256 amount, address indexed beneficiary);
    event Locked(address indexed attestor, uint64 lockedUntil);
    event SlasherUpdated(address indexed slasher);

    function stake() external payable;

    /// @notice Begin unbonding `amount`; funds become withdrawable after the unbonding period.
    ///         Reverts while the attestor's stake is locked by an open challenge window.
    function requestUnstake(uint256 amount) external;

    /// @notice Withdraw fully-unbonded funds.
    function withdraw() external;

    /// @notice Slash up to `amount` from `attestor` (active stake first, then unbonding funds), optionally
    ///         paying a beneficiary. Never reverts on a zero balance. Restricted to the slasher (verifier).
    /// @return slashed The amount actually slashed.
    function slash(address attestor, uint256 amount, address beneficiary) external returns (uint256 slashed);

    /// @notice Extend the stake lock for `attestor` to at least `lockedUntil`. Slasher-only.
    function lockUntil(address attestor, uint64 lockedUntil) external;

    function stakeOf(address attestor) external view returns (uint256);
    function lockedUntilOf(address attestor) external view returns (uint64);
    function minStake() external view returns (uint256);
}
