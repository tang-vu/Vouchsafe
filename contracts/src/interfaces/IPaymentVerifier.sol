// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IPayment.sol";

/**
 * @title IPaymentVerifier
 * @notice Minimal surface of the Flare FDC verification contract used for XRPL payment proofs: verify a
 *         Payment attestation proof against the on-chain Merkle root. The production implementation is
 *         resolved via `ContractRegistry.getFdcVerification()`; a mock implements the same method for
 *         unit tests.
 */
interface IPaymentVerifier {
    function verifyPayment(IPayment.Proof calldata _proof) external view returns (bool);
}
