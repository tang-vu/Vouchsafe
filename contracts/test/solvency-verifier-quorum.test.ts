import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AbiCoder, keccak256, getBytes, ZeroHash, Wallet } from "ethers";
import { SolvencyRegistry, AttestorStaking, SolvencyVerifier, MockWeb2JsonVerifier } from "../typechain-types";

const MIN_STAKE = ethers.parseEther("1");
const UNBONDING = 60 * 60;
const CHALLENGE_WINDOW = 60 * 60 * 24;
const SLASH_PENALTY = ethers.parseEther("1");
const SOURCE_URL = "https://reserves.example/feed.json";
const coder = AbiCoder.defaultAbiCoder();

const commitReserves = (reserves: bigint) => keccak256(coder.encode(["uint256"], [reserves]));
const commitInputs = (reserves: bigint, liabilities: bigint, salt: string) =>
  keccak256(coder.encode(["uint256", "uint256", "bytes32"], [reserves, liabilities, salt]));

function buildProof(reserves: bigint, url = SOURCE_URL) {
  return {
    merkleProof: [] as string[],
    data: {
      attestationType: ZeroHash,
      sourceId: ZeroHash,
      votingRound: 0,
      lowestUsedTimestamp: 0,
      requestBody: { url, httpMethod: "GET", headers: "", queryParams: "", body: "", postProcessJq: "", abiSignature: "" },
      responseBody: { abiEncodedData: coder.encode(["uint256"], [reserves]) },
    },
  };
}

describe("SolvencyVerifier (quorum + subject policy)", () => {
  let registry: SolvencyRegistry;
  let staking: AttestorStaking;
  let verifier: SolvencyVerifier;
  let fdc: MockWeb2JsonVerifier;
  let owner: HardhatEthersSigner;
  let attestor: HardhatEthersSigner;
  let endorserA: HardhatEthersSigner;
  let endorserB: HardhatEthersSigner;
  let subject: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;
  let tee: Wallet;

  const SALT = keccak256(ethers.toUtf8Bytes("salt"));

  async function recordAttestation(
    nonce: number,
    opts: { reserves: bigint; liabilities: bigint }
  ): Promise<string> {
    const claim = {
      subject: subject.address,
      inputHash: commitInputs(opts.reserves, opts.liabilities, SALT),
      reservesCommitment: commitReserves(opts.reserves),
      solvent: true,
      timestamp: await time.latest(),
      nonce,
    };
    const sig = await tee.signMessage(getBytes(await verifier.claimDigest(claim)));
    await verifier.connect(attestor).recordSolvency(claim, sig, buildProof(opts.reserves));
    return registry.latestForSubject(subject.address);
  }

  beforeEach(async () => {
    [owner, attestor, endorserA, endorserB, subject, challenger] = await ethers.getSigners();
    tee = Wallet.createRandom();

    registry = await (await ethers.getContractFactory("SolvencyRegistry")).deploy();
    staking = await (await ethers.getContractFactory("AttestorStaking")).deploy(MIN_STAKE, UNBONDING);
    verifier = await (
      await ethers.getContractFactory("SolvencyVerifier")
    ).deploy(await registry.getAddress(), await staking.getAddress(), CHALLENGE_WINDOW, SLASH_PENALTY);
    fdc = await (await ethers.getContractFactory("MockWeb2JsonVerifier")).deploy();

    await registry.setVerifier(await verifier.getAddress());
    await staking.setSlasher(await verifier.getAddress());
    await verifier.setTeeAddress(tee.address);
    await verifier.setFdcVerifierOverride(await fdc.getAddress());
    await verifier.setReservesSource(subject.address, SOURCE_URL);
    await staking.connect(attestor).stake({ value: ethers.parseEther("2") });
    await staking.connect(endorserA).stake({ value: ethers.parseEther("2") });
    await staking.connect(endorserB).stake({ value: ethers.parseEther("2") });
  });

  describe("endorse", () => {
    it("lets an independent staked attestor endorse and counts it", async () => {
      const id = await recordAttestation(1, { reserves: 1500n, liabilities: 900n });
      await expect(verifier.connect(endorserA).endorse(id))
        .to.emit(verifier, "AttestationEndorsed")
        .withArgs(id, endorserA.address, 1);
      expect(await verifier.endorsementCount(id)).to.equal(1);
      expect(await verifier.endorsersOf(id)).to.deep.equal([endorserA.address]);
      expect(await verifier.hasEndorsed(id, endorserA.address)).to.equal(true);
    });

    it("locks the endorser's stake for a fresh challenge window", async () => {
      const id = await recordAttestation(2, { reserves: 1500n, liabilities: 900n });
      await verifier.connect(endorserA).endorse(id);
      await expect(staking.connect(endorserA).requestUnstake(MIN_STAKE)).to.be.revertedWith(
        "AttestorStaking: stake locked"
      );
      await time.increase(CHALLENGE_WINDOW + 1);
      await expect(staking.connect(endorserA).requestUnstake(MIN_STAKE)).to.not.be.reverted;
    });

    it("rejects self-endorsement, double endorsement, and unstaked endorsers", async () => {
      const id = await recordAttestation(3, { reserves: 1500n, liabilities: 900n });
      await expect(verifier.connect(attestor).endorse(id)).to.be.revertedWith("SolvencyVerifier: self endorse");
      await verifier.connect(endorserA).endorse(id);
      await expect(verifier.connect(endorserA).endorse(id)).to.be.revertedWith(
        "SolvencyVerifier: already endorsed"
      );
      await expect(verifier.connect(challenger).endorse(id)).to.be.revertedWith(
        "SolvencyVerifier: insufficient stake"
      );
    });

    it("rejects endorsement of unknown or revoked attestations", async () => {
      await expect(verifier.connect(endorserA).endorse(ZeroHash)).to.be.revertedWith(
        "SolvencyRegistry: unknown id"
      );
      const id = await recordAttestation(4, { reserves: 1000n, liabilities: 2000n });
      await verifier.connect(challenger).raiseFraud(id, 1000n, 2000n, SALT);
      await expect(verifier.connect(endorserA).endorse(id)).to.be.revertedWith("SolvencyVerifier: revoked");
    });

    it("caps the endorser set", async () => {
      expect(await verifier.MAX_ENDORSERS()).to.equal(32);
    });
  });

  describe("quorum", () => {
    it("tracks quorum against the subject's required endorsements", async () => {
      await verifier.setSubjectPolicy(subject.address, 0, 0, 2);
      const id = await recordAttestation(5, { reserves: 1500n, liabilities: 900n });

      expect(await verifier.isQuorate(id)).to.equal(false);
      await verifier.connect(endorserA).endorse(id);
      expect(await verifier.isQuorate(id)).to.equal(false);
      await verifier.connect(endorserB).endorse(id);
      expect(await verifier.isQuorate(id)).to.equal(true);
    });

    it("is quorate immediately when the subject requires no endorsements", async () => {
      const id = await recordAttestation(6, { reserves: 1500n, liabilities: 900n });
      expect(await verifier.isQuorate(id)).to.equal(true);
    });

    it("loses quorum once revoked", async () => {
      await verifier.setSubjectPolicy(subject.address, 0, 0, 1);
      const id = await recordAttestation(7, { reserves: 1000n, liabilities: 2000n });
      await verifier.connect(endorserA).endorse(id);
      expect(await verifier.isQuorate(id)).to.equal(true);
      await verifier.connect(challenger).raiseFraud(id, 1000n, 2000n, SALT);
      expect(await verifier.isQuorate(id)).to.equal(false);
    });
  });

  describe("subject policy", () => {
    it("enforces a stricter per-subject stake floor on record and endorse", async () => {
      await verifier.setSubjectPolicy(subject.address, ethers.parseEther("5"), 0, 0);
      expect(await verifier.requiredStakeFor(subject.address)).to.equal(ethers.parseEther("5"));

      const claim = {
        subject: subject.address,
        inputHash: commitInputs(1500n, 900n, SALT),
        reservesCommitment: commitReserves(1500n),
        solvent: true,
        timestamp: await time.latest(),
        nonce: 8,
      };
      const sig = await tee.signMessage(getBytes(await verifier.claimDigest(claim)));
      await expect(
        verifier.connect(attestor).recordSolvency(claim, sig, buildProof(1500n))
      ).to.be.revertedWith("SolvencyVerifier: insufficient stake");

      await staking.connect(attestor).stake({ value: ethers.parseEther("3") }); // now 5 total
      await verifier.connect(attestor).recordSolvency(claim, sig, buildProof(1500n));
      const id = await registry.latestForSubject(subject.address);
      await expect(verifier.connect(endorserA).endorse(id)).to.be.revertedWith(
        "SolvencyVerifier: insufficient stake"
      );
    });

    it("never weakens the global stake floor", async () => {
      await verifier.setSubjectPolicy(subject.address, ethers.parseEther("0.1"), 0, 0);
      expect(await verifier.requiredStakeFor(subject.address)).to.equal(MIN_STAKE);
    });

    it("applies the per-subject slash penalty override", async () => {
      const penalty = ethers.parseEther("2");
      await verifier.setSubjectPolicy(subject.address, 0, penalty, 0);
      expect(await verifier.slashPenaltyFor(subject.address)).to.equal(penalty);

      const id = await recordAttestation(9, { reserves: 1000n, liabilities: 2000n });
      const before = await staking.stakeOf(attestor.address);
      await expect(verifier.connect(challenger).raiseFraud(id, 1000n, 2000n, SALT))
        .to.emit(verifier, "FraudProven")
        .withArgs(id, attestor.address, challenger.address, penalty);
      expect(await staking.stakeOf(attestor.address)).to.equal(before - penalty);
    });

    it("only the owner can set a subject policy", async () => {
      await expect(
        verifier.connect(attestor).setSubjectPolicy(subject.address, 0, 0, 1)
      ).to.be.revertedWithCustomError(verifier, "OwnableUnauthorizedAccount");
    });
  });

  describe("fraud with endorsers", () => {
    it("slashes the attestor and every endorser, paying the challenger for each", async () => {
      const id = await recordAttestation(10, { reserves: 1000n, liabilities: 2000n });
      await verifier.connect(endorserA).endorse(id);
      await verifier.connect(endorserB).endorse(id);

      const attestorBefore = await staking.stakeOf(attestor.address);
      const aBefore = await staking.stakeOf(endorserA.address);
      const bBefore = await staking.stakeOf(endorserB.address);
      const challengerBefore = await ethers.provider.getBalance(challenger.address);

      const tx = await verifier.connect(challenger).raiseFraud(id, 1000n, 2000n, SALT);
      await expect(tx)
        .to.emit(verifier, "EndorserSlashed")
        .withArgs(id, endorserA.address, SLASH_PENALTY)
        .and.to.emit(verifier, "EndorserSlashed")
        .withArgs(id, endorserB.address, SLASH_PENALTY)
        .and.to.emit(verifier, "FraudProven")
        .withArgs(id, attestor.address, challenger.address, SLASH_PENALTY);

      expect(await staking.stakeOf(attestor.address)).to.equal(attestorBefore - SLASH_PENALTY);
      expect(await staking.stakeOf(endorserA.address)).to.equal(aBefore - SLASH_PENALTY);
      expect(await staking.stakeOf(endorserB.address)).to.equal(bBefore - SLASH_PENALTY);

      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      expect(await ethers.provider.getBalance(challenger.address)).to.equal(
        challengerBefore + SLASH_PENALTY * 3n - gas
      );
    });

    it("cannot slash the same attestation twice", async () => {
      const id = await recordAttestation(11, { reserves: 1000n, liabilities: 2000n });
      await verifier.connect(endorserA).endorse(id);
      await verifier.connect(challenger).raiseFraud(id, 1000n, 2000n, SALT);
      await expect(verifier.connect(challenger).raiseFraud(id, 1000n, 2000n, SALT)).to.be.revertedWith(
        "SolvencyVerifier: already revoked"
      );
    });
  });
});
