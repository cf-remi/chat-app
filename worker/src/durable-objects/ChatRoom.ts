import type { ChatMessage, Env } from "../types.js";
import { sendPushNotification } from "../push/webpush.js";

const MAX_STORED_MESSAGES = 500;

interface Session {
  webSocket: WebSocket;
  userId: string;
  username: string;
}

export class ChatRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Session[] = [];

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

      this.handleSession(server, userId, username);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleSession(webSocket: WebSocket, userId: string, username: string) {
    webSocket.accept();

    const session: Session = { webSocket, userId, username };
    this.sessions.push(session);

    // Send message history to the new connection
    const history = await this.getMessages();
    webSocket.send(JSON.stringify({ type: "history", messages: history }));

    // Broadcast join notification
    this.broadcast(
      JSON.stringify({
        type: "system",
        message: `${username} joined the channel`,
        timestamp: Date.now(),
      }),
      session
    );

    webSocket.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data as string);

        if (data.type === "message") {
          if (typeof data.content !== "string" || !data.content.trim()) {
            webSocket.send(JSON.stringify({ type: "error", message: "Message cannot be empty" }));
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
        webSocket.send(
          JSON.stringify({ type: "error", message: "Invalid message format" })
        );
      }
    });

    webSocket.addEventListener("close", () => {
      this.sessions = this.sessions.filter((s) => s !== session);

      this.broadcast(
        JSON.stringify({
          type: "system",
          message: `${username} left the channel`,
          timestamp: Date.now(),
        }),
        null
      );
    });

    webSocket.addEventListener("error", () => {
      this.sessions = this.sessions.filter((s) => s !== session);
    });
  }

  private broadcast(data: string, exclude: Session | null) {
    this.sessions = this.sessions.filter((session) => {
      try {
        if (session !== exclude) {
          session.webSocket.send(data);
        }
        return true;
      } catch {
        return false;
      }
    });
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
    const onlineUserIds = new Set(this.sessions.map((s) => s.userId));

    // Get push subscriptions for server members who are NOT online
    const placeholders = onlineUserIds.size > 0
      ? ` AND ps.user_id NOT IN (${[...onlineUserIds].map(() => "?").join(",")})`
      : "";

    const binds = [channel.server_id, ...(onlineUserIds.size > 0 ? [...onlineUserIds] : [])];

    const { results } = await this.env.DB.prepare(
      `SELECT ps.endpoint, ps.p256dh, ps.auth, ps.id
       FROM push_subscriptions ps
       JOIN server_members sm ON sm.user_id = ps.user_id AND sm.server_id = ?
       WHERE ps.user_id != ?${placeholders}`
    )
      .bind(...[channel.server_id, msg.userId, ...binds.slice(1)])
      .all<{ endpoint: string; p256dh: string; auth: string; id: string }>();

    if (!results?.length) return;

    const payload = {
      title: `${msg.username}`,
      body: msg.content.length > 100 ? msg.content.slice(0, 100) + "..." : msg.content,
      tag: `channel-${msg.channelId}`,
      url: "/",
      channelId: msg.channelId,
    };

    const expiredIds: string[] = [];

    await Promise.allSettled(
      results.map(async (sub) => {
        const ok = await sendPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
          this.env.VAPID_PUBLIC_KEY,
          this.env.VAPID_PRIVATE_KEY
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
