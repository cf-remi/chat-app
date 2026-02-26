import type { ChatMessage, Env } from "../types.js";
import { sendPushNotification } from "../push/webpush.js";

const MAX_STORED_MESSAGES = 500;

// Tags encode user metadata as "userId:username" so it survives hibernation
function encodeTags(userId: string, username: string): string[] {
  return [`${userId}:${username}`];
}

function decodeTags(state: DurableObjectState, ws: WebSocket): { userId: string; username: string } {
  const tagList: string[] = state.getTags(ws);
  const tag = tagList[0] || "";
  const idx = tag.indexOf(":");
  return {
    userId: idx > 0 ? tag.slice(0, idx) : "",
    username: idx > 0 ? tag.slice(idx + 1) : "",
  };
}

export class ChatRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/websocket") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const userId = url.searchParams.get("userId");
      const username = url.searchParams.get("username");

      if (!userId || !username) {
        return new Response("userId and username required", { status: 400 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Use Hibernation API: tags survive hibernation cycles
      this.state.acceptWebSocket(server, encodeTags(userId, username));

      // Send message history to the new connection
      const history = await this.getMessages();
      server.send(JSON.stringify({ type: "history", messages: history }));

      // Broadcast join notification
      this.broadcast(
        JSON.stringify({
          type: "system",
          message: `${username} joined the channel`,
          timestamp: Date.now(),
        }),
        server
      );

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  // Called by the runtime when a hibernated DO receives a WebSocket message
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      const data = JSON.parse(raw);
      const { userId, username } = decodeTags(this.state, ws);

      if (data.type === "message") {
        if (typeof data.content !== "string" || !data.content.trim()) {
          ws.send(JSON.stringify({ type: "error", message: "Message cannot be empty" }));
          return;
        }

        const content = data.content.slice(0, 2000);

        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          channelId: data.channelId || "",
          userId,
          username,
          content,
          timestamp: Date.now(),
        };

        await this.storeMessage(msg);

        this.broadcast(
          JSON.stringify({ type: "message", message: msg }),
          null
        );

        // Send push notifications to offline members (fire-and-forget)
        this.sendPushToOfflineMembers(msg).catch(() => {});
      }
    } catch (err) {
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid message format" })
      );
    }
  }

  // Called by the runtime when a WebSocket connection closes
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const { username } = decodeTags(this.state, ws);
    ws.close(code, "Durable Object is closing WebSocket");

    if (username) {
      this.broadcast(
        JSON.stringify({
          type: "system",
          message: `${username} left the channel`,
          timestamp: Date.now(),
        }),
        null
      );
    }
  }

  // Called by the runtime on WebSocket error
  async webSocketError(ws: WebSocket, error: unknown) {
    ws.close(1011, "WebSocket error");
  }

  private broadcast(data: string, exclude: WebSocket | null) {
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        if (ws !== exclude) {
          ws.send(data);
        }
      } catch {
        // Socket is dead; runtime will clean it up
      }
    }
  }

  private getOnlineUserIds(): Set<string> {
    const sockets = this.state.getWebSockets();
    const ids = new Set<string>();
    for (const ws of sockets) {
      const { userId } = decodeTags(this.state, ws);
      if (userId) ids.add(userId);
    }
    return ids;
  }

  private async getMessages(): Promise<ChatMessage[]> {
    const stored = await this.state.storage.get<ChatMessage[]>("messages");
    return stored || [];
  }

  private async sendPushToOfflineMembers(msg: ChatMessage) {
    if (!msg.channelId) return;

    // Get the server_id for this channel
    const channel = await this.env.DB.prepare(
      "SELECT server_id FROM channels WHERE id = ?"
    )
      .bind(msg.channelId)
      .first<{ server_id: string }>();

    if (!channel) return;

    // Get currently connected user IDs
    const onlineUserIds = this.getOnlineUserIds();

    // Get push subscriptions for server members who are NOT online
    const onlineList = [...onlineUserIds];
    const placeholders = onlineList.length > 0
      ? ` AND ps.user_id NOT IN (${onlineList.map(() => "?").join(",")})`
      : "";

    // Binds: server_id (JOIN), sender userId (exclude sender), ...onlineUserIds (exclude online)
    const binds: string[] = [channel.server_id, msg.userId, ...onlineList];

    const { results } = await this.env.DB.prepare(
      `SELECT ps.endpoint, ps.p256dh, ps.auth, ps.id
       FROM push_subscriptions ps
       JOIN server_members sm ON sm.user_id = ps.user_id AND sm.server_id = ?
       WHERE ps.user_id != ?${placeholders}`
    )
      .bind(...binds)
      .all<{ endpoint: string; p256dh: string; auth: string; id: string }>();

    if (!results?.length) return;

    const payload = {
      title: `${msg.username}`,
      body: msg.content.length > 100 ? msg.content.slice(0, 100) + "..." : msg.content,
      tag: `channel-${msg.channelId}`,
      url: `/channels/${msg.channelId}`,
      channelId: msg.channelId,
    };

    const expiredIds: string[] = [];

    await Promise.allSettled(
      results.map(async (sub) => {
        const ok = await sendPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
          this.env.VAPID_PUBLIC_KEY,
          this.env.VAPID_PRIVATE_KEY,
          this.env.VAPID_CONTACT
        );
        if (!ok) expiredIds.push(sub.id);
      })
    );

    // Clean up expired subscriptions
    if (expiredIds.length > 0) {
      await Promise.allSettled(
        expiredIds.map((id) =>
          this.env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(id).run()
        )
      );
    }
  }

  private async storeMessage(msg: ChatMessage) {
    const messages = await this.getMessages();
    messages.push(msg);

    // Keep only the last N messages
    const trimmed =
      messages.length > MAX_STORED_MESSAGES
        ? messages.slice(messages.length - MAX_STORED_MESSAGES)
        : messages;

    await this.state.storage.put("messages", trimmed);
  }
}
