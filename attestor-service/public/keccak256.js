/*
 * Vouchsafe — self-contained keccak-256 (Ethereum variant, 0x01 padding).
 *
 * Why this exists: the Commitment Builder reproduces, entirely in the browser, the exact
 * `keccak256(abi.encode(...))` that SolvencyVerifier computes on-chain — proving that the only
 * thing the chain ever sees is a hash, never the reserves/liabilities themselves.
 *
 * BigInt lanes (25 x 64-bit). Correctness over speed: inputs are ~96 bytes. Verified byte-for-byte
 * against ethers `keccak256` / `AbiCoder` in a node harness before shipping.
 *
 * Exposes `window.VouchsafeHash` in the browser and `module.exports` under node (for the test harness).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VouchsafeHash = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MASK = (1n << 64n) - 1n;

  // Round constants for the 24 rounds of Keccak-f[1600].
  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ];

  // Rotation offsets r[x][y] for the rho step; lane index = x + 5*y.
  const ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
  ];

  function rotl(x, n) {
    n = BigInt(n) % 64n;
    if (n === 0n) return x & MASK;
    return ((x << n) | (x >> (64n - n))) & MASK;
  }

  function keccakF(state) {
    for (let round = 0; round < 24; round++) {
      // theta
      const C = new Array(5);
      for (let x = 0; x < 5; x++) {
        C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
      }
      const D = new Array(5);
      for (let x = 0; x < 5; x++) {
        D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) state[x + 5 * y] ^= D[x];
      }

      // rho + pi
      const B = new Array(25).fill(0n);
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROT[x][y]);
        }
      }

      // chi
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          state[x + 5 * y] =
            B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK) & B[((x + 2) % 5) + 5 * y]);
        }
      }

      // iota
      state[0] ^= RC[round];
    }
  }

  /** keccak-256 over a Uint8Array, returning a 32-byte Uint8Array. */
  function keccak256Bytes(msg) {
    const rate = 136; // 1088-bit rate (block size in bytes) for keccak-256
    const state = new Array(25).fill(0n);

    // Absorb with Keccak (Ethereum) padding: append 0x01, pad with zeros, final byte |= 0x80.
    const padLen = rate - (msg.length % rate);
    const padded = new Uint8Array(msg.length + padLen);
    padded.set(msg);
    padded[msg.length] ^= 0x01;
    padded[padded.length - 1] ^= 0x80;

    for (let offset = 0; offset < padded.length; offset += rate) {
      for (let i = 0; i < rate / 8; i++) {
        let lane = 0n;
        for (let b = 0; b < 8; b++) {
          lane |= BigInt(padded[offset + i * 8 + b]) << BigInt(8 * b); // little-endian lanes
        }
        state[i] ^= lane;
      }
      keccakF(state);
    }

    // Squeeze the first 32 bytes (fits in the first 4 lanes of the rate).
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) {
      let lane = state[i];
      for (let b = 0; b < 8; b++) {
        out[i * 8 + b] = Number((lane >> BigInt(8 * b)) & 0xffn);
      }
    }
    return out;
  }

  // --- hex + abi helpers (mirroring the subset of ethers we need) ---

  function toHex(bytes) {
    let s = "0x";
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }

  function hexToBytes(hex) {
    let h = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (h.length % 2) h = "0" + h;
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  /** Left-pad a non-negative BigInt to a 32-byte big-endian word (abi uint256 encoding). */
  function uint256Word(value) {
    let v = BigInt(value);
    if (v < 0n) throw new Error("uint256 cannot be negative");
    const out = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return out;
  }

  /** A bytes32 value (hex) as a 32-byte word (abi bytes32 encoding, right-padded already 32B). */
  function bytes32Word(hex) {
    const b = hexToBytes(hex);
    if (b.length > 32) throw new Error("bytes32 too long");
    const out = new Uint8Array(32);
    out.set(b, 32 - b.length); // treat as a 32-byte value; salts are full-width
    return out;
  }

  function concatBytes(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  function keccak256Hex(bytes) {
    return toHex(keccak256Bytes(bytes));
  }

  /** inputHash = keccak256(abi.encode(uint256 reserves, uint256 liabilities, bytes32 salt)). */
  function inputHash(reserves, liabilities, saltHex) {
    return keccak256Hex(
      concatBytes([uint256Word(reserves), uint256Word(liabilities), bytes32Word(saltHex)])
    );
  }

  /** reservesCommitment = keccak256(abi.encode(uint256 reserves)). */
  function reservesCommitment(reserves) {
    return keccak256Hex(uint256Word(reserves));
  }

  return {
    keccak256Bytes,
    keccak256Hex,
    inputHash,
    reservesCommitment,
    uint256Word,
    bytes32Word,
    toHex,
    hexToBytes,
  };
});
