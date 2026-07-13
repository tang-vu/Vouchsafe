import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { VouchsafeInstructionSender } from "../typechain-types";

describe("VouchsafeInstructionSender", () => {
  let sender: VouchsafeInstructionSender;
  let owner: HardhatEthersSigner;
  let requester: HardhatEthersSigner;
  let subject: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, requester, subject, stranger] = await ethers.getSigners();
    // Simulated mode: no real TeeExtensionRegistry configured.
    sender = await (await ethers.getContractFactory("VouchsafeInstructionSender")).deploy(ethers.ZeroAddress);
    await sender.waitForDeployment();
  });

  it("exposes the FCC op identifiers matching the extension", async () => {
    expect(await sender.OP_TYPE_SOLVENCY()).to.equal(ethers.encodeBytes32String("SOLVENCY"));
    expect(await sender.OP_COMMAND_PROVE()).to.equal(ethers.encodeBytes32String("PROVE"));
  });

  it("anchors a solvency-proof request as an event in simulated mode", async () => {
    const message = ethers.toUtf8Bytes("nonce=1");
    await expect(sender.connect(requester).requestSolvencyProof(subject.address, [], message)).to.emit(
      sender,
      "SolvencyProofRequested"
    );
    expect(await sender.localInstructionCount()).to.equal(1n);
  });

  it("only owner can set the real registry", async () => {
    await expect(sender.connect(stranger).setTeeRegistry(stranger.address)).to.be.reverted;
    await expect(sender.connect(owner).setTeeRegistry(stranger.address)).to.emit(sender, "TeeRegistryUpdated");
  });
});
