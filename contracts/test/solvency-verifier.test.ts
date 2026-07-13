import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { SolvencyRegistry, AttestorStaking, SolvencyVerifier } from "../typechain-types";

const MIN_STAKE = ethers.parseEther("1");
const UNBONDING = 60 * 60;
const CHALLENGE_WINDOW = 60 * 60 * 24;
const SLASH_PENALTY = ethers.parseEther("1");

function makeClaim(subject: string, nonce: number, solvent = true) {
  return {
    subject,
    inputHash: ethers.keccak256(ethers.toUtf8Bytes(`inputs-${nonce}`)),
    reservesCommitment: ethers.keccak256(ethers.toUtf8Bytes(`reserves-${nonce}`)),
    solvent,
    nonce,
  };
}

describe("SolvencyVerifier", () => {
  let registry: SolvencyRegistry;
  let staking: AttestorStaking;
  let verifier: SolvencyVerifier;
  let owner: HardhatEthersSigner;
  let attestor: HardhatEthersSigner;
  let subject: HardhatEthersSigner;
  let beneficiary: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, attestor, subject, beneficiary] = await ethers.getSigners();

    registry = await (await ethers.getContractFactory("SolvencyRegistry")).deploy();
    await registry.waitForDeployment();
    staking = await (await ethers.getContractFactory("AttestorStaking")).deploy(MIN_STAKE, UNBONDING);
    await staking.waitForDeployment();
    verifier = await (
      await ethers.getContractFactory("SolvencyVerifier")
    ).deploy(await registry.getAddress(), await staking.getAddress(), CHALLENGE_WINDOW, SLASH_PENALTY);
    await verifier.waitForDeployment();

    await registry.setVerifier(await verifier.getAddress());
    await staking.setSlasher(await verifier.getAddress());
  });

  it("records a solvency attestation when stake is sufficient, and locks the stake", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 1);

    const id = await verifier.connect(attestor).recordSolvency.staticCall(claim);
    await expect(verifier.connect(attestor).recordSolvency(claim))
      .to.emit(verifier, "SolvencyRecorded")
      .withArgs(id, subject.address, attestor.address);

    const stored = await registry.getAttestation(id);
    expect(stored.attestor).to.equal(attestor.address);
    expect(stored.solvent).to.equal(true);
    expect(await staking.lockedUntilOf(attestor.address)).to.be.greaterThan(0n);
  });

  it("reverts without sufficient stake", async () => {
    const claim = makeClaim(subject.address, 2);
    await expect(verifier.connect(attestor).recordSolvency(claim)).to.be.revertedWith(
      "SolvencyVerifier: insufficient stake"
    );
  });

  it("reverts on nonce reuse", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 5);
    await verifier.connect(attestor).recordSolvency(claim);
    await expect(verifier.connect(attestor).recordSolvency(claim)).to.be.revertedWith(
      "SolvencyVerifier: nonce used"
    );
  });

  it("reverts when the claim is not solvent", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 6, false);
    await expect(verifier.connect(attestor).recordSolvency(claim)).to.be.revertedWith(
      "SolvencyVerifier: not solvent"
    );
  });

  it("fraud path revokes the attestation and slashes the attestor", async () => {
    await staking.connect(attestor).stake({ value: ethers.parseEther("2") });
    const claim = makeClaim(subject.address, 9);
    const id = await verifier.connect(attestor).recordSolvency.staticCall(claim);
    await verifier.connect(attestor).recordSolvency(claim);

    await expect(verifier.connect(owner).adminProveFraud(id, attestor.address, beneficiary.address))
      .to.emit(verifier, "FraudProven")
      .withArgs(id, attestor.address, SLASH_PENALTY);

    expect((await registry.getAttestation(id)).revoked).to.equal(true);
    expect(await staking.stakeOf(attestor.address)).to.equal(ethers.parseEther("1"));
  });

  it("only owner can trigger the (placeholder) fraud path", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 11);
    const id = await verifier.connect(attestor).recordSolvency.staticCall(claim);
    await verifier.connect(attestor).recordSolvency(claim);
    await expect(
      verifier.connect(attestor).adminProveFraud(id, attestor.address, beneficiary.address)
    ).to.be.reverted;
  });
});
