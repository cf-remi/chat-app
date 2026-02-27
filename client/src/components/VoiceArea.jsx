import { useState, useEffect } from "react";
import {
  RtkGrid,
  RtkMicToggle,
  RtkCameraToggle,
  RtkScreenShareToggle,
  RtkScreenshareView,
  RtkParticipantsAudio,
} from "@cloudflare/realtimekit-react-ui";

export default function VoiceArea({
  meeting,
  onOpenSidebar,
  minimized = false,
  channelName = "Voice",
  onLeave,
  onExpand,
}) {
  const [screenSharer, setScreenSharer] = useState(null);

  useEffect(() => {
    if (!meeting) return;

    const handleScreenShareUpdate = (participant) => {
      if (participant.screenShareEnabled) {
        setScreenSharer(participant);
      } else {
        setScreenSharer((prev) => (prev?.id === participant.id ? null : prev));
      }
    };

    const handleScreenShareEnded = (participant) => {
      setScreenSharer((prev) => (prev?.id === participant.id ? null : prev));
    };

    meeting.participants.joined.forEach((p) => {
      if (p.screenShareEnabled) setScreenSharer(p);
    });
    if (meeting.self?.screenShareEnabled) setScreenSharer(meeting.self);

    meeting.participants.joined.on("screenShareUpdate", handleScreenShareUpdate);
    meeting.self?.on("screenShareUpdate", handleScreenShareUpdate);
    meeting.participants.joined.on("participantLeft", handleScreenShareEnded);

    return () => {
      meeting.participants.joined.off("screenShareUpdate", handleScreenShareUpdate);
      meeting.self?.off("screenShareUpdate", handleScreenShareUpdate);
      meeting.participants.joined.off("participantLeft", handleScreenShareEnded);
    };
  }, [meeting]);

  const handleLeave = () => {
    if (onLeave) onLeave();
  };

  // Minimized floating bar — audio keeps playing, user can disconnect or expand
  if (minimized) {
    return (
      <div className="voice-bar-minimized">
        <RtkParticipantsAudio meeting={meeting} />
        <div className="voice-bar-info" onClick={onExpand} role="button" tabIndex={0}>
          <span className="voice-bar-icon">&#x1F50A;</span>
          <span className="voice-bar-channel">#{channelName}</span>
        </div>
        <div className="voice-bar-controls">
          <RtkMicToggle meeting={meeting} size="sm" />
          <button className="leave-btn leave-btn-sm" onClick={handleLeave}>
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  // Full voice UI
  return (
    <div className="voice-area">
      <RtkParticipantsAudio meeting={meeting} />
      <div className="voice-header">
        <button className="sidebar-hamburger" onClick={onOpenSidebar} aria-label="Open sidebar">
          &#x2630;
        </button>
        <span>&#x1F50A;</span>
        {channelName}
      </div>

      <div className="voice-content">
        {screenSharer && (
          <div className="screenshare-container">
            <RtkScreenshareView meeting={meeting} />
          </div>
        )}

        <div className={`voice-grid ${screenSharer ? "voice-grid-small" : ""}`}>
          {meeting ? (
            <RtkGrid meeting={meeting} size="sm" />
          ) : (
            <div className="voice-empty">Connecting to voice...</div>
          )}
        </div>
      </div>

      <div className="voice-controls">
        <RtkMicToggle meeting={meeting} size="sm" />
        <RtkCameraToggle meeting={meeting} size="sm" />
        <RtkScreenShareToggle meeting={meeting} size="sm" />
        <button className="leave-btn" onClick={handleLeave}>
          Disconnect
        </button>
      </div>
    </div>
  );
}
