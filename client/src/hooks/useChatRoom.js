import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const MAX_CLIENT_MESSAGES = 500;
const MAX_RECONNECT_DELAY = 30000;

export function useChatRoom(channelId) {
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const retriesRef = useRef(0);
  const unmountedRef = useRef(false);

  useEffect(() => {
    if (!channelId) return;
    unmountedRef.current = false;
    retriesRef.current = 0;

    function connect() {
      if (unmountedRef.current) return;

      let wsUrl;
      if (API_BASE) {
        const base = API_BASE.replace(/^http/, "ws");
        wsUrl = `${base}/chat/${channelId}`;
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        wsUrl = `${protocol}//${window.location.host}/chat/${channelId}`;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setConnected(true);
        retriesRef.current = 0;
      });

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "history") {
            setMessages((data.messages || []).slice(-MAX_CLIENT_MESSAGES));
          } else if (data.type === "message") {
            setMessages((prev) => {
              const next = [...prev, data.message];
              return next.length > MAX_CLIENT_MESSAGES ? next.slice(-MAX_CLIENT_MESSAGES) : next;
            });
          } else if (data.type === "system") {
            setMessages((prev) => {
              const next = [
                ...prev,
                {
                  id: `sys-${Date.now()}`,
                  userId: "system",
                  username: "System",
                  content: data.message,
                  timestamp: data.timestamp,
                  isSystem: true,
                },
              ];
              return next.length > MAX_CLIENT_MESSAGES ? next.slice(-MAX_CLIENT_MESSAGES) : next;
            });
          }
        } catch (err) {
          console.error("Failed to parse WS message:", err);
        }
      });

      ws.addEventListener("close", () => {
        setConnected(false);
        if (!unmountedRef.current) {
          const delay = Math.min(1000 * 2 ** retriesRef.current, MAX_RECONNECT_DELAY);
          retriesRef.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      });

      ws.addEventListener("error", (err) => {
        console.error("WebSocket error:", err);
      });
    }

    connect();

    return () => {
      unmountedRef.current = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      setMessages([]);
      setConnected(false);
    };
  }, [channelId]);

  const sendMessage = useCallback(
    (content) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      wsRef.current.send(
        JSON.stringify({
          type: "message",
          channelId,
          content,
        })
      );
    },
    [channelId]
  );

  return { messages, connected, sendMessage };
}
