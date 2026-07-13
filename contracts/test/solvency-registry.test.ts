import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { SolvencyRegistry } from "../typechain-types";

function makeAttestation(subject: string, attestor: string, opts: Partial<{ nonce: number; timestamp: number; solvent: boolean }> = {}) {
  return {
    subject,
    attestor,
    inputHash: ethers.keccak256(ethers.toUtf8Bytes("private-inputs")),
    reservesCommitment: ethers.keccak256(ethers.toUtf8Bytes("reserves")),
    timestamp: opts.timestamp ?? 1_700_000_000,
    nonce: opts.nonce ?? 1,
    solvent: opts.solvent ?? true,
    revoked: false,
  };
}

describe("SolvencyRegistry", () => {
  let registry: SolvencyRegistry;
  let owner: HardhatEthersSigner;
  let verifier: HardhatEthersSigner; // stand-in verifier EOA
  let subject: HardhatEthersSigner;
  let attestor: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, verifier, subject, attestor, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("SolvencyRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
    await registry.setVerifier(verifier.address);
  });

  it("only owner can set the verifier", async () => {
    await expect(registry.connect(stranger).setVerifier(stranger.address)).to.be.reverted;
  });

  it("records an attestation and indexes it by subject", async () => {
    const att = makeAttestation(subject.address, attestor.address);
    const id = await registry.connect(verifier).recordAttestation.staticCall(att);

    await expect(registry.connect(verifier).recordAttestation(att))
      .to.emit(registry, "SolvencyAsserted")
      .withArgs(id, subject.address, attestor.address, att.inputHash, att.timestamp);

    const stored = await registry.getAttestation(id);
    expect(stored.subject).to.equal(subject.address);
    expect(stored.solvent).to.equal(true);
    expect(stored.revoked).to.equal(false);
    expect(await registry.latestForSubject(subject.address)).to.equal(id);
    expect(await registry.attestationCountForSubject(subject.address)).to.equal(1n);
    expect(await registry.totalAttestations()).to.equal(1n);
  });

  it("rejects writes from a non-verifier", async () => {
    const att = makeAttestation(subject.address, attestor.address);
    await expect(registry.connect(stranger).recordAttestation(att)).to.be.revertedWith(
      "SolvencyRegistry: not verifier"
    );
  });

  it("rejects duplicate ids", async () => {
    const att = makeAttestation(subject.address, attestor.address, { nonce: 7 });
    await registry.connect(verifier).recordAttestation(att);
    await expect(registry.connect(verifier).recordAttestation(att)).to.be.revertedWith(
      "SolvencyRegistry: duplicate"
    );
  });

  it("marks an attestation revoked", async () => {
    const att = makeAttestation(subject.address, attestor.address, { nonce: 3 });
    const id = await registry.connect(verifier).recordAttestation.staticCall(att);
    await registry.connect(verifier).recordAttestation(att);

    await expect(registry.connect(verifier).markRevoked(id))
      .to.emit(registry, "AttestationRevoked")
      .withArgs(id, subject.address);

    const stored = await registry.getAttestation(id);
    expect(stored.revoked).to.equal(true);
  });

  it("reverts on unknown id reads and revokes", async () => {
    const bogus = ethers.keccak256(ethers.toUtf8Bytes("nope"));
    await expect(registry.getAttestation(bogus)).to.be.revertedWith("SolvencyRegistry: unknown id");
    await expect(registry.connect(verifier).markRevoked(bogus)).to.be.revertedWith(
      "SolvencyRegistry: unknown id"
    );
  });
});
