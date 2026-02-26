import { useState, useEffect } from "react";
import { browseServers, joinByInvite, joinServer } from "../api.js";
import { useAppContext } from "../context/AppContext.jsx";

export default function ServerBrowser({ onClose }) {
  const { refreshServers, selectServer } = useAppContext();
  const [tab, setTab] = useState("browse");
  const [publicServers, setPublicServers] = useState([]);
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tab === "browse") {
      browseServers()
        .then((data) => setPublicServers(data.servers || []))
        .catch((err) => console.error("Failed to browse servers:", err));
    }
  }, [tab]);

  const handleJoinPublic = async (serverId) => {
    setError("");
    try {
      await joinServer(serverId);
      const updated = await refreshServers();
      const joined = updated?.find((s) => s.id === serverId);
      if (joined) selectServer(joined);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleJoinByInvite = async (e) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setError("");
    setLoading(true);
    try {
      const data = await joinByInvite(inviteCode.trim());
      const updated = await refreshServers();
      const joined = updated?.find((s) => s.id === data.server?.id);
      if (joined) selectServer(joined);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Join a Server</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-tabs">
          <button
            className={`modal-tab ${tab === "browse" ? "active" : ""}`}
            onClick={() => { setTab("browse"); setError(""); }}
          >
            Browse Servers
          </button>
          <button
            className={`modal-tab ${tab === "invite" ? "active" : ""}`}
            onClick={() => { setTab("invite"); setError(""); }}
          >
            Invite Code
          </button>
        </div>

        {error && <div className="modal-error">{error}</div>}

        {tab === "browse" && (
          <div className="server-browse-list">
            {publicServers.length === 0 ? (
              <p className="server-browse-empty">No public servers to join right now.</p>
            ) : (
              publicServers.map((s) => (
                <div className="server-browse-item" key={s.id}>
                  <div className="server-browse-icon">
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="server-browse-info">
                    <span className="server-browse-name">{s.name}</span>
                    <span className="server-browse-members">
                      {s.member_count} member{s.member_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <button
                    className="server-browse-join"
                    onClick={() => handleJoinPublic(s.id)}
                  >
                    Join
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "invite" && (
          <form className="invite-form" onSubmit={handleJoinByInvite}>
            <p className="invite-hint">Enter an invite code to join a server</p>
            <input
              type="text"
              placeholder="e.g. a1b2c3d4"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoFocus
            />
            <button type="submit" disabled={!inviteCode.trim() || loading}>
              {loading ? "Joining..." : "Join Server"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
