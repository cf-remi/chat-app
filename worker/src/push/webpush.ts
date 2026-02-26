// Lightweight Web Push implementation for Cloudflare Workers
// Uses Web Crypto API — no npm dependencies

interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  channelId?: string;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (base64.length % 4)) % 4;
  const raw = atob(base64 + "=".repeat(pad));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function uint8ArrayToBase64Url(arr: Uint8Array): string {
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

async function createVapidAuthHeader(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  sub: string
): Promise<{ authorization: string; cryptoKey: string }> {
  const audience = new URL(endpoint).origin;

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: sub,
  };

  const headerB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const privateKeyBytes = base64UrlToUint8Array(vapidPrivateKey);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    await convertRawPrivateKeyToPkcs8(privateKeyBytes, vapidPublicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(unsignedToken)
    )
  );

  const token = `${unsignedToken}.${uint8ArrayToBase64Url(signature)}`;

  return {
    authorization: `vapid t=${token}, k=${vapidPublicKey}`,
    cryptoKey: vapidPublicKey,
  };
}

async function convertRawPrivateKeyToPkcs8(
  rawPrivateKey: Uint8Array,
  publicKeyBase64Url: string
): Promise<ArrayBuffer> {
  const publicKeyBytes = base64UrlToUint8Array(publicKeyBase64Url);

  // Build DER-encoded PKCS#8 wrapper for EC P-256 private key
  const ecPrivateKeyDer = buildEcPrivateKey(rawPrivateKey, publicKeyBytes);
  return ecPrivateKeyDer;
}

function buildEcPrivateKey(privateKey: Uint8Array, publicKey: Uint8Array): ArrayBuffer {
  // PKCS#8 wrapping of EC private key for P-256
  // OID for P-256: 1.2.840.10045.3.1.7
  const oidP256 = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
  const oidEcPublicKey = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);

  // ECPrivateKey structure
  const ecPrivateKey = buildDerSequence([
    buildDerInteger(new Uint8Array([0x01])), // version
    buildDerOctetString(privateKey),
    buildDerContextTag(1, buildDerBitString(publicKey)),
  ]);

  // AlgorithmIdentifier
  const algorithmIdentifier = buildDerSequence([oidEcPublicKey, oidP256]);

  // PKCS#8 PrivateKeyInfo
  const pkcs8 = buildDerSequence([
    buildDerInteger(new Uint8Array([0x00])), // version
    algorithmIdentifier,
    buildDerOctetString(new Uint8Array(ecPrivateKey)),
  ]);

  return pkcs8.buffer;
}

function buildDerSequence(items: Uint8Array[]): Uint8Array {
  const content = concatUint8Arrays(...items);
  return concatUint8Arrays(new Uint8Array([0x30]), derLength(content.length), content);
}

function buildDerInteger(value: Uint8Array): Uint8Array {
  return concatUint8Arrays(new Uint8Array([0x02]), derLength(value.length), value);
}

function buildDerOctetString(value: Uint8Array): Uint8Array {
  return concatUint8Arrays(new Uint8Array([0x04]), derLength(value.length), value);
}

function buildDerBitString(value: Uint8Array): Uint8Array {
  const content = concatUint8Arrays(new Uint8Array([0x00]), value);
  return concatUint8Arrays(new Uint8Array([0x03]), derLength(content.length), content);
}

function buildDerContextTag(tag: number, value: Uint8Array): Uint8Array {
  return concatUint8Arrays(new Uint8Array([0xa0 | tag]), derLength(value.length), value);
}

function derLength(length: number): Uint8Array {
  if (length < 128) return new Uint8Array([length]);
  if (length < 256) return new Uint8Array([0x81, length]);
  return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff]);
}

async function encryptPayload(
  payload: string,
  p256dhKey: string,
  authSecret: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; localPublicKey: Uint8Array }> {
  const clientPublicKey = base64UrlToUint8Array(p256dhKey);
  const clientAuth = base64UrlToUint8Array(authSecret);

  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const localPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeyPair.publicKey)
  );

  // Import client public key
  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Derive shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientKey },
      localKeyPair.privateKey,
      256
    )
  );

  // Generate salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive encryption key using HKDF
  const encoder = new TextEncoder();

  // IKM = HKDF(auth, sharedSecret, "Content-Encoding: auth\0", 32)
  const authInfo = concatUint8Arrays(encoder.encode("Content-Encoding: auth\0"));
  const prk = await hkdfExtract(clientAuth, sharedSecret);
  const ikm = await hkdfExpand(prk, authInfo, 32);

  // PRK for content encryption
  const contentPrk = await hkdfExtract(salt, ikm);

  // Context for key and nonce derivation (RFC 8291)
  const keyInfo = concatUint8Arrays(
    encoder.encode("Content-Encoding: aes128gcm\0")
  );
  const nonceInfo = concatUint8Arrays(
    encoder.encode("Content-Encoding: nonce\0")
  );

  const contentKey = await hkdfExpand(contentPrk, keyInfo, 16);
  const nonce = await hkdfExpand(contentPrk, nonceInfo, 12);

  // Encrypt with AES-128-GCM
  const paddedPayload = concatUint8Arrays(
    new TextEncoder().encode(payload),
    new Uint8Array([2]) // padding delimiter
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    contentKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      paddedPayload
    )
  );

  // Build aes128gcm content coding header
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, encrypted.length + 86);

  const header = concatUint8Arrays(
    salt,
    recordSize,
    new Uint8Array([localPublicKeyRaw.length]),
    localPublicKeyRaw
  );

  const ciphertext = concatUint8Arrays(header, encrypted);

  return { ciphertext, salt, localPublicKey: localPublicKeyRaw };
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, ikm));
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const input = concatUint8Arrays(info, new Uint8Array([1]));
  const result = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
  return result.slice(0, length);
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<boolean> {
  try {
    const payloadStr = JSON.stringify(payload);

    const { ciphertext } = await encryptPayload(
      payloadStr,
      subscription.p256dh,
      subscription.auth
    );

    const vapid = await createVapidAuthHeader(
      subscription.endpoint,
      vapidPublicKey,
      vapidPrivateKey,
      "mailto:admin@goodshab.com"
    );

    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapid.authorization,
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: "86400",
      },
      body: ciphertext,
    });

    if (response.status === 410 || response.status === 404) {
      // Subscription expired or invalid — caller should delete it
      return false;
    }

    return response.ok;
  } catch (err) {
    console.error("Push notification failed:", err);
    return false;
  }
}
