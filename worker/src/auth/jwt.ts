import { SignJWT, jwtVerify } from "jose";
import type { JwtPayload } from "../types.js";

const ALG = "HS256";
const EXPIRY = "7d";

function getSecret(jwtSecret: string) {
  return new TextEncoder().encode(jwtSecret);
}

export async function signToken(
  payload: { sub: string; username: string },
  jwtSecret: string
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret(jwtSecret));
}

export async function verifyToken(
  token: string,
  jwtSecret: string
): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(jwtSecret));
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}
