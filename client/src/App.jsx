import { useCallback, useState, useRef } from "react";
import {
  useRealtimeKitClient,
  RealtimeKitProvider,
} from "@cloudflare/realtimekit-react";
import { useAuth } from "./context/AuthContext.jsx";
import { useAppContext } from "./context/AppContext.jsx";
import { joinVoiceRoom } from "./api.js";
import { usePushNotifications } from "./hooks/usePushNotifications.js";
import LoginScreen from "./components/LoginScreen.jsx";
import Sidebar from "./components/Sidebar.jsx";
import ChatArea from "./components/ChatArea.jsx";
import VoiceArea from "./components/VoiceArea.jsx";

export default function App() {
  const { user, loading } = useAuth();
  const {
    activeChannel,
    isConnected,
    setIsConnected,
    selectChannel,
  } = useAppContext();

  usePushNotifications(user);
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [meetingKey, setMeetingKey] = useState(0);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);
  const joiningRef = useRef(false);
  const meetingRef = useRef(null);

  const handleJoinChannel = useCallback(
    async (channel) => {
      if (!user || !channel || joiningRef.current) return;

      // For text channels, just select — the WebSocket hook handles the rest
      if (channel.type === "text") {
        selectChannel(channel);
        return;
      }

      // For voice channels, go through RealtimeKit
      joiningRef.current = true;
      setJoining(true);
      setError(null);

      // Leave any existing meeting first
      if (meetingRef.current) {
        try {
          await meetingRef.current.leaveRoom();
        } catch (e) {
          // ignore leave errors
        }
        meetingRef.current = null;
      }

      selectChannel(channel);

      try {
        const { authToken } = await joinVoiceRoom(channel.id);

        const mtg = await initMeeting({
          authToken,
          defaults: {
            audio: true,
            video: false,
          },
        });

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Join timed out")),
            15000
          );
          mtg.self.on("roomJoined", () => {
            clearTimeout(timeout);
            resolve();
          });
          mtg.join();
        });

        meetingRef.current = mtg;
        setMeetingKey((k) => k + 1);
        setIsConnected(true);
      } catch (err) {
        console.error("Failed to join voice channel:", err);
        setError(err.message);
      } finally {
        setJoining(false);
        joiningRef.current = false;
      }
    },
    [user, initMeeting, setIsConnected, selectChannel]
  );

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="app-layout">
      <Sidebar onJoinChannel={handleJoinChannel} />
      <main className="main-content">
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {joining && (
          <div className="loading-screen">
            <div className="spinner" />
            <p>Joining {activeChannel?.name}...</p>
          </div>
        )}

        {!activeChannel && !joining && (
          <div className="welcome-screen">
            <h2>Welcome, {user.username}!</h2>
            <p>Select a channel from the sidebar to get started.</p>
          </div>
        )}

        {activeChannel?.type === "text" && <ChatArea />}

        {isConnected && meeting && activeChannel?.type === "voice" && (
          <RealtimeKitProvider key={meetingKey} value={meeting}>
            <VoiceArea meeting={meeting} />
          </RealtimeKitProvider>
        )}
      </main>
    </div>
  );
}
