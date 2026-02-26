import { createContext, useContext, useState, useCallback, useEffect } from "react";
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

  // Fetch servers when logged in
  useEffect(() => {
    if (!user) {
      setServers([]);
      setActiveServer(null);
      setChannels([]);
      setActiveChannel(null);
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
    setIsConnected(false);
  }, []);

  const selectChannel = useCallback((channel) => {
    setActiveChannel(channel);
    setIsConnected(false);
  }, []);

  const refreshServers = useCallback(async () => {
    const data = await fetchServers();
    setServers(data.servers || []);
    return data.servers;
  }, []);

  const refreshChannels = useCallback(async () => {
    if (!activeServer) return;
    const data = await fetchChannels(activeServer.id);
    setChannels(data.channels || []);
  }, [activeServer]);

  const textChannels = channels.filter((ch) => ch.type === "text");
  const voiceChannels = channels.filter((ch) => ch.type === "voice");

  return (
    <AppContext.Provider
      value={{
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
        refreshServers,
        refreshChannels,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
