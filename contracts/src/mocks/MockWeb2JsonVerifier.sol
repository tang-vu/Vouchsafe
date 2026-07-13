// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {IWeb2JsonVerifier} from "../interfaces/IWeb2JsonVerifier.sol";

/**
 * @title MockWeb2JsonVerifier
 * @notice Test-only stand-in for the FDC verification contract. Returns a configurable result so unit
 *         tests can exercise the FDC-gated paths without a live attestation round. Never deployed to a
 *         real network.
 */
contract MockWeb2JsonVerifier is IWeb2JsonVerifier {
    bool public result = true;

    function setResult(bool _result) external {
        result = _result;
    }

    function verifyWeb2Json(IWeb2Json.Proof calldata) external view returns (bool) {
        return result;
    }
}
