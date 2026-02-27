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
    activeServer,
    isConnected,
    setIsConnected,
    connectedVoiceChannel,
    setConnectedVoiceChannel,
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
  const meetingListenerCleanupRef = useRef(null);

  const cleanupMeetingListeners = useCallback(() => {
    if (meetingListenerCleanupRef.current) {
      try {
        meetingListenerCleanupRef.current();
      } catch {}
      meetingListenerCleanupRef.current = null;
    }
  }, []);

  // Leave voice cleanly — used by multiple paths
  const leaveVoice = useCallback(async () => {
    if (meetingRef.current) {
      cleanupMeetingListeners();
      try {
        await meetingRef.current.leaveRoom();
      } catch (e) {
        // ignore leave errors
      }
      meetingRef.current = null;
    }
    setIsConnected(false);
    setConnectedVoiceChannel(null);
  }, [cleanupMeetingListeners, setIsConnected, setConnectedVoiceChannel]);

  // Leave voice when switching to a different server
  const prevServerRef = useRef(activeServer?.id);
  useEffect(() => {
    if (activeServer?.id !== prevServerRef.current) {
      prevServerRef.current = activeServer?.id;
      if (isConnected) {
        leaveVoice();
      }
    }
  }, [activeServer, isConnected, leaveVoice]);

  // Cleanup meeting on unmount
  useEffect(() => {
    return () => {
      if (meetingRef.current) {
        cleanupMeetingListeners();
        try { meetingRef.current.leaveRoom(); } catch {}
        meetingRef.current = null;
      }
    };
  }, [cleanupMeetingListeners]);

  const handleJoinChannel = useCallback(
    async (channel) => {
      if (!user || !channel || joiningRef.current) return;

      // For text channels, just select — the WebSocket hook handles the rest.
      // Voice stays connected in the background.
      if (channel.type === "text") {
        selectChannel(channel);
        return;
      }

      // If clicking the voice channel we're already connected to, just view it
      if (isConnected && connectedVoiceChannel?.id === channel.id) {
        selectChannel(channel);
        return;
      }

      // For voice channels, go through RealtimeKit
      joiningRef.current = true;
      setJoining(true);
      setError(null);

      // Leave any existing meeting first
      if (meetingRef.current) {
        cleanupMeetingListeners();
        try {
          await meetingRef.current.leaveRoom();
        } catch (e) {
          // ignore leave errors
        }
        meetingRef.current = null;
        setIsConnected(false);
        setConnectedVoiceChannel(null);
      }

      selectChannel(channel);

      try {
        // Fetch token, auto-retry once on 409 (expired meeting)
        let joinData;
        try {
          joinData = await joinVoiceRoom(channel.id);
        } catch (err) {
          if (err.message?.includes("Meeting expired")) {
            joinData = await joinVoiceRoom(channel.id);
          } else {
            throw err;
          }
        }

        const { authToken } = joinData;

        if (!authToken) {
          throw new Error("No auth token received from server");
        }

        const isMobile =
          typeof window !== "undefined" &&
          (window.matchMedia("(max-width: 768px)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

        const mobilePortraitVideoConstraints = {
          width: { ideal: 720 },
          height: { ideal: 1280 },
          frameRate: { ideal: 24 },
        };

        const desktopLandscapeVideoConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24 },
        };

        const mtg = await initMeeting({
          authToken,
          defaults: {
            audio: false,
            video: false,
            mediaConfiguration: {
              video: isMobile ? mobilePortraitVideoConstraints : desktopLandscapeVideoConstraints,
            },
          },
        });

        // Add a long-lived roomLeft listener to keep global state in sync
        const onUnexpectedLeave = ({ reason }) => {
          console.warn("[RTK] Left room:", reason);
          setIsConnected(false);
          setConnectedVoiceChannel(null);
          meetingRef.current = null;
        };
        mtg.self.on("roomLeft", onUnexpectedLeave);

        // Mobile-first: whenever camera is enabled on mobile, re-apply portrait constraints.
        if (isMobile) {
          const applyPortrait = async () => {
            try {
              await mtg.self.updateVideoConstraints(mobilePortraitVideoConstraints);
            } catch (e) {
              console.warn("Failed to apply portrait video constraints:", e);
            }
          };

          const onVideoUpdate = ({ videoEnabled }) => {
            if (videoEnabled) {
              void applyPortrait();
            }
          };

          mtg.self.on("videoUpdate", onVideoUpdate);
          meetingListenerCleanupRef.current = () => {
            mtg.self.removeListener("videoUpdate", onVideoUpdate);
          };
        } else {
          meetingListenerCleanupRef.current = null;
        }

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Join timed out — check browser console and network tab for details")),
            15000
          );

          const onRoomLeft = ({ reason }) => {
            console.error("[RTK] roomLeft:", reason);
            clearTimeout(timeout);
            cleanup();
            reject(new Error(`Room left during join: ${reason}`));
          };
          const onMediaError = (err) => {
            console.error("[RTK] mediaPermissionError:", err);
          };
          const onRoomJoined = () => {
            clearTimeout(timeout);
            cleanup();
            resolve();
          };

          // Attach listeners
          mtg.self.on("roomLeft", onRoomLeft);
          mtg.self.on("mediaPermissionError", onMediaError);
          mtg.self.on("roomJoined", onRoomJoined);

          // Remove listeners after settlement to prevent leaks
          function cleanup() {
            mtg.self.removeListener("roomLeft", onRoomLeft);
            mtg.self.removeListener("mediaPermissionError", onMediaError);
            mtg.self.removeListener("roomJoined", onRoomJoined);
          }

          mtg.join().catch((err) => {
            clearTimeout(timeout);
            cleanup();
            reject(new Error(`join() rejected: ${err.message}`));
          });
        });

        meetingRef.current = mtg;
        setMeetingKey((k) => k + 1);
        setIsConnected(true);
        setConnectedVoiceChannel(channel);
      } catch (err) {
        console.error("Failed to join voice channel:", err);
        setError(err.message);
      } finally {
        setJoining(false);
        joiningRef.current = false;
      }
    },
    [
      user,
      initMeeting,
      setIsConnected,
      setConnectedVoiceChannel,
      selectChannel,
      isConnected,
      connectedVoiceChannel,
      cleanupMeetingListeners,
    ]
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
          <ChatArea key={activeChannel.id} onOpenSidebar={() => setSidebarOpen(true)} />
        )}

        {activeChannel?.type === "voice" && !isConnected && !joining && (
          <div className="welcome-screen">
            <button className="sidebar-hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
              ☰
            </button>
            <h2>#{activeChannel.name}</h2>
            <p>Click "Join" in the sidebar to connect to this voice channel.</p>
          </div>
        )}

        {isConnected && meeting && (
          <RealtimeKitProvider key={meetingKey} value={meeting}>
            <VoiceArea
              meeting={meeting}
              onOpenSidebar={() => setSidebarOpen(true)}
              minimized={activeChannel?.id !== connectedVoiceChannel?.id}
              channelName={connectedVoiceChannel?.name || "Voice"}
              onLeave={leaveVoice}
              onExpand={() => connectedVoiceChannel && selectChannel(connectedVoiceChannel)}
            />
          </RealtimeKitProvider>
        )}
      </main>
    </div>
  );
}
