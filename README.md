# Discord RTK

A Discord-like chat and voice/video application built with **React** and **Cloudflare RealtimeKit SDK**, with a **Node.js/Express** backend for API authentication.

---

## Prerequisites

- **Node.js** >= 18
- A **Cloudflare account** with Realtime permissions

## Cloudflare Setup

### 1. Get your Account ID

- Log in to [dash.cloudflare.com](https://dash.cloudflare.com)
- Your **Account ID** is on the right side of the dashboard overview page

### 2. Create an API Token

- Go to **My Profile → API Tokens → Create Token**
- Choose **Create Custom Token**
- Add permission: **Realtime** / **Realtime Admin** (Edit)
- Set the account resource to your account
- Copy the generated Bearer token

### 3. Create a RealtimeKit App & Preset

- Navigate to **Realtime → RealtimeKit** in the dashboard
- Click **Create App** — note the **App ID**
- Under the app, go to **Presets** and create one (e.g. `group_call_host`) with:
  - Chat enabled
  - Audio enabled
  - Video enabled
- Note the exact **preset name**

### 4. Configure environment variables

```bash
cp server/.env.example server/.env
```

Edit `server/.env` with your values:

```
CF_ACCOUNT_ID=your-account-id
CF_API_TOKEN=your-bearer-token
CF_APP_ID=your-realtimekit-app-id
RTK_PRESET_NAME=group_call_host
```

---

## Running the app

### Backend

```bash
cd server
npm install
npm run dev
```

Server starts on `http://localhost:3001`.

### Frontend

```bash
cd client
npm install
npm run dev
```

App opens at `http://localhost:5173`.

---

## Architecture

| Discord Concept       | RealtimeKit Mapping |
| --------------------- | ------------------- |
| Server / Channel      | Meeting             |
| User                  | Participant         |
| Roles / Permissions   | Preset              |

- **Text channels** use RealtimeKit's built-in chat (`meeting.chat`)
- **Voice channels** use RealtimeKit's audio/video with `RtkGrid`, `RtkMicToggle`, `RtkCameraToggle`
- The Express backend creates meetings and adds participants via the Cloudflare v4 REST API, returning an `authToken` to the React frontend
- Chat messages are **session-scoped** (no persistence beyond the meeting session)
