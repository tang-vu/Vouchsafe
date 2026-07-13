import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Wallet } from "ethers";
import { SolvencyRegistry, AttestorStaking, SolvencyVerifier } from "../typechain-types";

const MIN_STAKE = ethers.parseEther("1");
const UNBONDING = 60 * 60;
const CHALLENGE_WINDOW = 60 * 60 * 24;
const SLASH_PENALTY = ethers.parseEther("1");

type Claim = {
  subject: string;
  inputHash: string;
  reservesCommitment: string;
  solvent: boolean;
  timestamp: number;
  nonce: number;
};

function makeClaim(subject: string, nonce: number, solvent = true): Claim {
  return {
    subject,
    inputHash: ethers.keccak256(ethers.toUtf8Bytes(`inputs-${nonce}`)),
    reservesCommitment: ethers.keccak256(ethers.toUtf8Bytes(`reserves-${nonce}`)),
    solvent,
    timestamp: 1_700_000_000 + nonce,
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
  let tee: Wallet; // simulated TEE signer

  // Sign a claim exactly as the TEE extension does: EIP-191 personal-sign over the on-chain digest.
  async function signClaim(claim: Claim): Promise<string> {
    const digest = await verifier.claimDigest(claim);
    return tee.signMessage(ethers.getBytes(digest));
  }

  beforeEach(async () => {
    [owner, attestor, subject, beneficiary] = await ethers.getSigners();
    tee = Wallet.createRandom();

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
    await verifier.setTeeAddress(tee.address);
  });

  it("records a solvency attestation with a valid TEE signature and sufficient stake", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 1);
    const sig = await signClaim(claim);

    const tx = await verifier.connect(attestor).recordSolvency(claim, sig);
    await expect(tx).to.emit(verifier, "SolvencyRecorded");

    const id = await registry.latestForSubject(subject.address);
    const stored = await registry.getAttestation(id);
    expect(stored.attestor).to.equal(attestor.address);
    expect(stored.solvent).to.equal(true);
    expect(stored.timestamp).to.equal(claim.timestamp);
    expect(await staking.lockedUntilOf(attestor.address)).to.be.greaterThan(0n);
  });

  it("reverts when the TEE address is not configured", async () => {
    await verifier.setTeeAddress(ethers.ZeroAddress);
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 2);
    const sig = await signClaim(claim);
    await expect(verifier.connect(attestor).recordSolvency(claim, sig)).to.be.revertedWith(
      "SolvencyVerifier: tee not set"
    );
  });

  it("reverts without sufficient stake", async () => {
    const claim = makeClaim(subject.address, 3);
    const sig = await signClaim(claim);
    await expect(verifier.connect(attestor).recordSolvency(claim, sig)).to.be.revertedWith(
      "SolvencyVerifier: insufficient stake"
    );
  });

  it("reverts on a signature from a non-TEE key", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 4);
    const rogue = Wallet.createRandom();
    const digest = await verifier.claimDigest(claim);
    const badSig = await rogue.signMessage(ethers.getBytes(digest));
    await expect(verifier.connect(attestor).recordSolvency(claim, badSig)).to.be.revertedWith(
      "SolvencyVerifier: bad TEE signature"
    );
  });

  it("reverts if the claim is tampered after signing", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 5);
    const sig = await signClaim(claim);
    const tampered = { ...claim, inputHash: ethers.keccak256(ethers.toUtf8Bytes("tampered")) };
    await expect(verifier.connect(attestor).recordSolvency(tampered, sig)).to.be.revertedWith(
      "SolvencyVerifier: bad TEE signature"
    );
  });

  it("reverts on nonce reuse", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 6);
    const sig = await signClaim(claim);
    await verifier.connect(attestor).recordSolvency(claim, sig);
    await expect(verifier.connect(attestor).recordSolvency(claim, sig)).to.be.revertedWith(
      "SolvencyVerifier: nonce used"
    );
  });

  it("reverts when the claim is not solvent", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const claim = makeClaim(subject.address, 7, false);
    const sig = await signClaim(claim);
    await expect(verifier.connect(attestor).recordSolvency(claim, sig)).to.be.revertedWith(
      "SolvencyVerifier: not solvent"
    );
  });

  it("fraud path revokes the attestation and slashes the attestor", async () => {
    await staking.connect(attestor).stake({ value: ethers.parseEther("2") });
    const claim = makeClaim(subject.address, 9);
    const sig = await signClaim(claim);
    await verifier.connect(attestor).recordSolvency(claim, sig);
    const id = await registry.latestForSubject(subject.address);

    await expect(verifier.connect(owner).adminProveFraud(id, attestor.address, beneficiary.address))
      .to.emit(verifier, "FraudProven")
      .withArgs(id, attestor.address, SLASH_PENALTY);

    expect((await registry.getAttestation(id)).revoked).to.equal(true);
    expect(await staking.stakeOf(attestor.address)).to.equal(ethers.parseEther("1"));
  });
});
