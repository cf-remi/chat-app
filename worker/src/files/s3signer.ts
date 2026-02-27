// Lightweight AWS Signature V4 presigned URL generator for Cloudflare R2
// R2 exposes an S3-compatible API at https://<accountId>.r2.cloudflarestorage.com

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const REGION = "auto"; // R2 uses "auto" as the region

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(hash);
}

function formatDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function formatDateShort(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

async function deriveSigningKey(
  secretKey: string,
  dateShort: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(
    new TextEncoder().encode("AWS4" + secretKey),
    dateShort
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  return kSigning;
}

export interface PresignedUrlOptions {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  key: string;           // object key in R2
  method: "PUT" | "GET";
  expiresIn: number;     // seconds
  contentType?: string;  // for PUT: enforce content type
  contentLength?: number; // for PUT: enforce content length
}

export async function createPresignedUrl(opts: PresignedUrlOptions): Promise<string> {
  const {
    accountId,
    bucketName,
    accessKeyId,
    secretAccessKey,
    key,
    method,
    expiresIn,
    contentType,
    contentLength,
  } = opts;

  const now = new Date();
  const datetime = formatDate(now);
  const dateShort = formatDateShort(now);

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}/${bucketName}/${key}`;

  const credentialScope = `${dateShort}/${REGION}/${SERVICE}/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  // Build signed headers - for presigned URLs, only host is required
  const signedHeaders = "host";
  const canonicalHeaders = `host:${host}\n`;

  // Query string parameters (must be sorted)
  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": credential,
    "X-Amz-Date": datetime,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  };

  // For PUT with content constraints, add as query params
  if (method === "PUT" && contentType) {
    queryParams["x-amz-meta-content-type"] = contentType;
  }

  const sortedQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  // Canonical request
  // For presigned URLs, payload hash is "UNSIGNED-PAYLOAD"
  // Path MUST be RFC3986 encoded (encode each segment, preserve /)
  const encodedPath = `/${bucketName}/${key}`
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");

  const canonicalRequest = [
    method,
    encodedPath,
    sortedQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const canonicalRequestHash = await sha256Hex(canonicalRequest);

  // String to sign
  const stringToSign = [
    ALGORITHM,
    datetime,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  // Signing key and signature
  const signingKey = await deriveSigningKey(secretAccessKey, dateShort, REGION, SERVICE);
  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signature = toHex(signatureBuffer);

  return `${endpoint}?${sortedQueryString}&X-Amz-Signature=${signature}`;
}
