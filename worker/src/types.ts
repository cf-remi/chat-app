export interface Env {
  DB: D1Database;
  CHAT_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  CF_APP_ID: string;
  RTK_PRESET_NAME: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  pw_hash: string;
  pw_salt: string;
  avatar_url: string | null;
  created_at: number;
}

export interface Server {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
}

export interface Channel {
  id: string;
  server_id: string;
  name: string;
  type: "text" | "voice";
  meeting_id: string | null;
  created_at: number;
}

export interface ServerMember {
  server_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: number;
}

export interface JwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  userId: string;
  username: string;
  content: string;
  timestamp: number;
}
