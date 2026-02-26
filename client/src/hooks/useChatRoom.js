import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export function useChatRoom(channelId) {
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!channelId) return;

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
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "history") {
          setMessages(data.messages || []);
        } else if (data.type === "message") {
          setMessages((prev) => [...prev, data.message]);
        } else if (data.type === "system") {
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-${Date.now()}`,
              userId: "system",
              username: "System",
              content: data.message,
              timestamp: data.timestamp,
              isSystem: true,
            },
          ]);
        }
      } catch (err) {
        console.error("Failed to parse WS message:", err);
      }
    });

    ws.addEventListener("close", () => {
      setConnected(false);
    });

    ws.addEventListener("error", (err) => {
      console.error("WebSocket error:", err);
    });

    return () => {
      ws.close();
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
