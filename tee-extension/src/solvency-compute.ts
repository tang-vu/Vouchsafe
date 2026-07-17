import { AbiCoder, keccak256, isHexString } from "ethers";

const abi = AbiCoder.defaultAbiCoder();

export interface SolvencyComputation {
  solvent: boolean;
  inputHash: string; // commitment to (totalReserves, totalLiabilities, salt)
  reservesCommitment: string; // commitment to totalReserves (bound to the FDC-attested reserves); salted with reservesSalt in confidential mode
  totalReserves: bigint; // in-enclave only; callers must not surface this
  totalLiabilities: bigint; // in-enclave only; callers must not surface this
}

/** Parse and sum a list of non-negative integer strings, rejecting anything malformed. */
function sumNonNegative(values: string[], label: string): bigint {
  let total = 0n;
  for (const v of values) {
    let n: bigint;
    try {
      n = BigInt(v);
    } catch {
      throw new Error(`${label} contains a non-integer value`);
    }
    if (n < 0n) throw new Error(`${label} contains a negative value`);
    total += n;
  }
  return total;
}

/**
 * The confidential computation. Sums reserves and liabilities, decides solvency, and produces the
 * commitments that will be recorded on-chain. The raw totals are returned for in-enclave signing only.
 * With `reservesSalt` (confidential-reserves mode) the reserves commitment is SALTED — it matches a
 * commitment-publishing endpoint and resists dictionary attacks on low-entropy reserve figures.
 */
export function computeSolvency(
  reserves: string[],
  liabilities: string[],
  salt: string,
  reservesSalt?: string
): SolvencyComputation {
  if (!Array.isArray(reserves) || reserves.length === 0) throw new Error("reserves must be a non-empty array");
  if (!Array.isArray(liabilities)) throw new Error("liabilities must be an array");
  if (!isHexString(salt, 32)) throw new Error("salt must be a 32-byte hex string");
  if (reservesSalt !== undefined && !isHexString(reservesSalt, 32))
    throw new Error("reservesSalt must be a 32-byte hex string");

  const totalReserves = sumNonNegative(reserves, "reserves");
  const totalLiabilities = sumNonNegative(liabilities, "liabilities");
  const solvent = totalReserves >= totalLiabilities;

  const inputHash = keccak256(
    abi.encode(["uint256", "uint256", "bytes32"], [totalReserves, totalLiabilities, salt])
  );
  const reservesCommitment = reservesSalt
    ? keccak256(abi.encode(["uint256", "bytes32"], [totalReserves, reservesSalt]))
    : keccak256(abi.encode(["uint256"], [totalReserves]));

  return { solvent, inputHash, reservesCommitment, totalReserves, totalLiabilities };
}
