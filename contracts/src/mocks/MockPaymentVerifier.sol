// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IPayment.sol";
import {IPaymentVerifier} from "../interfaces/IPaymentVerifier.sol";

/**
 * @title MockPaymentVerifier
 * @notice Test-only stand-in for the FDC Payment verification contract. Returns a configurable result
 *         so unit tests can exercise the XRPL-proof paths without a live attestation round. Never
 *         deployed to a real network.
 */
contract MockPaymentVerifier is IPaymentVerifier {
    bool public result = true;

    function setResult(bool _result) external {
        result = _result;
    }

    function verifyPayment(IPayment.Proof calldata) external view returns (bool) {
        return result;
    }
}
