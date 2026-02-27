const ITERATIONS = 100_000;
const KEY_LENGTH = 32;

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

async function deriveKey(password: string, salt: ArrayBuffer): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH * 8
  );
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveKey(password, salt.buffer);
  return {
    hash: bufToHex(derived),
    salt: bufToHex(salt.buffer),
  };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  // OAuth-only accounts have empty pw_hash/pw_salt — always reject password login
  if (!storedHash || !storedSalt) return false;

  const salt = hexToBuf(storedSalt);
  const derived = await deriveKey(password, salt);
  const derivedBuf = new Uint8Array(derived);
  const storedBuf = new Uint8Array(hexToBuf(storedHash));

  if (derivedBuf.length !== storedBuf.length) return false;

  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < derivedBuf.length; i++) {
    diff |= derivedBuf[i] ^ storedBuf[i];
  }
  return diff === 0;
}
