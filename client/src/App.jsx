import { useCallback, useState, useRef, useEffect } from "react";
import {
  useRealtimeKitClient,
  RealtimeKitProvider,
} from "@cloudflare/realtimekit-react";
import { useAuth } from "./context/AuthContext.jsx";
import { useAppContext } from "./context/AppContext.jsx";
import { joinVoiceRoom, fetchChannels } from "./api.js";
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
    servers,
    selectServer,
    channels,
  } = useAppContext();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  usePushNotifications(user);

  // Handle deep-link navigation from push notification clicks
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = async (event) => {
      if (event.data?.type !== "NOTIFICATION_CLICK") return;
      // URL pattern: /channels/:channelId
      const match = (event.data.url || "").match(/\/channels\/([^/]+)/);
      if (!match) return;
      const channelId = match[1];

      // Try to find the channel in the already-loaded list
      let channel = channels.find((ch) => ch.id === channelId);

      if (!channel) {
        // Channel might belong to a different server — search across all servers
        for (const server of servers) {
          try {
            const data = await fetchChannels(server.id);
            const found = (data.channels || []).find((ch) => ch.id === channelId);
            if (found) {
              channel = found;
              selectServer(server);
              break;
            }
          } catch {
            // ignore per-server errors
          }
        }
      }

      if (channel) selectChannel(channel);
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [channels, servers, selectChannel, selectServer]);
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
      <Sidebar
        onJoinChannel={(ch) => { handleJoinChannel(ch); setSidebarOpen(false); }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
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
            <button className="sidebar-hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
              ☰
            </button>
            <h2>Welcome, {user.username}!</h2>
            <p>Select a channel from the sidebar to get started.</p>
          </div>
        )}

        {activeChannel?.type === "text" && (
          <ChatArea onOpenSidebar={() => setSidebarOpen(true)} />
        )}

        {isConnected && meeting && activeChannel?.type === "voice" && (
          <RealtimeKitProvider key={meetingKey} value={meeting}>
            <VoiceArea meeting={meeting} onOpenSidebar={() => setSidebarOpen(true)} />
          </RealtimeKitProvider>
        )}
      </main>
    </div>
  );
}
