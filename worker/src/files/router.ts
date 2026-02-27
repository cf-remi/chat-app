import { Hono } from "hono";
import { authMiddleware } from "../auth/middleware.js";
import type { Env } from "../types.js";
import { createPresignedUrl } from "./s3signer.js";

const files = new Hono<{ Bindings: Env }>();

files.use("*", authMiddleware);

const DIRECT_UPLOAD_LIMIT = 75 * 1024 * 1024;   // 75 MB — use Worker for files below this
const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024;    // 1 GB hard cap
const PRESIGN_EXPIRY = 15 * 60;                   // 15 minutes

const ALLOWED_TYPES = new Set([
  // Images
  "image/png", "image/jpeg", "image/gif", "image/webp",
  // Video
  "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo",
  // Audio
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
  // Documents
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
]);

// Inline display types (shown in chat rather than download link)
const INLINE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "video/mp4", "video/webm", "video/quicktime",
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
]);

async function assertChannelMember(
  db: D1Database,
  channelId: string,
  userId: string
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 FROM channels ch
     JOIN server_members sm ON sm.server_id = ch.server_id AND sm.user_id = ?
     WHERE ch.id = ?`
  ).bind(userId, channelId).first();
  return !!row;
}

// ── POST /api/files/presign ── Request a presigned PUT URL (large files > 75MB)
files.post("/files/presign", async (c) => {
  const userId = c.get("userId");
  const { filename, contentType, size, channelId } = await c.req.json<{
    filename: string;
    contentType: string;
    size: number;
    channelId: string;
  }>();

  if (!filename || !contentType || !size || !channelId) {
    return c.json({ error: "filename, contentType, size, and channelId are required" }, 400);
  }
  if (!ALLOWED_TYPES.has(contentType)) {
    return c.json({ error: "File type not allowed" }, 400);
  }
  if (size > MAX_FILE_SIZE) {
    return c.json({ error: "File exceeds 1 GB limit" }, 400);
  }

  const isMember = await assertChannelMember(c.env.DB, channelId, userId);
  if (!isMember) {
    return c.json({ error: "Not a member of this server" }, 403);
  }

  // Sanitize filename
  const safeName = filename.replace(/[^a-zA-Z0-9._\-() ]/g, "_").slice(0, 200);
  const fileId = crypto.randomUUID().replace(/-/g, "");
  const r2Key = `channels/${channelId}/${fileId}/${safeName}`;

  // Insert pending record
  await c.env.DB.prepare(
    `INSERT INTO files (id, user_id, channel_id, r2_key, filename, content_type, size, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(fileId, userId, channelId, r2Key, safeName, contentType, size).run();

  const uploadUrl = await createPresignedUrl({
    accountId: c.env.R2_ACCOUNT_ID,
    bucketName: c.env.R2_BUCKET_NAME,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    key: r2Key,
    method: "PUT",
    expiresIn: PRESIGN_EXPIRY,
    contentType,
    contentLength: size,
  });

  return c.json({ fileId, uploadUrl, r2Key });
});

// ── POST /api/files/confirm ── Confirm a presigned upload completed
files.post("/files/confirm", async (c) => {
  const userId = c.get("userId");
  const { fileId } = await c.req.json<{ fileId: string }>();

  if (!fileId) return c.json({ error: "fileId is required" }, 400);

  const file = await c.env.DB.prepare(
    "SELECT * FROM files WHERE id = ? AND user_id = ? AND status = 'pending'"
  ).bind(fileId, userId).first<{
    id: string; r2_key: string; filename: string; content_type: string; size: number; channel_id: string;
  }>();

  if (!file) return c.json({ error: "File not found or already confirmed" }, 404);

  // Verify the object actually exists in R2
  const obj = await c.env.FILES.head(file.r2_key);
  if (!obj) return c.json({ error: "Upload not found in storage — please retry the upload" }, 400);

  await c.env.DB.prepare(
    "UPDATE files SET status = 'ready' WHERE id = ?"
  ).bind(fileId).run();

  return c.json({
    fileId: file.id,
    filename: file.filename,
    contentType: file.content_type,
    size: file.size,
  });
});

// ── POST /api/files/upload ── Direct upload through Worker (files ≤ 75MB)
files.post("/files/upload", async (c) => {
  const userId = c.get("userId");

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart/form-data" }, 400);
  }

  const fileBlob = formData.get("file") as File | null;
  const channelId = formData.get("channelId") as string | null;

  if (!fileBlob || !channelId) {
    return c.json({ error: "file and channelId are required" }, 400);
  }
  if (!ALLOWED_TYPES.has(fileBlob.type)) {
    return c.json({ error: "File type not allowed" }, 400);
  }
  if (fileBlob.size > DIRECT_UPLOAD_LIMIT) {
    return c.json({ error: "Use presigned upload for files over 75 MB" }, 400);
  }
  if (fileBlob.size > MAX_FILE_SIZE) {
    return c.json({ error: "File exceeds 1 GB limit" }, 400);
  }

  const isMember = await assertChannelMember(c.env.DB, channelId, userId);
  if (!isMember) return c.json({ error: "Not a member of this server" }, 403);

  const safeName = fileBlob.name.replace(/[^a-zA-Z0-9._\-() ]/g, "_").slice(0, 200);
  const fileId = crypto.randomUUID().replace(/-/g, "");
  const r2Key = `channels/${channelId}/${fileId}/${safeName}`;

  await c.env.FILES.put(r2Key, fileBlob.stream(), {
    httpMetadata: { contentType: fileBlob.type },
    customMetadata: { uploadedBy: userId },
  });

  await c.env.DB.prepare(
    `INSERT INTO files (id, user_id, channel_id, r2_key, filename, content_type, size, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')`
  ).bind(fileId, userId, channelId, r2Key, safeName, fileBlob.type, fileBlob.size).run();

  return c.json({
    fileId,
    filename: safeName,
    contentType: fileBlob.type,
    size: fileBlob.size,
  }, 201);
});

// ── GET /api/files/:fileId ── Serve a file (auth + membership required)
files.get("/files/:fileId", async (c) => {
  const userId = c.get("userId");
  const fileId = c.req.param("fileId");

  const file = await c.env.DB.prepare(
    "SELECT * FROM files WHERE id = ? AND status = 'ready'"
  ).bind(fileId).first<{
    r2_key: string; filename: string; content_type: string; size: number; channel_id: string;
  }>();

  if (!file) return c.json({ error: "File not found" }, 404);

  const isMember = await assertChannelMember(c.env.DB, file.channel_id, userId);
  if (!isMember) return c.json({ error: "Not a member of this server" }, 403);

  const obj = await c.env.FILES.get(file.r2_key);
  if (!obj) return c.json({ error: "File not found in storage" }, 404);

  const isInline = INLINE_TYPES.has(file.content_type);
  const safeFilename = file.filename.replace(/"/g, '\\"');
  const disposition = isInline
    ? `inline; filename="${safeFilename}"`
    : `attachment; filename="${safeFilename}"`;

  return new Response(obj.body, {
    headers: {
      "Content-Type": file.content_type,
      "Content-Length": String(file.size),
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export default files;
