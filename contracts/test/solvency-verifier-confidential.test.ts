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
const SOURCE_URL = "https://reserves.example/commitment.json";
const coder = AbiCoder.defaultAbiCoder();

// Salted commitment published by a confidential reserves endpoint (raw total never public).
const commitReservesSalted = (reserves: bigint, reservesSalt: string) =>
  keccak256(coder.encode(["uint256", "bytes32"], [reserves, reservesSalt]));
const commitReservesPlain = (reserves: bigint) => keccak256(coder.encode(["uint256"], [reserves]));
const commitInputs = (reserves: bigint, liabilities: bigint, salt: string) =>
  keccak256(coder.encode(["uint256", "uint256", "bytes32"], [reserves, liabilities, salt]));

// Minimal IWeb2Json.Proof whose payload is a single pre-encoded 32-byte word (raw total or commitment).
function buildProof(abiEncodedData: string, url = SOURCE_URL) {
  return {
    merkleProof: [] as string[],
    data: {
      attestationType: ZeroHash,
      sourceId: ZeroHash,
      votingRound: 0,
      lowestUsedTimestamp: 0,
      requestBody: { url, httpMethod: "GET", headers: "", queryParams: "", body: "", postProcessJq: "", abiSignature: "" },
      responseBody: { abiEncodedData },
    },
  };
}
const commitmentProof = (commitment: string, url?: string) =>
  buildProof(coder.encode(["bytes32"], [commitment]), url);
const plainProof = (reserves: bigint, url?: string) => buildProof(coder.encode(["uint256"], [reserves]), url);

describe("SolvencyVerifier (confidential reserves mode)", () => {
  let registry: SolvencyRegistry;
  let staking: AttestorStaking;
  let verifier: SolvencyVerifier;
  let fdc: MockWeb2JsonVerifier;
  let owner: HardhatEthersSigner;
  let attestor: HardhatEthersSigner;
  let subject: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;
  let tee: Wallet;

  const SALT = keccak256(ethers.toUtf8Bytes("input-salt"));
  const RESERVES_SALT = keccak256(ethers.toUtf8Bytes("reserves-salt"));

  async function signedClaim(
    nonce: number,
    opts: { reserves: bigint; liabilities: bigint; solvent: boolean; reservesCommitment?: string }
  ) {
    const claim = {
      subject: subject.address,
      inputHash: commitInputs(opts.reserves, opts.liabilities, SALT),
      reservesCommitment: opts.reservesCommitment ?? commitReservesSalted(opts.reserves, RESERVES_SALT),
      solvent: opts.solvent,
      timestamp: await time.latest(),
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
    await verifier.setConfidentialReserves(subject.address, true);
    await staking.connect(attestor).stake({ value: ethers.parseEther("2") });
  });

  it("records when the attested salted commitment matches the claim (raw reserves never on-chain)", async () => {
    const { claim, sig } = await signedClaim(1, { reserves: 1500n, liabilities: 900n, solvent: true });
    const proof = commitmentProof(commitReservesSalted(1500n, RESERVES_SALT));
    await expect(verifier.connect(attestor).recordSolvency(claim, sig, proof)).to.emit(verifier, "SolvencyRecorded");
    const id = await registry.latestForSubject(subject.address);
    expect((await registry.getAttestation(id)).reservesCommitment).to.equal(
      commitReservesSalted(1500n, RESERVES_SALT)
    );
  });

  it("reverts when the attested commitment does not match the claim commitment", async () => {
    const { claim, sig } = await signedClaim(2, { reserves: 1500n, liabilities: 900n, solvent: true });
    const wrongSalt = keccak256(ethers.toUtf8Bytes("other-salt"));
    await expect(
      verifier.connect(attestor).recordSolvency(claim, sig, commitmentProof(commitReservesSalted(1500n, wrongSalt)))
    ).to.be.revertedWith("SolvencyVerifier: reserves mismatch");
  });

  it("reverts when a plain raw-reserves proof is presented for a confidential subject", async () => {
    // With confidential mode on, the payload is decoded as the commitment itself; a raw total is not
    // the committed value, so the binding check must fail.
    const { claim, sig } = await signedClaim(3, { reserves: 1500n, liabilities: 900n, solvent: true });
    await expect(
      verifier.connect(attestor).recordSolvency(claim, sig, plainProof(1500n))
    ).to.be.revertedWith("SolvencyVerifier: reserves mismatch");
  });

  it("still enforces the vetted source URL in confidential mode", async () => {
    const { claim, sig } = await signedClaim(4, { reserves: 1500n, liabilities: 900n, solvent: true });
    const proof = commitmentProof(commitReservesSalted(1500n, RESERVES_SALT), "https://evil.example/x.json");
    await expect(verifier.connect(attestor).recordSolvency(claim, sig, proof)).to.be.revertedWith(
      "SolvencyVerifier: source mismatch"
    );
  });

  it("fraud reveal still slashes a confidential attestation (inputHash opening is mode-independent)", async () => {
    const { claim, sig } = await signedClaim(5, { reserves: 1000n, liabilities: 2000n, solvent: true });
    await verifier.connect(attestor).recordSolvency(claim, sig, commitmentProof(commitReservesSalted(1000n, RESERVES_SALT)));
    const id = await registry.latestForSubject(subject.address);

    const before = await staking.stakeOf(attestor.address);
    await expect(verifier.connect(challenger).raiseFraud(id, 1000n, 2000n, SALT))
      .to.emit(verifier, "FraudProven")
      .withArgs(id, attestor.address, challenger.address, SLASH_PENALTY);
    expect(await staking.stakeOf(attestor.address)).to.equal(before - SLASH_PENALTY);
  });

  it("plain mode keeps working after confidential mode is switched off", async () => {
    await verifier.setConfidentialReserves(subject.address, false);
    const { claim, sig } = await signedClaim(6, {
      reserves: 1500n,
      liabilities: 900n,
      solvent: true,
      reservesCommitment: commitReservesPlain(1500n),
    });
    await expect(verifier.connect(attestor).recordSolvency(claim, sig, plainProof(1500n))).to.emit(
      verifier,
      "SolvencyRecorded"
    );
  });

  it("only the owner can toggle confidential mode, and the toggle is evented", async () => {
    await expect(verifier.setConfidentialReserves(subject.address, false))
      .to.emit(verifier, "ConfidentialReservesSet")
      .withArgs(subject.address, false);
    await expect(
      verifier.connect(attestor).setConfidentialReserves(subject.address, true)
    ).to.be.revertedWithCustomError(verifier, "OwnableUnauthorizedAccount");
    expect(await verifier.confidentialReserves(subject.address)).to.equal(false);
  });
});
