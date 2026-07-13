// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITeeExtensionRegistry} from "./interfaces/ITeeExtensionRegistry.sol";

/**
 * @title VouchsafeInstructionSender
 * @notice On-chain entry point for requesting a confidential solvency proof, following the Flare FCC
 *         InstructionSender pattern. The OP identifiers match the Vouchsafe TEE extension.
 * @dev Two modes, selected by whether a real `TeeExtensionRegistry` is configured:
 *      - Production: forwards to `TeeExtensionRegistry.sendInstructions`, which routes the instruction
 *        to the registered TEE machines running the Vouchsafe extension in Confidential Space.
 *      - Simulated (Coston2 today, where the FCC registry is not yet published): anchors the request as
 *        an on-chain event that the Vouchsafe attestor-service watches, mirroring the FCC ext-proxy.
 *      The same call site works in both modes; only `teeRegistry` changes.
 */
contract VouchsafeInstructionSender is Ownable {
    bytes32 public constant OP_TYPE_SOLVENCY = bytes32("SOLVENCY");
    bytes32 public constant OP_COMMAND_PROVE = bytes32("PROVE");

    /// @notice The Flare FCC registry. Zero address => simulated (event-anchored) mode.
    ITeeExtensionRegistry public teeRegistry;

    /// @dev Counter used to derive a deterministic instruction id in simulated mode.
    uint256 public localInstructionCount;

    event SolvencyProofRequested(
        bytes32 indexed instructionId,
        address indexed subject,
        address indexed requester,
        bytes32 opType,
        bytes32 opCommand,
        bytes message
    );
    event TeeRegistryUpdated(address indexed registry);

    constructor(address _teeRegistry) Ownable(msg.sender) {
        teeRegistry = ITeeExtensionRegistry(_teeRegistry); // may be address(0) for simulated mode
    }

    /// @notice Point this sender at the real FCC registry once available. Owner-only.
    function setTeeRegistry(address _teeRegistry) external onlyOwner {
        teeRegistry = ITeeExtensionRegistry(_teeRegistry);
        emit TeeRegistryUpdated(_teeRegistry);
    }

    /**
     * @notice Request a confidential solvency proof for `subject`.
     * @param subject The entity to prove solvency for (e.g. an FXRP agent).
     * @param teeIds  TEE machine ids to route to (production mode); ignored in simulated mode.
     * @param message ABI/JSON-encoded instruction payload for the extension. Must not contain raw secret
     *                figures if the chain is public — the enclave receives the private inputs off-chain.
     */
    function requestSolvencyProof(address subject, address[] calldata teeIds, bytes calldata message)
        external
        payable
        returns (bytes32 instructionId)
    {
        if (address(teeRegistry) != address(0)) {
            instructionId = teeRegistry.sendInstructions{value: msg.value}(
                teeIds,
                ITeeExtensionRegistry.TeeInstructionParams({
                    opType: OP_TYPE_SOLVENCY,
                    opCommand: OP_COMMAND_PROVE,
                    message: message,
                    cosigners: new address[](0),
                    cosignersThreshold: 0,
                    claimBackAddress: msg.sender
                })
            );
        } else {
            localInstructionCount += 1;
            instructionId = keccak256(
                abi.encode(address(this), block.chainid, localInstructionCount, subject, message)
            );
        }

        emit SolvencyProofRequested(instructionId, subject, msg.sender, OP_TYPE_SOLVENCY, OP_COMMAND_PROVE, message);
    }
}
