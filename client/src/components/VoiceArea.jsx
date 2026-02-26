import { useState, useEffect, useCallback, useRef } from "react";
import { useAppContext } from "../context/AppContext.jsx";
import {
  RtkGrid,
  RtkMicToggle,
  RtkCameraToggle,
  RtkScreenShareToggle,
  RtkScreenshareView,
  RtkParticipantsAudio,
} from "@cloudflare/realtimekit-react-ui";

export default function VoiceArea({ meeting, onOpenSidebar }) {
  const { activeChannel, selectChannel, setIsConnected } = useAppContext();
  const [screenSharer, setScreenSharer] = useState(null);
  const audioEls = useRef(new Map());

  // Manual audio playback for Firefox autoplay policy
  useEffect(() => {
    if (!meeting) return;

    function playParticipantAudio(participant) {
      const track = participant.audioTrack;
      if (!track) return;

      let el = audioEls.current.get(participant.id);
      if (!el) {
        el = document.createElement("audio");
        el.autoplay = true;
        el.id = `audio-${participant.id}`;
        audioEls.current.set(participant.id, el);
      }

      const stream = new MediaStream([track]);
      el.srcObject = stream;
      el.play().catch(() => {});
    }

    function removeParticipantAudio(participant) {
      const el = audioEls.current.get(participant.id);
      if (el) {
        el.srcObject = null;
        audioEls.current.delete(participant.id);
      }
    }

    function handleAudioUpdate(participant) {
      if (participant.audioEnabled && participant.audioTrack) {
        playParticipantAudio(participant);
      } else {
        const el = audioEls.current.get(participant.id);
        if (el) el.srcObject = null;
      }
    }

    // Play audio for participants already in the room
    meeting.participants.joined.forEach((p) => {
      if (p.audioEnabled && p.audioTrack) playParticipantAudio(p);
    });

    meeting.participants.joined.on("participantJoined", (p) => {
      if (p.audioEnabled && p.audioTrack) playParticipantAudio(p);
    });
    meeting.participants.joined.on("audioUpdate", handleAudioUpdate);
    meeting.participants.joined.on("participantLeft", removeParticipantAudio);

    return () => {
      meeting.participants.joined.off("participantJoined", playParticipantAudio);
      meeting.participants.joined.off("audioUpdate", handleAudioUpdate);
      meeting.participants.joined.off("participantLeft", removeParticipantAudio);
      audioEls.current.forEach((el) => { el.srcObject = null; });
      audioEls.current.clear();
    };
  }, [meeting]);

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

  const handleLeave = async () => {
    try {
      if (meeting) {
        await meeting.leaveRoom();
      }
    } catch (err) {
      console.error("Error leaving room:", err);
    }
    setIsConnected(false);
    selectChannel(null);
  };

  return (
    <div className="voice-area">
      <RtkParticipantsAudio meeting={meeting} />
      <div className="voice-header">
        <button className="sidebar-hamburger" onClick={onOpenSidebar} aria-label="Open sidebar">
          ☰
        </button>
        <span>🔊</span>
        {activeChannel?.name}
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
