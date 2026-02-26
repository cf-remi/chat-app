import { useState } from "react";
import { useAppContext } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { createServer } from "../api.js";
import ServerBrowser from "./ServerBrowser.jsx";

export default function Sidebar({ onJoinChannel }) {
  const {
    servers,
    activeServer,
    selectServer,
    textChannels,
    voiceChannels,
    activeChannel,
    refreshServers,
  } = useAppContext();
  const { user, logout } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [newServerName, setNewServerName] = useState("");

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

  return (
    <nav className="sidebar">
      {/* Server list */}
      <div className="server-list">
        {servers.map((s) => (
          <div
            key={s.id}
            className={`server-pill ${activeServer?.id === s.id ? "active" : ""}`}
            onClick={() => selectServer(s)}
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
          +
        </div>
        <div
          className="server-pill browse-server"
          onClick={() => setShowBrowser(true)}
          title="Browse / Join Server"
        >
          ⌕
        </div>
      </div>

      {/* Channel list */}
      <div className="channel-panel">
        <div className="sidebar-header">
          <span className="server-icon">
            {activeServer?.name?.charAt(0)?.toUpperCase() || "?"}
          </span>
          {activeServer?.name || "No Server"}
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

        {activeServer?.invite_code && (
          <div className="invite-code-display">
            Invite code: <code>{activeServer.invite_code}</code>
          </div>
        )}

        {textChannels.length > 0 && (
          <div className="channel-group">
            <div className="channel-group-title">Text Channels</div>
            <ul className="channel-list">
              {textChannels.map((ch) => (
                <li
                  key={ch.id}
                  className={`channel-item ${activeChannel?.id === ch.id ? "active" : ""}`}
                  onClick={() => onJoinChannel(ch)}
                >
                  <span className="channel-icon">#</span>
                  {ch.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {voiceChannels.length > 0 && (
          <div className="channel-group">
            <div className="channel-group-title">Voice Channels</div>
            <ul className="channel-list">
              {voiceChannels.map((ch) => (
                <li
                  key={ch.id}
                  className={`channel-item ${activeChannel?.id === ch.id ? "active" : ""}`}
                  onClick={() => onJoinChannel(ch)}
                >
                  <span className="channel-icon">🔊</span>
                  {ch.name}
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
  );
}
