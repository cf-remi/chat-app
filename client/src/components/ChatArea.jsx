import { useState, useEffect, useRef, useCallback } from "react";
import { useAppContext } from "../context/AppContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useChatRoom } from "../hooks/useChatRoom.js";
import { uploadFile, getFileUrl } from "../api.js";

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB
const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo",
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
  "application/pdf", "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip", "application/x-zip-compressed",
]);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function AttachmentPreview({ attachment, onImageClick }) {
  const url = getFileUrl(attachment.fileId);
  const type = attachment.contentType;

  if (type.startsWith("image/")) {
    return (
      <button
        type="button"
        className="attachment-image-btn"
        onClick={() => onImageClick && onImageClick(url)}
        aria-label={`View ${attachment.filename}`}
      >
        <img src={url} alt={attachment.filename} className="attachment-image" loading="lazy" />
      </button>
    );
  }
  if (type.startsWith("video/")) {
    return (
      <video controls className="attachment-video" preload="metadata">
        <source src={url} type={type} />
      </video>
    );
  }
  if (type.startsWith("audio/")) {
    return (
      <audio controls className="attachment-audio" preload="metadata">
        <source src={url} type={type} />
      </audio>
    );
  }
  // Generic file download card
  return (
    <a href={url} download={attachment.filename} className="attachment-file-card">
      <span className="attachment-file-icon">📄</span>
      <span className="attachment-file-info">
        <span className="attachment-file-name">{attachment.filename}</span>
        <span className="attachment-file-size">{formatBytes(attachment.size)}</span>
      </span>
      <span className="attachment-download-icon">↓</span>
    </a>
  );
}

export default function ChatArea({ onOpenSidebar }) {
  const { activeChannel } = useAppContext();
  const { user } = useAuth();
  const { messages, connected, sendMessage } = useChatRoom(activeChannel?.id);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]); // files staged before sending
  const [pendingPreviews, setPendingPreviews] = useState([]); // object URLs parallel to pendingFiles
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  // Revoke object URLs whenever pendingPreviews changes (cleanup previous set)
  useEffect(() => {
    return () => {
      pendingPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pendingPreviews]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e) => { if (e.key === "Escape") setLightboxUrl(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl]);

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const validateFile = (file) => {
    if (!ALLOWED_TYPES.has(file.type)) return `"${file.name}" is not an allowed file type.`;
    if (file.size > MAX_FILE_SIZE) return `"${file.name}" exceeds the 1 GB limit.`;
    return null;
  };

  const stageFiles = useCallback((files) => {
    setUploadError("");
    const incoming = Array.from(files);
    for (const file of incoming) {
      const err = validateFile(file);
      if (err) { setUploadError(err); return; }
    }
    // Generate object URLs once for image previews
    const newPreviews = incoming.map((f) =>
      f.type.startsWith("image/") ? URL.createObjectURL(f) : null
    );
    setPendingFiles((prev) => [...prev, ...incoming]);
    setPendingPreviews((prev) => [...prev, ...newPreviews]);
  }, []);

  const removePendingFile = (idx) => {
    // Revoke the object URL for the removed file immediately
    const url = pendingPreviews[idx];
    if (url) URL.revokeObjectURL(url);
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
    setPendingPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleFileChange = (e) => {
    if (e.target.files?.length) stageFiles(e.target.files);
    e.target.value = "";
  };

  // Drag-and-drop
  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounterRef.current++;
    setDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragging(false);
  };
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragging(false);
    if (e.dataTransfer.files?.length) stageFiles(e.dataTransfer.files);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;
    if (!connected) return;

    setUploadError("");

    let attachments = [];

    if (pendingFiles.length > 0) {
      setUploading(true);
      setUploadProgress(0);
      try {
        for (let i = 0; i < pendingFiles.length; i++) {
          const file = pendingFiles[i];
          const result = await uploadFile(file, activeChannel.id, (pct) => {
            // Overall progress across files
            const base = (i / pendingFiles.length) * 100;
            setUploadProgress(Math.round(base + pct / pendingFiles.length));
          });
          attachments.push({
            fileId: result.fileId,
            filename: result.filename,
            contentType: result.contentType,
            size: result.size,
          });
        }
      } catch (err) {
        setUploadError(err.message || "Upload failed");
        setUploading(false);
        return;
      }
      setUploading(false);
      setUploadProgress(0);
    }

    sendMessage(text, attachments.length > 0 ? attachments : undefined);
    setInput("");
    // Clear pending files — previews are revoked by the useEffect cleanup
    setPendingFiles([]);
    setPendingPreviews([]);
  };

  const canSend = connected && !uploading && (input.trim() || pendingFiles.length > 0);

  return (
    <div
      className={`chat-area${dragging ? " drag-over" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">Drop files to upload</div>
        </div>
      )}

      {/* Lightbox overlay */}
      {lightboxUrl && (
        <div
          className="lightbox-overlay"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <button
            className="lightbox-close"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close"
          >
            ✕
          </button>
          <img
            src={lightboxUrl}
            className="lightbox-image"
            alt="Full size preview"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

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
          <div className="chat-empty">No messages yet. Say something!</div>
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
                    <div className="msg-header">
                      <span className="msg-author">{msg.username || "Unknown"}</span>
                      <span className="msg-time">{formatTime(msg.timestamp)}</span>
                    </div>
                    {msg.content && <div className="msg-text">{msg.content}</div>}
                    {msg.attachments?.length > 0 && (
                      <div className="msg-attachments">
                        {msg.attachments.map((att) => (
                          <AttachmentPreview
                            key={att.fileId}
                            attachment={att}
                            onImageClick={setLightboxUrl}
                          />
                        ))}
                      </div>
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

      <div className="chat-input-area">
        {/* Staged file previews */}
        {pendingFiles.length > 0 && (
          <div className="pending-files">
            {pendingFiles.map((file, i) => (
              <div key={i} className="pending-file">
                {pendingPreviews[i] ? (
                  <img src={pendingPreviews[i]} alt={file.name} className="pending-file-thumb" />
                ) : (
                  <span className="pending-file-icon">📄</span>
                )}
                <span className="pending-file-name">{file.name}</span>
                <span className="pending-file-size">{formatBytes(file.size)}</span>
                <button className="pending-file-remove" onClick={() => removePendingFile(i)} type="button">✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Upload progress bar */}
        {uploading && (
          <div className="upload-progress-bar-wrap">
            <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
            <span className="upload-progress-label">{uploadProgress}%</span>
          </div>
        )}

        {/* Upload error */}
        {uploadError && (
          <div className="upload-error">{uploadError}</div>
        )}

        <form className="chat-input-bar" onSubmit={handleSend}>
          <div className="chat-input-wrapper">
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!connected || uploading}
              title="Attach file"
            >
              📎
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <input
              type="text"
              placeholder={`Message #${activeChannel?.name || "channel"}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
              disabled={!connected || uploading}
            />
            <button
              type="submit"
              className={`send-btn${pendingFiles.length > 0 && !input.trim() ? " send-btn--files" : ""}`}
              disabled={!canSend}
              title={pendingFiles.length > 0 && !input.trim() ? "Send file(s)" : "Send message"}
            >
              {uploading ? `${uploadProgress}%` : "➤"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
