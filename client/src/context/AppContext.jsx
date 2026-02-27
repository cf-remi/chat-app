import { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { useAuth } from "./AuthContext.jsx";
import { fetchServers, fetchChannels } from "../api.js";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { user } = useAuth();
  const [servers, setServers] = useState([]);
  const [activeServer, setActiveServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedVoiceChannel, setConnectedVoiceChannel] = useState(null);

  // Fetch servers when logged in
  useEffect(() => {
    if (!user) {
      setServers([]);
      setActiveServer(null);
      setChannels([]);
      setActiveChannel(null);
      setIsConnected(false);
      setConnectedVoiceChannel(null);
      return;
    }
    fetchServers()
      .then((data) => {
        setServers(data.servers || []);
        if (data.servers?.length > 0 && !activeServer) {
          setActiveServer(data.servers[0]);
        }
      })
      .catch((err) => console.error("Failed to fetch servers:", err));
  }, [user]);

  // Fetch channels when active server changes
  useEffect(() => {
    if (!activeServer) {
      setChannels([]);
      return;
    }
    fetchChannels(activeServer.id)
      .then((data) => setChannels(data.channels || []))
      .catch((err) => console.error("Failed to fetch channels:", err));
  }, [activeServer]);

  const selectServer = useCallback((server) => {
    setActiveServer(server);
    setActiveChannel(null);
    // NOTE: Do NOT reset isConnected here — App.jsx handles voice cleanup
    // when it detects the server changed while in a call.
  }, []);

  const selectChannel = useCallback((channel) => {
    setActiveChannel(channel);
    // NOTE: Do NOT reset isConnected here — the user can stay in voice
    // while browsing text channels.
  }, []);

  const refreshServers = useCallback(async () => {
    const data = await fetchServers();
    const list = data.servers || [];
    setServers(list);
    // Sync activeServer with fresh data so fields like is_public stay current
    setActiveServer((prev) => {
      if (!prev) return prev;
      return list.find((s) => s.id === prev.id) || prev;
    });
    return list;
  }, []);

  const refreshChannels = useCallback(async () => {
    if (!activeServer) return;
    const data = await fetchChannels(activeServer.id);
    setChannels(data.channels || []);
  }, [activeServer]);

  const textChannels = useMemo(() => channels.filter((ch) => ch.type === "text"), [channels]);
  const voiceChannels = useMemo(() => channels.filter((ch) => ch.type === "voice"), [channels]);

  const value = useMemo(
    () => ({
      servers,
      activeServer,
      selectServer,
      channels,
      textChannels,
      voiceChannels,
      activeChannel,
      selectChannel,
      isConnected,
      setIsConnected,
      connectedVoiceChannel,
      setConnectedVoiceChannel,
      refreshServers,
      refreshChannels,
    }),
    [
      servers,
      activeServer,
      selectServer,
      channels,
      textChannels,
      voiceChannels,
      activeChannel,
      selectChannel,
      isConnected,
      connectedVoiceChannel,
      refreshServers,
      refreshChannels,
    ]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
