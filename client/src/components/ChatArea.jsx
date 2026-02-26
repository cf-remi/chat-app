import { useState, useEffect, useRef } from "react";
import { useAppContext } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useChatRoom } from "../hooks/useChatRoom.js";

export default function ChatArea({ onOpenSidebar }) {
  const { activeChannel } = useAppContext();
  const { user } = useAuth();
  const { messages, connected, sendMessage } = useChatRoom(activeChannel?.id);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    setInput("");
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="chat-area">
      <div className="chat-header">
        <button className="sidebar-hamburger" onClick={onOpenSidebar} aria-label="Open sidebar">
          ☰
        </button>
        <span>#</span>
        {activeChannel?.name}
        {!connected && <span className="connecting-badge">connecting...</span>}
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            No messages yet. Say something!
          </div>
        )}
        {messages.map((msg, idx) => {
          const isOwn = !msg.isSystem && msg.userId === user?.id;
          return (
            <div
              className={`chat-message ${msg.isSystem ? "system-message" : ""} ${isOwn ? "own" : ""}`}
              key={msg.id || idx}
            >
              {!msg.isSystem && !isOwn && (
                <div className="msg-avatar">
                  {(msg.username || "?").charAt(0).toUpperCase()}
                </div>
              )}
              <div className="msg-body">
                {msg.isSystem ? (
                  <div className="msg-system">{msg.content}</div>
                ) : (
                  <>
                    {!isOwn && (
                      <div className="msg-header">
                        <span className="msg-author">{msg.username || "Unknown"}</span>
                        <span className="msg-time">{formatTime(msg.timestamp)}</span>
                      </div>
                    )}
                    <div className="msg-text">{msg.content}</div>
                    {isOwn && (
                      <div className="msg-time own-time">{formatTime(msg.timestamp)}</div>
                    )}
                  </>
                )}
              </div>
              {!msg.isSystem && isOwn && (
                <div className="msg-avatar own-avatar">
                  {(msg.username || "?").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-bar" onSubmit={handleSend}>
        <div className="chat-input-wrapper">
          <input
            type="text"
            placeholder={`Message #${activeChannel?.name || "channel"}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            disabled={!connected}
          />
          <button type="submit" disabled={!input.trim() || !connected}>
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
