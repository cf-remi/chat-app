const API_BASE = import.meta.env.VITE_API_BASE || "";

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
  return data;
}

// Servers
export const fetchServers = () => api("/api/servers");

export const createServer = (name) =>
  api("/api/servers", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const joinServer = (serverId) =>
  api(`/api/servers/${serverId}/join`, { method: "POST" });

// Channels
export const fetchChannels = (serverId) =>
  api(`/api/servers/${serverId}/channels`);

export const createChannel = (serverId, name, type) =>
  api(`/api/servers/${serverId}/channels`, {
    method: "POST",
    body: JSON.stringify({ name, type }),
  });

// Browse & join
export const browseServers = () => api("/api/servers/browse");

export const joinByInvite = (inviteCode) =>
  api("/api/servers/join-by-invite", {
    method: "POST",
    body: JSON.stringify({ inviteCode }),
  });

// Admin actions
export const regenerateInvite = (serverId) =>
  api(`/api/servers/${serverId}/regenerate-invite`, { method: "POST" });

export const revokeInvite = (serverId) =>
  api(`/api/servers/${serverId}/revoke-invite`, { method: "POST" });

export const kickMember = (serverId, targetUserId) =>
  api(`/api/servers/${serverId}/kick`, {
    method: "POST",
    body: JSON.stringify({ targetUserId }),
  });

export const fetchMembers = (serverId) =>
  api(`/api/servers/${serverId}/members`);

export const deleteChannel = (serverId, channelId) =>
  api(`/api/servers/${serverId}/channels/${channelId}`, { method: "DELETE" });

export const deleteServer = (serverId) =>
  api(`/api/servers/${serverId}`, { method: "DELETE" });

export const setServerPrivacy = (serverId, is_public) =>
  api(`/api/servers/${serverId}/privacy`, {
    method: "PATCH",
    body: JSON.stringify({ is_public }),
  });

// File uploads
const DIRECT_UPLOAD_LIMIT = 75 * 1024 * 1024; // 75 MB

export const getFileUrl = (fileId) => `${API_BASE}/api/files/${fileId}`;

// Upload a file, choosing direct or presigned flow based on size.
// onProgress(0-100) is called during the upload.
export async function uploadFile(file, channelId, onProgress = () => {}) {
  if (file.size <= DIRECT_UPLOAD_LIMIT) {
    return uploadFileDirect(file, channelId, onProgress);
  } else {
    return uploadFilePresigned(file, channelId, onProgress);
  }
}

async function uploadFileDirect(file, channelId, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("channelId", channelId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/files/upload`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 201) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        const err = (() => { try { return JSON.parse(xhr.responseText).error; } catch { return `Upload failed (${xhr.status})`; } })();
        reject(new Error(err));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
    xhr.send(form);
  });
}

async function uploadFilePresigned(file, channelId, onProgress) {
  // Step 1: get presigned URL
  const { fileId, uploadUrl } = await api("/api/files/presign", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
      channelId,
    }),
  });

  // Step 2: upload directly to R2 via XHR for progress tracking
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
    xhr.send(file);
  });

  // Step 3: confirm with Worker
  return api("/api/files/confirm", {
    method: "POST",
    body: JSON.stringify({ fileId }),
  });
}

// Push notifications
export const getVapidKey = () => api("/api/push/vapid-key");

export const subscribePush = (subscription) =>
  api("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription),
  });

export const unsubscribePush = (endpoint) =>
  api("/api/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });

// RealtimeKit (voice)
export const joinVoiceRoom = (channelId) =>
  api("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ channelId }),
  });

// OAuth account linking
export const oauthLink = (linkToken, password) =>
  api("/auth/oauth/link", {
    method: "POST",
    body: JSON.stringify({ linkToken, password }),
  });
