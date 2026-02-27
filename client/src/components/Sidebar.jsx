import { useState, useEffect, useCallback, useRef } from "react";
import { useAppContext } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  createServer,
  createChannel,
  regenerateInvite,
  revokeInvite,
  kickMember,
  fetchMembers,
  deleteChannel as apiDeleteChannel,
  deleteServer as apiDeleteServer,
  setServerPrivacy,
} from "../api.js";
import ServerBrowser from "./ServerBrowser.jsx";

export default function Sidebar({ onJoinChannel, open, onClose }) {
  const {
    servers,
    activeServer,
    selectServer,
    textChannels,
    voiceChannels,
    activeChannel,
    connectedVoiceChannel,
    refreshServers,
    refreshChannels,
  } = useAppContext();
  const { user, logout } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [members, setMembers] = useState([]);
  const [adminError, setAdminError] = useState("");
  // Channel creation
  const [newChannelType, setNewChannelType] = useState(null); // "text" | "voice" | null
  const [newChannelName, setNewChannelName] = useState("");
  const [channelCreateError, setChannelCreateError] = useState("");
  const channelInputRef = useRef(null);

  const isAdmin = activeServer?.role === "owner" || activeServer?.role === "admin";
  const isOwner = activeServer?.role === "owner";

  const loadMembers = useCallback(async () => {
    if (!activeServer) return;
    try {
      const data = await fetchMembers(activeServer.id);
      setMembers(data.members || []);
    } catch (err) {
      console.error("Failed to fetch members:", err);
    }
  }, [activeServer]);

  useEffect(() => {
    if (showAdmin && activeServer) loadMembers();
  }, [showAdmin, activeServer, loadMembers]);

  const handleCreateServer = async (e) => {
    e.preventDefault();
    if (!newServerName.trim()) return;
    try {
      await createServer(newServerName.trim());
      const updated = await refreshServers();
      if (updated?.length) selectServer(updated[updated.length - 1]);
      setNewServerName("");
      setShowCreate(false);
    } catch (err) {
      console.error("Failed to create server:", err);
    }
  };

  const handleRegenerateInvite = async () => {
    setAdminError("");
    try {
      await regenerateInvite(activeServer.id);
      await refreshServers();
      setAdminError("");
    } catch (err) {
      setAdminError(err.message);
    }
  };

  const handleRevokeInvite = async () => {
    if (!confirm("Revoke the invite code? Existing members will not be affected, but the code will no longer work.")) return;
    setAdminError("");
    try {
      await revokeInvite(activeServer.id);
      await refreshServers();
    } catch (err) {
      setAdminError(err.message);
    }
  };

  const handleKick = async (targetUserId, targetUsername) => {
    if (!confirm(`Kick ${targetUsername} from this server?`)) return;
    setAdminError("");
    try {
      await kickMember(activeServer.id, targetUserId);
      await loadMembers();
    } catch (err) {
      setAdminError(err.message);
    }
  };

  const handleDeleteChannel = async (e, channelId) => {
    e.stopPropagation();
    if (!confirm("Delete this channel?")) return;
    try {
      await apiDeleteChannel(activeServer.id, channelId);
      await refreshChannels();
    } catch (err) {
      console.error("Failed to delete channel:", err);
    }
  };

  const handleDeleteServer = async () => {
    if (!confirm(`Delete "${activeServer.name}"? This cannot be undone.`)) return;
    try {
      await apiDeleteServer(activeServer.id);
      const updated = await refreshServers();
      selectServer(updated?.length ? updated[0] : null);
      setShowAdmin(false);
    } catch (err) {
      setAdminError(err.message);
    }
  };

  const openNewChannelForm = (type) => {
    setNewChannelType(type);
    setNewChannelName("");
    setChannelCreateError("");
    // Focus the input after render
    setTimeout(() => channelInputRef.current?.focus(), 0);
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    const name = newChannelName.trim();
    if (!name || !newChannelType || !activeServer) return;
    setChannelCreateError("");
    try {
      await createChannel(activeServer.id, name, newChannelType);
      await refreshChannels();
      setNewChannelType(null);
      setNewChannelName("");
    } catch (err) {
      setChannelCreateError(err.message);
    }
  };

  const cancelNewChannel = () => {
    setNewChannelType(null);
    setNewChannelName("");
    setChannelCreateError("");
  };

  const handleTogglePrivacy = async () => {
    if (!activeServer) return;
    setAdminError("");
    try {
      await setServerPrivacy(activeServer.id, !activeServer.is_public);
      await refreshServers();
    } catch (err) {
      setAdminError(err.message);
    }
  };

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />}
    <nav className={`sidebar${open ? " sidebar--open" : ""}`}>
      {/* Server list */}
      <div className="server-list">
        {servers.map((s) => (
          <div
            key={s.id}
            className={`server-pill ${activeServer?.id === s.id ? "active" : ""}`}
            onClick={() => { selectServer(s); setShowAdmin(false); }}
            title={s.name}
          >
            {s.name.charAt(0).toUpperCase()}
          </div>
        ))}
        <div
          className="server-pill add-server"
          onClick={() => setShowCreate(!showCreate)}
          title="Create Server"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <div
          className="server-pill browse-server"
          onClick={() => setShowBrowser(true)}
          title="Browse / Join Server"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="6" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
        </div>
      </div>

      {/* Channel list */}
      <div className="channel-panel">
        <div className="sidebar-header">
          <span className="server-icon">
            {activeServer?.name?.charAt(0)?.toUpperCase() || "?"}
          </span>
          <span style={{ flex: 1 }}>{activeServer?.name || "No Server"}</span>
          {isAdmin && activeServer && (
            <button
              className="admin-toggle-btn"
              onClick={() => setShowAdmin(!showAdmin)}
              title="Server Settings"
            >
              ⚙
            </button>
          )}
        </div>

        {showCreate && (
          <form className="create-server-form" onSubmit={handleCreateServer}>
            <input
              type="text"
              placeholder="Server name"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              autoFocus
            />
            <button type="submit" disabled={!newServerName.trim()}>
              Create
            </button>
          </form>
        )}

        {showAdmin && activeServer ? (
          <div className="admin-panel">
            {adminError && <div className="admin-error">{adminError}</div>}

            <div className="admin-section">
              <div className="admin-section-title">Invite Code</div>
              {activeServer.invite_code ? (
                <div className="invite-row">
                  <code className="invite-code-value">{activeServer.invite_code}</code>
                  <button className="admin-btn" onClick={handleRegenerateInvite}>Regenerate</button>
                  <button className="admin-btn danger" onClick={handleRevokeInvite}>Revoke</button>
                </div>
              ) : (
                <div className="invite-row">
                  <span style={{ color: "#72767d", fontSize: 13 }}>No invite code</span>
                  <button className="admin-btn" onClick={handleRegenerateInvite}>Generate</button>
                </div>
              )}
            </div>

            <div className="admin-section">
              <div className="admin-section-title">Privacy</div>
              <div className="privacy-row">
                <span className="privacy-label">
                  {activeServer.is_public ? "Public" : "Private"}
                  <span className="privacy-hint">
                    {activeServer.is_public
                      ? "Anyone can find and join this server"
                      : "Only members with an invite code can join"}
                  </span>
                </span>
                <button
                  className={`privacy-toggle ${activeServer.is_public ? "public" : "private"}`}
                  onClick={handleTogglePrivacy}
                  title={activeServer.is_public ? "Make private" : "Make public"}
                >
                  {activeServer.is_public ? "Public" : "Private"}
                </button>
              </div>
            </div>

            <div className="admin-section">
              <div className="admin-section-title">Members ({members.length})</div>
              <ul className="member-list">
                {members.map((m) => (
                  <li key={m.id} className="member-item">
                    <span className="member-name">
                      {m.username}
                      {m.role !== "member" && (
                        <span className={`role-badge ${m.role}`}>{m.role}</span>
                      )}
                    </span>
                    {m.role !== "owner" && (isOwner || (isAdmin && m.role === "member")) && m.id !== user.id && (
                      <button className="kick-btn" onClick={() => handleKick(m.id, m.username)} title="Kick">
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {isOwner && (
              <div className="admin-section">
                <button className="admin-btn danger full-width" onClick={handleDeleteServer}>
                  Delete Server
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {activeServer?.invite_code && (
              <div className="invite-code-display">
                Invite code: <code>{activeServer.invite_code}</code>
              </div>
            )}

            {(textChannels.length > 0 || (isAdmin && activeServer)) && (
              <div className="channel-group">
                <div className="channel-group-title">
                  Text Channels
                  {isAdmin && activeServer && (
                    <button
                      className="channel-add-btn"
                      onClick={() => openNewChannelForm("text")}
                      title="New text channel"
                    >
                      +
                    </button>
                  )}
                </div>
                {newChannelType === "text" && (
                  <form className="new-channel-form" onSubmit={handleCreateChannel}>
                    <input
                      ref={channelInputRef}
                      type="text"
                      placeholder="channel-name"
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && cancelNewChannel()}
                      maxLength={32}
                    />
                    {channelCreateError && (
                      <div className="new-channel-error">{channelCreateError}</div>
                    )}
                    <div className="new-channel-actions">
                      <button type="submit" disabled={!newChannelName.trim()}>Create</button>
                      <button type="button" onClick={cancelNewChannel}>Cancel</button>
                    </div>
                  </form>
                )}
                <ul className="channel-list">
                  {textChannels.map((ch) => (
                    <li
                      key={ch.id}
                      className={`channel-item ${activeChannel?.id === ch.id ? "active" : ""}`}
                      onClick={() => onJoinChannel(ch)}
                    >
                      <span className="channel-icon">#</span>
                      <span style={{ flex: 1 }}>{ch.name}</span>
                      {isAdmin && (
                        <button
                          className="channel-delete-btn"
                          onClick={(e) => handleDeleteChannel(e, ch.id)}
                          title="Delete channel"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(voiceChannels.length > 0 || (isAdmin && activeServer)) && (
              <div className="channel-group">
                <div className="channel-group-title">
                  Voice Channels
                  {isAdmin && activeServer && (
                    <button
                      className="channel-add-btn"
                      onClick={() => openNewChannelForm("voice")}
                      title="New voice channel"
                    >
                      +
                    </button>
                  )}
                </div>
                {newChannelType === "voice" && (
                  <form className="new-channel-form" onSubmit={handleCreateChannel}>
                    <input
                      ref={channelInputRef}
                      type="text"
                      placeholder="channel-name"
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && cancelNewChannel()}
                      maxLength={32}
                    />
                    {channelCreateError && (
                      <div className="new-channel-error">{channelCreateError}</div>
                    )}
                    <div className="new-channel-actions">
                      <button type="submit" disabled={!newChannelName.trim()}>Create</button>
                      <button type="button" onClick={cancelNewChannel}>Cancel</button>
                    </div>
                  </form>
                )}
                <ul className="channel-list">
                  {voiceChannels.map((ch) => (
                    <li
                      key={ch.id}
                      className={`channel-item ${activeChannel?.id === ch.id ? "active" : ""}${connectedVoiceChannel?.id === ch.id ? " voice-connected" : ""}`}
                      onClick={() => onJoinChannel(ch)}
                    >
                      <span className="channel-icon">🔊</span>
                      <span style={{ flex: 1 }}>{ch.name}</span>
                      {connectedVoiceChannel?.id === ch.id && (
                        <span className="voice-connected-badge" title="Connected">&#x25CF;</span>
                      )}
                      {isAdmin && (
                        <button
                          className="channel-delete-btn"
                          onClick={(e) => handleDeleteChannel(e, ch.id)}
                          title="Delete channel"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!activeServer && (
              <div className="channel-group">
                <p style={{ padding: "8px 16px", color: "#72767d", fontSize: 13 }}>
                  Create or join a server to get started.
                </p>
              </div>
            )}
          </>
        )}

        <div className="sidebar-user">
          <span className="user-avatar">
            {user?.username?.charAt(0)?.toUpperCase() || "?"}
          </span>
          <span className="user-name">{user?.username}</span>
          <button className="logout-btn" onClick={logout} title="Log out">
            ⏻
          </button>
        </div>
      </div>
      {showBrowser && (
        <ServerBrowser onClose={() => setShowBrowser(false)} />
      )}
    </nav>
    </>
  );
}
