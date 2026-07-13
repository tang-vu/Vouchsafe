// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/**
 * @title ITeeExtensionRegistry
 * @notice Minimal interface for the Flare Confidential Compute `TeeExtensionRegistry` — the single
 *         on-chain entry point for submitting instructions to a registered TEE extension. Mirrors the
 *         surface shipped by the fce-extension-scaffold (slated to move into flare-smart-contracts-v2).
 * @dev On Coston2 this contract is not yet published in the FlareContractRegistry, so its address is
 *      injected explicitly rather than resolved by name.
 */
interface ITeeExtensionRegistry {
    struct TeeInstructionParams {
        bytes32 opType;
        bytes32 opCommand;
        bytes message;
        address[] cosigners;
        uint64 cosignersThreshold;
        address claimBackAddress;
    }

    /// @notice The only path to submit instructions; the registry rejects any caller that is not the
    ///         extension's registered InstructionSender address.
    function sendInstructions(address[] calldata teeIds, TeeInstructionParams calldata params)
        external
        payable
        returns (bytes32 instructionId);

    function extensionsCounter() external view returns (uint256);

    function getTeeExtensionInstructionsSender(uint256 extensionId) external view returns (address);
}
