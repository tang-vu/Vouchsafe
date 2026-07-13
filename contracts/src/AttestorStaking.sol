// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAttestorStaking} from "./interfaces/IAttestorStaking.sol";

/**
 * @title AttestorStaking
 * @notice Holds attestor stake in native C2FLR. An attestor must hold at least `minStake` to make a
 *         solvency assertion; the verifier locks the stake for the assertion's challenge window and
 *         slashes it if the assertion is later proven fraudulent.
 * @dev Native-value transfers are made only in `withdraw` and `slash`, both `nonReentrant`, and both
 *      following checks-effects-interactions.
 */
contract AttestorStaking is Ownable, ReentrancyGuard, IAttestorStaking {
    struct StakeInfo {
        uint256 amount; // active (slashable, lockable) stake
        uint256 pendingWithdrawal; // unbonding funds no longer usable for assertions
        uint64 withdrawableAt; // when pendingWithdrawal can be withdrawn
        uint64 lockedUntil; // active stake cannot begin unbonding before this time
    }

    /// @notice Address permitted to slash and lock stake (the verifier contract).
    address public slasher;

    /// @notice Minimum active stake required to make an assertion.
    uint256 public minStake;

    /// @notice Delay between requesting an unstake and being able to withdraw it.
    uint256 public unbondingPeriod;

    mapping(address => StakeInfo) private _stakes;

    modifier onlySlasher() {
        require(msg.sender == slasher, "AttestorStaking: not slasher");
        _;
    }

    constructor(uint256 _minStake, uint256 _unbondingPeriod) Ownable(msg.sender) {
        minStake = _minStake;
        unbondingPeriod = _unbondingPeriod;
    }

    // --- admin ---

    function setSlasher(address _slasher) external onlyOwner {
        require(_slasher != address(0), "AttestorStaking: zero slasher");
        slasher = _slasher;
        emit SlasherUpdated(_slasher);
    }

    function setMinStake(uint256 _minStake) external onlyOwner {
        minStake = _minStake;
    }

    function setUnbondingPeriod(uint256 _period) external onlyOwner {
        unbondingPeriod = _period;
    }

    // --- staking ---

    /// @inheritdoc IAttestorStaking
    function stake() external payable {
        require(msg.value > 0, "AttestorStaking: zero stake");
        _stakes[msg.sender].amount += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    /// @inheritdoc IAttestorStaking
    function requestUnstake(uint256 amount) external {
        StakeInfo storage s = _stakes[msg.sender];
        require(amount > 0 && amount <= s.amount, "AttestorStaking: bad amount");
        require(block.timestamp >= s.lockedUntil, "AttestorStaking: stake locked");

        s.amount -= amount;
        s.pendingWithdrawal += amount;
        s.withdrawableAt = uint64(block.timestamp + unbondingPeriod);

        emit UnstakeRequested(msg.sender, amount, s.withdrawableAt);
    }

    /// @inheritdoc IAttestorStaking
    function withdraw() external nonReentrant {
        StakeInfo storage s = _stakes[msg.sender];
        uint256 amount = s.pendingWithdrawal;
        require(amount > 0, "AttestorStaking: nothing pending");
        require(block.timestamp >= s.withdrawableAt, "AttestorStaking: still unbonding");

        s.pendingWithdrawal = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "AttestorStaking: transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    // --- slasher-gated ---

    /// @inheritdoc IAttestorStaking
    function slash(address attestor, uint256 amount, address beneficiary)
        external
        onlySlasher
        nonReentrant
    {
        StakeInfo storage s = _stakes[attestor];
        uint256 slashAmount = amount > s.amount ? s.amount : amount;
        require(slashAmount > 0, "AttestorStaking: nothing to slash");

        s.amount -= slashAmount;

        if (beneficiary != address(0)) {
            (bool ok, ) = payable(beneficiary).call{value: slashAmount}("");
            require(ok, "AttestorStaking: payout failed");
        }
        // If beneficiary is the zero address the slashed funds stay in the contract (effectively burned
        // from the attestor's perspective; recoverable only by governance if later added).

        emit Slashed(attestor, slashAmount, beneficiary);
    }

    /// @inheritdoc IAttestorStaking
    function lockUntil(address attestor, uint64 lockedUntil) external onlySlasher {
        StakeInfo storage s = _stakes[attestor];
        if (lockedUntil > s.lockedUntil) {
            s.lockedUntil = lockedUntil;
        }
        emit Locked(attestor, s.lockedUntil);
    }

    // --- views ---

    /// @inheritdoc IAttestorStaking
    function stakeOf(address attestor) external view returns (uint256) {
        return _stakes[attestor].amount;
    }

    /// @inheritdoc IAttestorStaking
    function lockedUntilOf(address attestor) external view returns (uint64) {
        return _stakes[attestor].lockedUntil;
    }

    function stakeInfoOf(address attestor)
        external
        view
        returns (uint256 amount, uint256 pendingWithdrawal, uint64 withdrawableAt, uint64 lockedUntil)
    {
        StakeInfo storage s = _stakes[attestor];
        return (s.amount, s.pendingWithdrawal, s.withdrawableAt, s.lockedUntil);
    }
}
