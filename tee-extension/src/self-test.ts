import { verifyMessage, getBytes, keccak256, toUtf8Bytes } from "ethers";
import { computeSolvency } from "./solvency-compute";
import { TeeSigner } from "./tee-signer";
import { handleProveSolvency } from "./action-handler";

/**
 * Dependency-free checks for the confidential computation and the signing scheme. Verifies that the
 * signature recovers to the TEE address and that raw figures never appear in the returned attestation.
 */
async function main() {
  let failures = 0;
  const check = (cond: boolean, msg: string) => {
    if (cond) console.log("  ok  -", msg);
    else {
      console.error("  FAIL-", msg);
      failures++;
    }
  };

  const salt = keccak256(toUtf8Bytes("self-test-salt"));

  // --- computation ---
  const solventCase = computeSolvency(["1000000", "500000"], ["900000"], salt);
  check(solventCase.solvent === true, "1,500,000 reserves >= 900,000 liabilities => solvent");

  const insolventCase = computeSolvency(["500000"], ["900000"], salt);
  check(insolventCase.solvent === false, "500,000 reserves < 900,000 liabilities => insolvent");

  const equalCase = computeSolvency(["900000"], ["900000"], salt);
  check(equalCase.solvent === true, "equal reserves and liabilities => solvent (>=)");

  check(
    solventCase.reservesCommitment === computeSolvency(["1500000"], ["1"], salt).reservesCommitment,
    "reservesCommitment depends only on total reserves"
  );

  // --- sign + recover ---
  const signer = new TeeSigner("", true);
  const chainId = 114;
  const verifier = "0x19d193CF58c06a428efd63E2086F77f9A7172290";
  const subject = "0x000000000000000000000000000000000000dEaD";
  const result = await handleProveSolvency(
    { subject, reserves: ["1000000", "500000"], liabilities: ["900000"], salt, nonce: "1", timestamp: 1_700_000_000, chainId, verifier },
    signer
  );

  const digest = signer.digest({
    chainId,
    verifier,
    subject,
    inputHash: result.inputHash,
    reservesCommitment: result.reservesCommitment,
    solvent: result.solvent,
    timestamp: result.timestamp,
    nonce: BigInt(result.nonce),
  });
  const recovered = verifyMessage(getBytes(digest), result.signature);
  check(recovered.toLowerCase() === signer.address.toLowerCase(), "signature recovers to the TEE address");

  // --- privacy: raw figures must not be present ---
  const serialized = JSON.stringify(result);
  check(!serialized.includes("1000000") && !serialized.includes("500000") && !serialized.includes("900000"), "raw reserve/liability figures absent from the attestation");
  check(!("reserves" in (result as object)) && !("liabilities" in (result as object)), "no reserves/liabilities keys leak into the result");

  // --- validation rejects bad input ---
  try {
    await handleProveSolvency({ subject: "not-an-address", reserves: ["1"], liabilities: ["1"], salt, nonce: "2", chainId, verifier }, signer);
    check(false, "invalid subject should throw");
  } catch {
    check(true, "invalid subject rejected");
  }

  console.log(failures === 0 ? "\nAll self-tests passed." : `\n${failures} self-test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
