import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AttestorStaking } from "../typechain-types";

const MIN_STAKE = ethers.parseEther("1");
const UNBONDING = 60 * 60; // 1 hour

describe("AttestorStaking", () => {
  let staking: AttestorStaking;
  let owner: HardhatEthersSigner;
  let slasher: HardhatEthersSigner; // stand-in verifier
  let attestor: HardhatEthersSigner;
  let beneficiary: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, slasher, attestor, beneficiary, stranger] = await ethers.getSigners();
    const Staking = await ethers.getContractFactory("AttestorStaking");
    staking = await Staking.deploy(MIN_STAKE, UNBONDING);
    await staking.waitForDeployment();
    await staking.setSlasher(slasher.address);
  });

  it("accepts stake and tracks balance", async () => {
    await expect(staking.connect(attestor).stake({ value: MIN_STAKE }))
      .to.emit(staking, "Staked")
      .withArgs(attestor.address, MIN_STAKE);
    expect(await staking.stakeOf(attestor.address)).to.equal(MIN_STAKE);
  });

  it("rejects zero-value stake", async () => {
    await expect(staking.connect(attestor).stake({ value: 0 })).to.be.revertedWith(
      "AttestorStaking: zero stake"
    );
  });

  it("enforces unbonding delay before withdrawal", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    await staking.connect(attestor).requestUnstake(MIN_STAKE);

    // still unbonding
    await expect(staking.connect(attestor).withdraw()).to.be.revertedWith(
      "AttestorStaking: still unbonding"
    );

    await time.increase(UNBONDING + 1);
    await expect(staking.connect(attestor).withdraw())
      .to.emit(staking, "Withdrawn")
      .withArgs(attestor.address, MIN_STAKE);
    expect(await staking.stakeOf(attestor.address)).to.equal(0n);
  });

  it("blocks unstake while stake is locked, then allows it after lock expires", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    const lockUntil = (await time.latest()) + 1000;
    await staking.connect(slasher).lockUntil(attestor.address, lockUntil);

    await expect(staking.connect(attestor).requestUnstake(MIN_STAKE)).to.be.revertedWith(
      "AttestorStaking: stake locked"
    );

    await time.increaseTo(lockUntil + 1);
    await expect(staking.connect(attestor).requestUnstake(MIN_STAKE)).to.emit(
      staking,
      "UnstakeRequested"
    );
  });

  it("only the slasher can slash, and slashing reduces stake + pays beneficiary", async () => {
    await staking.connect(attestor).stake({ value: ethers.parseEther("3") });

    await expect(
      staking.connect(stranger).slash(attestor.address, MIN_STAKE, beneficiary.address)
    ).to.be.revertedWith("AttestorStaking: not slasher");

    const before = await ethers.provider.getBalance(beneficiary.address);
    await expect(staking.connect(slasher).slash(attestor.address, MIN_STAKE, beneficiary.address))
      .to.emit(staking, "Slashed")
      .withArgs(attestor.address, MIN_STAKE, beneficiary.address);

    expect(await staking.stakeOf(attestor.address)).to.equal(ethers.parseEther("2"));
    const after = await ethers.provider.getBalance(beneficiary.address);
    expect(after - before).to.equal(MIN_STAKE);
  });

  it("caps slash at available stake", async () => {
    await staking.connect(attestor).stake({ value: MIN_STAKE });
    await staking.connect(slasher).slash(attestor.address, ethers.parseEther("100"), beneficiary.address);
    expect(await staking.stakeOf(attestor.address)).to.equal(0n);
  });

  it("only owner can set slasher / minStake", async () => {
    await expect(staking.connect(stranger).setSlasher(stranger.address)).to.be.reverted;
    await expect(staking.connect(stranger).setMinStake(1)).to.be.reverted;
  });
});
