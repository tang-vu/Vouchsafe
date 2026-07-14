// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IPayment.sol";
import {IPaymentVerifier} from "./interfaces/IPaymentVerifier.sol";

/**
 * @title XrplReserveProof
 * @notice XRPL-native proof that a subject controls its registered XRP reserve address, via the FDC
 *         `Payment` attestation type. The subject sends an XRPL payment from the reserve address whose
 *         memo carries a contract-derived 32-byte challenge reference; FDC attests the payment; this
 *         contract verifies the proof and records "control of the reserve address demonstrated at T".
 *         Complements the Web2Json reserves-amount path in `SolvencyVerifier` with an on-ledger,
 *         XRPL-native signal — no custodian API in the loop.
 * @dev The challenge reference binds the payment to this chain, this contract, the subject, and a
 *      one-time nonce, so a payment observed on XRPL cannot be replayed for another subject or another
 *      deployment. The FDC "standard address hash" for XRPL is `keccak256(bytes(addressString))`.
 */
contract XrplReserveProof is Ownable {
    string public constant DOMAIN = "VOUCHSAFE_XRPL_V1";

    /// @notice Tolerated clock skew (seconds) for an XRPL ledger close time ahead of block time.
    uint64 public constant TIMESTAMP_FUTURE_SKEW = 300;

    struct XrplControl {
        bytes32 xrplTxId; // XRPL transaction hash that proved control
        uint64 xrplTimestamp; // XRPL ledger close time (unix) of that payment
        uint64 provenAt; // block timestamp when the proof was recorded
        uint256 nonce; // challenge nonce the payment answered
    }

    /// @notice FDC standard address hash (keccak256 of the address string) of the registered XRPL
    ///         reserve address per subject. Owner-vetted, mirroring `reservesSourceHash`.
    mapping(address => bytes32) public xrplAddressHash;
    /// @notice Human-readable registered XRPL reserve address (for UIs and off-chain tooling).
    mapping(address => string) public xrplAddressOf;

    mapping(address => XrplControl) private _control;
    mapping(address => mapping(uint256 => bool)) public usedNonce;
    mapping(bytes32 => bool) public usedXrplTx;

    /// @notice Max age (seconds) of the attested XRPL ledger close time relative to block time.
    uint64 public maxProofAge = 3600;

    /// @notice Expected FDC source id — `testXRP` on Coston2/Songbird testnets, `XRP` on mainnets.
    bytes32 public expectedSourceId = bytes32("testXRP");

    /// @notice Test-only override for the FDC verifier, once-lockable to prevent a production bypass.
    address public paymentVerifierOverride;
    bool public paymentOverrideLocked;

    event XrplAddressSet(address indexed subject, bytes32 addressHash, string xrplAddress);
    event XrplControlProven(address indexed subject, bytes32 xrplTxId, uint64 xrplTimestamp, uint256 nonce);
    event PaymentVerifierOverrideUpdated(address indexed verifier);
    event PaymentOverrideLocked();

    constructor() Ownable(msg.sender) {}

    // --- admin ---

    /// @notice Register (or replace) the XRPL reserve address the subject must prove control of.
    function setXrplReserveAddress(address subject, string calldata xrplAddress) external onlyOwner {
        bytes32 h = keccak256(bytes(xrplAddress));
        xrplAddressHash[subject] = h;
        xrplAddressOf[subject] = xrplAddress;
        emit XrplAddressSet(subject, h, xrplAddress);
    }

    function setMaxProofAge(uint64 _age) external onlyOwner {
        maxProofAge = _age;
    }

    function setExpectedSourceId(bytes32 _sourceId) external onlyOwner {
        expectedSourceId = _sourceId;
    }

    function setPaymentVerifierOverride(address _override) external onlyOwner {
        require(!paymentOverrideLocked, "XrplReserveProof: override locked");
        paymentVerifierOverride = _override;
        emit PaymentVerifierOverrideUpdated(_override);
    }

    /// @notice Permanently disable the verifier override (one-way), forcing registry resolution.
    function lockPaymentVerifierOverride() external onlyOwner {
        paymentOverrideLocked = true;
        emit PaymentOverrideLocked();
    }

    // --- challenge ---

    /// @notice The 32-byte reference the XRPL payment's memo must carry to answer the challenge for
    ///         `(subject, nonce)`. Chain- and contract-bound, so it cannot be replayed elsewhere.
    function challengeRef(address subject, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, block.chainid, address(this), subject, nonce));
    }

    // --- core ---

    /**
     * @notice Record that `subject` demonstrated control of its registered XRPL reserve address.
     *         Permissionless: the FDC proof gates everything. Requires a successful XRPL payment,
     *         attested by FDC, sent FROM the registered address, whose standard payment reference
     *         equals `challengeRef(subject, nonce)`, recent per `maxProofAge`.
     */
    function proveControl(address subject, uint256 nonce, IPayment.Proof calldata proof) external {
        bytes32 registered = xrplAddressHash[subject];
        require(registered != bytes32(0), "XrplReserveProof: address not set");
        require(!usedNonce[subject][nonce], "XrplReserveProof: nonce used");

        IPayment.ResponseBody calldata body = proof.data.responseBody;
        bytes32 txId = proof.data.requestBody.transactionId;
        require(!usedXrplTx[txId], "XrplReserveProof: tx used");
        require(proof.data.sourceId == expectedSourceId, "XrplReserveProof: wrong source chain");
        require(paymentVerifier().verifyPayment(proof), "XrplReserveProof: bad FDC proof");
        require(body.status == 0, "XrplReserveProof: payment failed");
        require(body.sourceAddressHash == registered, "XrplReserveProof: wrong source address");
        require(
            body.standardPaymentReference == challengeRef(subject, nonce),
            "XrplReserveProof: reference mismatch"
        );
        require(
            body.blockTimestamp <= block.timestamp + TIMESTAMP_FUTURE_SKEW &&
                body.blockTimestamp + maxProofAge >= block.timestamp,
            "XrplReserveProof: stale payment"
        );

        usedNonce[subject][nonce] = true;
        usedXrplTx[txId] = true;
        _control[subject] = XrplControl({
            xrplTxId: txId,
            xrplTimestamp: body.blockTimestamp,
            provenAt: uint64(block.timestamp),
            nonce: nonce
        });

        emit XrplControlProven(subject, txId, body.blockTimestamp, nonce);
    }

    // --- views ---

    /// @notice Latest recorded control proof for `subject` (zeroed struct if none).
    function lastProof(address subject) external view returns (XrplControl memory) {
        return _control[subject];
    }

    /// @notice True when `subject` proved control within the last `maxAge` seconds.
    function isFresh(address subject, uint64 maxAge) external view returns (bool) {
        uint64 provenAt = _control[subject].provenAt;
        return provenAt != 0 && provenAt + maxAge >= block.timestamp;
    }

    // --- FDC verifier resolution ---

    function paymentVerifier() public view returns (IPaymentVerifier) {
        if (paymentVerifierOverride != address(0)) return IPaymentVerifier(paymentVerifierOverride);
        return IPaymentVerifier(address(ContractRegistry.getFdcVerification()));
    }
}
