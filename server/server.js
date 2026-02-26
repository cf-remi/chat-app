import "dotenv/config";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const {
  CF_ACCOUNT_ID,
  CF_API_TOKEN,
  CF_APP_ID,
  RTK_PRESET_NAME = "group_call_host",
  PORT = 3001,
} = process.env;

const CF_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/realtime/kit/${CF_APP_ID}`;

function cfHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${CF_API_TOKEN}`,
  };
}

// POST /api/rooms/join
// Body: { roomName: string, displayName: string }
// Returns: { authToken: string, meetingId: string }
app.post("/api/rooms/join", async (req, res) => {
  try {
    const { roomName, displayName } = req.body;

    if (!roomName || !displayName) {
      return res
        .status(400)
        .json({ error: "roomName and displayName are required" });
    }

    // 1. Create a meeting (acts as a "channel")
    const meetingRes = await fetch(`${CF_BASE_URL}/meetings`, {
      method: "POST",
      headers: cfHeaders(),
      body: JSON.stringify({ title: roomName }),
    });

    const meetingData = await meetingRes.json();

    if (!meetingRes.ok) {
      console.error("Failed to create meeting:", meetingData);
      return res
        .status(meetingRes.status)
        .json({ error: "Failed to create meeting", details: meetingData });
    }

    const meetingId = meetingData.result?.id ?? meetingData.data?.id;

    if (!meetingId) {
      console.error("No meeting ID in response:", meetingData);
      return res.status(500).json({ error: "No meeting ID returned" });
    }

    // 2. Add a participant to the meeting
    const participantRes = await fetch(
      `${CF_BASE_URL}/meetings/${meetingId}/participants`,
      {
        method: "POST",
        headers: cfHeaders(),
        body: JSON.stringify({
          name: displayName,
          preset_name: RTK_PRESET_NAME,
          custom_participant_id: uuidv4(),
        }),
      }
    );

    const participantData = await participantRes.json();

    if (!participantRes.ok) {
      console.error("Failed to add participant:", participantData);
      return res.status(participantRes.status).json({
        error: "Failed to add participant",
        details: participantData,
      });
    }

    const authToken =
      participantData.result?.token ?? participantData.data?.token;

    if (!authToken) {
      console.error("No token in response:", participantData);
      return res.status(500).json({ error: "No auth token returned" });
    }

    res.json({ authToken, meetingId });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
