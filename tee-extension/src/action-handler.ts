import { isAddress, isHexString } from "ethers";
import { computeSolvency } from "./solvency-compute";
import { TeeSigner } from "./tee-signer";
import { DOMAIN } from "./config";
import { ProveSolvencyRequest, SolvencyAttestationResult } from "./types";

/**
 * Handle a SOLVENCY/PROVE instruction. Follows the FCC action-handler pattern: decode → validate →
 * execute (confidential) → build a signed result. Raw reserves/liabilities never leave this function.
 */
export async function handleProveSolvency(
  req: ProveSolvencyRequest,
  signer: TeeSigner
): Promise<SolvencyAttestationResult> {
  // 1–2. validate untrusted input strictly
  if (!req || typeof req !== "object") throw new Error("missing request body");
  if (!isAddress(req.subject)) throw new Error("invalid subject address");
  if (!isAddress(req.verifier)) throw new Error("invalid verifier address");
  if (!Number.isInteger(req.chainId) || req.chainId <= 0) throw new Error("invalid chainId");
  if (!isHexString(req.salt, 32)) throw new Error("salt must be a 32-byte hex string");
  if (req.reservesSalt !== undefined && !isHexString(req.reservesSalt, 32))
    throw new Error("reservesSalt must be a 32-byte hex string");
  if (req.nonce === undefined || req.nonce === null) throw new Error("missing nonce");

  let nonce: bigint;
  try {
    nonce = BigInt(req.nonce);
  } catch {
    throw new Error("nonce must be an integer");
  }
  if (nonce < 0n) throw new Error("nonce must be non-negative");

  const timestamp = req.timestamp ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || timestamp <= 0) throw new Error("invalid timestamp");

  // 3. confidential computation (raw totals stay in memory here)
  const { solvent, inputHash, reservesCommitment } = computeSolvency(
    req.reserves,
    req.liabilities,
    req.salt,
    req.reservesSalt
  );

  // 4. build + sign the result over the exact on-chain digest
  const digest = signer.digest({
    chainId: req.chainId,
    verifier: req.verifier,
    subject: req.subject,
    inputHash,
    reservesCommitment,
    solvent,
    timestamp,
    nonce,
  });
  const signature = await signer.sign(digest);

  return {
    subject: req.subject,
    inputHash,
    reservesCommitment,
    confidentialReserves: req.reservesSalt !== undefined,
    solvent,
    timestamp,
    nonce: nonce.toString(),
    chainId: req.chainId,
    verifier: req.verifier,
    signature,
    teeAddress: signer.address,
    domain: DOMAIN,
    simulated: signer.simulated,
  };
}
