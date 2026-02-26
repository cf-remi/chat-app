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
