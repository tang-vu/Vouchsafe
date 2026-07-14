import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { keccak256, toUtf8Bytes, ZeroHash, encodeBytes32String, hexlify, randomBytes } from "ethers";
import { XrplReserveProof, MockPaymentVerifier } from "../typechain-types";

const XRPL_ADDRESS = "rQGYqiy2NUJavGCigVpsdaTAyr4tvphLyM";
const SOURCE_ID = encodeBytes32String("testXRP");

// FDC standard address hash for XRPL: keccak256 of the address string.
const addressHash = (addr: string) => keccak256(toUtf8Bytes(addr));

describe("XrplReserveProof (FDC Payment)", () => {
  let xrpl: XrplReserveProof;
  let fdc: MockPaymentVerifier;
  let owner: HardhatEthersSigner;
  let subject: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  // Minimal IPayment.Proof around the fields the contract checks; the mock verifier returns true.
  async function buildProof(opts: {
    reference: string;
    sourceAddr?: string;
    txId?: string;
    status?: number;
    blockTimestamp?: number;
    sourceId?: string;
  }) {
    return {
      merkleProof: [] as string[],
      data: {
        attestationType: encodeBytes32String("Payment"),
        sourceId: opts.sourceId ?? SOURCE_ID,
        votingRound: 0,
        lowestUsedTimestamp: 0,
        requestBody: { transactionId: opts.txId ?? hexlify(randomBytes(32)), inUtxo: 0, utxo: 0 },
        responseBody: {
          blockNumber: 1,
          blockTimestamp: opts.blockTimestamp ?? (await time.latest()),
          sourceAddressHash: addressHash(opts.sourceAddr ?? XRPL_ADDRESS),
          sourceAddressesRoot: ZeroHash,
          receivingAddressHash: ZeroHash,
          intendedReceivingAddressHash: ZeroHash,
          spentAmount: 11,
          intendedSpentAmount: 11,
          receivedAmount: 1,
          intendedReceivedAmount: 1,
          standardPaymentReference: opts.reference,
          oneToOne: true,
          status: opts.status ?? 0,
        },
      },
    };
  }

  beforeEach(async () => {
    [owner, subject, other] = await ethers.getSigners();
    xrpl = await (await ethers.getContractFactory("XrplReserveProof")).deploy();
    fdc = await (await ethers.getContractFactory("MockPaymentVerifier")).deploy();
    await xrpl.setPaymentVerifierOverride(await fdc.getAddress());
    await xrpl.setXrplReserveAddress(subject.address, XRPL_ADDRESS);
  });

  it("registers the XRPL reserve address with its standard hash", async () => {
    expect(await xrpl.xrplAddressHash(subject.address)).to.equal(addressHash(XRPL_ADDRESS));
    expect(await xrpl.xrplAddressOf(subject.address)).to.equal(XRPL_ADDRESS);
  });

  it("only the owner registers addresses or sets the override", async () => {
    await expect(xrpl.connect(other).setXrplReserveAddress(subject.address, XRPL_ADDRESS)).to.be.reverted;
    await expect(xrpl.connect(other).setPaymentVerifierOverride(other.address)).to.be.reverted;
  });

  it("proves control with a valid challenge payment and records it", async () => {
    const nonce = 1n;
    const ref = await xrpl.challengeRef(subject.address, nonce);
    const proof = await buildProof({ reference: ref });

    await expect(xrpl.proveControl(subject.address, nonce, proof))
      .to.emit(xrpl, "XrplControlProven")
      .withArgs(subject.address, proof.data.requestBody.transactionId, proof.data.responseBody.blockTimestamp, nonce);

    const control = await xrpl.lastProof(subject.address);
    expect(control.xrplTxId).to.equal(proof.data.requestBody.transactionId);
    expect(control.nonce).to.equal(nonce);
    expect(await xrpl.isFresh(subject.address, 3600)).to.equal(true);
  });

  it("rejects a subject with no registered address", async () => {
    const ref = await xrpl.challengeRef(other.address, 1n);
    await expect(
      xrpl.proveControl(other.address, 1n, await buildProof({ reference: ref }))
    ).to.be.revertedWith("XrplReserveProof: address not set");
  });

  it("rejects a payment from the wrong XRPL address", async () => {
    const ref = await xrpl.challengeRef(subject.address, 1n);
    const proof = await buildProof({ reference: ref, sourceAddr: "rDifferentAddress111111111111111111" });
    await expect(xrpl.proveControl(subject.address, 1n, proof)).to.be.revertedWith(
      "XrplReserveProof: wrong source address"
    );
  });

  it("rejects a mismatched challenge reference (other subject / other nonce)", async () => {
    const wrongRef = await xrpl.challengeRef(other.address, 1n);
    await expect(
      xrpl.proveControl(subject.address, 1n, await buildProof({ reference: wrongRef }))
    ).to.be.revertedWith("XrplReserveProof: reference mismatch");
  });

  it("rejects a failed XRPL payment", async () => {
    const ref = await xrpl.challengeRef(subject.address, 1n);
    await expect(
      xrpl.proveControl(subject.address, 1n, await buildProof({ reference: ref, status: 1 }))
    ).to.be.revertedWith("XrplReserveProof: payment failed");
  });

  it("rejects a stale payment past maxProofAge", async () => {
    const nonce = 1n;
    const ref = await xrpl.challengeRef(subject.address, nonce);
    const stale = (await time.latest()) - 3601;
    await expect(
      xrpl.proveControl(subject.address, nonce, await buildProof({ reference: ref, blockTimestamp: stale }))
    ).to.be.revertedWith("XrplReserveProof: stale payment");
  });

  it("rejects a wrong source chain id", async () => {
    const ref = await xrpl.challengeRef(subject.address, 1n);
    const proof = await buildProof({ reference: ref, sourceId: encodeBytes32String("testBTC") });
    await expect(xrpl.proveControl(subject.address, 1n, proof)).to.be.revertedWith(
      "XrplReserveProof: wrong source chain"
    );
  });

  it("rejects an invalid FDC proof", async () => {
    await fdc.setResult(false);
    const ref = await xrpl.challengeRef(subject.address, 1n);
    await expect(
      xrpl.proveControl(subject.address, 1n, await buildProof({ reference: ref }))
    ).to.be.revertedWith("XrplReserveProof: bad FDC proof");
  });

  it("blocks nonce and XRPL-tx replay", async () => {
    const nonce = 7n;
    const ref = await xrpl.challengeRef(subject.address, nonce);
    const proof = await buildProof({ reference: ref });
    await xrpl.proveControl(subject.address, nonce, proof);

    await expect(xrpl.proveControl(subject.address, nonce, proof)).to.be.revertedWith(
      "XrplReserveProof: nonce used"
    );
    // Same XRPL tx answering a different nonce must also fail.
    const ref2 = await xrpl.challengeRef(subject.address, 8n);
    const proof2 = await buildProof({ reference: ref2, txId: proof.data.requestBody.transactionId });
    await expect(xrpl.proveControl(subject.address, 8n, proof2)).to.be.revertedWith(
      "XrplReserveProof: tx used"
    );
  });

  it("freshness expires and the override locks one-way", async () => {
    const nonce = 1n;
    const ref = await xrpl.challengeRef(subject.address, nonce);
    await xrpl.proveControl(subject.address, nonce, await buildProof({ reference: ref }));

    await time.increase(7200);
    expect(await xrpl.isFresh(subject.address, 3600)).to.equal(false);

    await xrpl.lockPaymentVerifierOverride();
    await expect(xrpl.setPaymentVerifierOverride(ethers.ZeroAddress)).to.be.revertedWith(
      "XrplReserveProof: override locked"
    );
  });
});
