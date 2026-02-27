import { Hono } from "hono";
import { authMiddleware } from "../auth/middleware.js";
import type { Env } from "../types.js";

const rtk = new Hono<{ Bindings: Env }>();

rtk.use("*", authMiddleware);

// Join a voice channel — creates/reuses a RealtimeKit meeting
rtk.post("/rooms/join", async (c) => {
  const userId = c.get("userId");
  const username = c.get("username");
  let channelId: string;
  try {
    ({ channelId } = await c.req.json<{ channelId: string }>());
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!channelId) {
    return c.json({ error: "channelId is required" }, 400);
  }

  // Look up the channel and check membership
  const channel = await c.env.DB.prepare(
    `SELECT ch.id, ch.name, ch.type, ch.meeting_id, ch.server_id
     FROM channels ch
     JOIN server_members sm ON sm.server_id = ch.server_id AND sm.user_id = ?
     WHERE ch.id = ?`
  )
    .bind(userId, channelId)
    .first<{ id: string; name: string; type: string; meeting_id: string | null; server_id: string }>();

  if (!channel) {
    return c.json({ error: "Channel not found or not a member" }, 404);
  }

  const cfBase = `https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/realtime/kit/${c.env.CF_APP_ID}`;
  const cfHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${c.env.CF_API_TOKEN}`,
  };

  let meetingId = channel.meeting_id;

  // Create a new meeting if one doesn't exist
  if (!meetingId) {
    const meetingRes = await fetch(`${cfBase}/meetings`, {
      method: "POST",
      headers: cfHeaders,
      body: JSON.stringify({ title: `${channel.name}-${channel.id}` }),
    });

    const meetingData = (await meetingRes.json()) as any;

    if (!meetingRes.ok) {
      return c.json({ error: "Failed to create meeting", details: meetingData }, 502);
    }

    meetingId = meetingData.result?.id ?? meetingData.data?.id;

    // Cache the meeting ID on the channel
    await c.env.DB.prepare("UPDATE channels SET meeting_id = ? WHERE id = ?")
      .bind(meetingId, channelId)
      .run();
  }

  // Add participant
  const participantRes = await fetch(`${cfBase}/meetings/${meetingId}/participants`, {
    method: "POST",
    headers: cfHeaders,
    body: JSON.stringify({
      name: username,
      preset_name: c.env.RTK_PRESET_NAME,
      custom_participant_id: userId,
    }),
  });

  const participantData = (await participantRes.json()) as any;

  if (!participantRes.ok) {
    // If meeting expired, clear it and retry
    if (participantRes.status === 404) {
      await c.env.DB.prepare("UPDATE channels SET meeting_id = NULL WHERE id = ?")
        .bind(channelId)
        .run();
      return c.json({ error: "Meeting expired, please retry" }, 409);
    }
    return c.json({ error: "Failed to add participant", details: participantData }, 502);
  }

  const authToken = participantData.result?.token ?? participantData.data?.token;

  if (!authToken) {
    console.error("RTK participant response missing token:", JSON.stringify(participantData));
    return c.json({ error: "No auth token returned from RTK" }, 500);
  }

  return c.json({ authToken, meetingId });
});

export default rtk;
