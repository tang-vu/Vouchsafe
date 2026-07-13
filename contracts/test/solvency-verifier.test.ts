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

// Minimal IWeb2Json.Proof carrying the reserves total and the source URL; the mock verifier returns true.
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

describe("SolvencyVerifier (FDC + fraud)", () => {
  let registry: SolvencyRegistry;
  let staking: AttestorStaking;
  let verifier: SolvencyVerifier;
  let fdc: MockWeb2JsonVerifier;
  let owner: HardhatEthersSigner;
  let attestor: HardhatEthersSigner;
  let subject: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;
  let tee: Wallet;

  const SALT = keccak256(ethers.toUtf8Bytes("salt"));

  async function signedClaim(
    nonce: number,
    opts: { reserves: bigint; liabilities: bigint; solvent: boolean; timestamp?: number }
  ) {
    const claim = {
      subject: subject.address,
      inputHash: commitInputs(opts.reserves, opts.liabilities, SALT),
      reservesCommitment: commitReserves(opts.reserves),
      solvent: opts.solvent,
      timestamp: opts.timestamp ?? (await time.latest()),
      nonce,
    };
    const digest = await verifier.claimDigest(claim);
    const sig = await tee.signMessage(getBytes(digest));
    return { claim, sig };
  }

  beforeEach(async () => {
    [owner, attestor, subject, challenger] = await ethers.getSigners();
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
  });

  it("records when TEE signature + FDC proof + reserves binding + source all hold", async () => {
    const { claim, sig } = await signedClaim(1, { reserves: 1500n, liabilities: 900n, solvent: true });
    await expect(verifier.connect(attestor).recordSolvency(claim, sig, buildProof(1500n))).to.emit(
      verifier,
      "SolvencyRecorded"
    );
    const id = await registry.latestForSubject(subject.address);
    expect((await registry.getAttestation(id)).solvent).to.equal(true);
  });

  it("reverts when the FDC proof is from an unregistered source", async () => {
    const { claim, sig } = await signedClaim(2, { reserves: 1500n, liabilities: 900n, solvent: true });
    await expect(
      verifier.connect(attestor).recordSolvency(claim, sig, buildProof(1500n, "https://evil.example/x.json"))
    ).to.be.revertedWith("SolvencyVerifier: source mismatch");
  });

  it("reverts when no source is registered for the subject", async () => {
    // owner.address has no reserves source registered; sign correctly for it so the source check is reached.
    const claim = {
      subject: owner.address,
      inputHash: commitInputs(1500n, 900n, SALT),
      reservesCommitment: commitReserves(1500n),
      solvent: true,
      timestamp: await time.latest(),
      nonce: 3,
    };
    const sig = await tee.signMessage(getBytes(await verifier.claimDigest(claim)));
    await expect(verifier.connect(attestor).recordSolvency(claim, sig, buildProof(1500n))).to.be.revertedWith(
      "SolvencyVerifier: source not set"
    );
  });

  it("reverts when the FDC proof is invalid", async () => {
    await fdc.setResult(false);
    const { claim, sig } = await signedClaim(4, { reserves: 1500n, liabilities: 900n, solvent: true });
    await expect(verifier.connect(attestor).recordSolvency(claim, sig, buildProof(1500n))).to.be.revertedWith(
      "SolvencyVerifier: bad FDC proof"
    );
  });

  it("reverts when attested reserves do not match the claim commitment", async () => {
    const { claim, sig } = await signedClaim(5, { reserves: 1500n, liabilities: 900n, solvent: true });
    await expect(verifier.connect(attestor).recordSolvency(claim, sig, buildProof(999n))).to.be.revertedWith(
      "SolvencyVerifier: reserves mismatch"
    );
  });

  it("reverts on a stale asserted timestamp", async () => {
    const old = (await time.latest()) - 5000; // older than maxTimestampAge (3600)
    const { claim, sig } = await signedClaim(6, { reserves: 1500n, liabilities: 900n, solvent: true, timestamp: old });
    await expect(verifier.connect(attestor).recordSolvency(claim, sig, buildProof(1500n))).to.be.revertedWith(
      "SolvencyVerifier: stale timestamp"
    );
  });

  it("reverts on a non-TEE signature", async () => {
    const { claim } = await signedClaim(7, { reserves: 1500n, liabilities: 900n, solvent: true });
    const rogue = Wallet.createRandom();
    const badSig = await rogue.signMessage(getBytes(await verifier.claimDigest(claim)));
    await expect(verifier.connect(attestor).recordSolvency(claim, badSig, buildProof(1500n))).to.be.revertedWith(
      "SolvencyVerifier: bad TEE signature"
    );
  });

  it("reverts without sufficient stake", async () => {
    const { claim, sig } = await signedClaim(8, { reserves: 1500n, liabilities: 900n, solvent: true });
    await expect(verifier.connect(challenger).recordSolvency(claim, sig, buildProof(1500n))).to.be.revertedWith(
      "SolvencyVerifier: insufficient stake"
    );
  });

  it("slashes on a proven-insolvent fraud (reveal opens inputHash, reserves < liabilities), no FDC needed", async () => {
    const { claim, sig } = await signedClaim(9, { reserves: 1000n, liabilities: 2000n, solvent: true });
    await verifier.connect(attestor).recordSolvency(claim, sig, buildProof(1000n));
    const id = await registry.latestForSubject(subject.address);

    const before = await staking.stakeOf(attestor.address);
    await expect(verifier.connect(challenger).raiseFraud(id, 1000n, 2000n, SALT))
      .to.emit(verifier, "FraudProven")
      .withArgs(id, attestor.address, challenger.address, SLASH_PENALTY);

    expect((await registry.getAttestation(id)).revoked).to.equal(true);
    expect(await staking.stakeOf(attestor.address)).to.equal(before - SLASH_PENALTY);
  });

  it("fraud reverts when the reveal does not open the committed inputHash", async () => {
    const { claim, sig } = await signedClaim(10, { reserves: 1000n, liabilities: 2000n, solvent: true });
    await verifier.connect(attestor).recordSolvency(claim, sig, buildProof(1000n));
    const id = await registry.latestForSubject(subject.address);
    await expect(verifier.connect(challenger).raiseFraud(id, 1000n, 1234n, SALT)).to.be.revertedWith(
      "SolvencyVerifier: reveal mismatch"
    );
  });

  it("fraud reverts when the revealed figures are actually solvent", async () => {
    const { claim, sig } = await signedClaim(11, { reserves: 3000n, liabilities: 1000n, solvent: true });
    await verifier.connect(attestor).recordSolvency(claim, sig, buildProof(3000n));
    const id = await registry.latestForSubject(subject.address);
    await expect(verifier.connect(challenger).raiseFraud(id, 3000n, 1000n, SALT)).to.be.revertedWith(
      "SolvencyVerifier: not insolvent"
    );
  });

  it("locks the FDC verifier override permanently", async () => {
    await verifier.lockFdcVerifierOverride();
    await expect(verifier.setFdcVerifierOverride(await fdc.getAddress())).to.be.revertedWith(
      "SolvencyVerifier: override locked"
    );
  });
});
