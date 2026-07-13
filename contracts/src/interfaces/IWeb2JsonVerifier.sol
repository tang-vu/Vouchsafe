// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

/**
 * @title IWeb2JsonVerifier
 * @notice Minimal surface of the Flare FDC verification contract used by Vouchsafe: verify a Web2Json
 *         attestation proof against the on-chain Merkle root. The production implementation is resolved
 *         via `ContractRegistry.getFdcVerification()`; a mock implements the same method for unit tests.
 */
interface IWeb2JsonVerifier {
    function verifyWeb2Json(IWeb2Json.Proof calldata _proof) external view returns (bool);
}
