# GoodShab Chat

A Discord-like chat and voice/video application deployed at **[goodshab.com](https://goodshab.com)**. Built with **React** + **Cloudflare Workers** (Hono), using **Cloudflare D1** for persistence, **Durable Objects** for real-time WebSocket messaging, **R2** for file storage, and **Cloudflare RealtimeKit** for voice/video.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Setup](#setup)
  - [Cloudflare Dashboard Setup](#cloudflare-dashboard-setup)
  - [Local Development](#local-development)
  - [Database Initialization](#database-initialization)
  - [Secrets](#secrets)
- [Deployment](#deployment)
- [Authentication](#authentication)
- [File Uploads](#file-uploads)
- [Voice & Video](#voice--video)
- [Push Notifications](#push-notifications)
- [Security](#security)
- [Database Schema](#database-schema)

---

## Features

- **Servers & Channels** -- Create servers with text and voice channels, invite members via code, browse public servers
- **Real-time Messaging** -- WebSocket-based chat via Cloudflare Durable Objects with Hibernation API
- **Voice & Video Calls** -- Powered by Cloudflare RealtimeKit (Dyte-based), with mobile portrait video support
- **Voice While Browsing** -- Stay connected to a voice channel while navigating text channels; floating minimized voice bar
- **File Uploads** -- Images, videos, audio, and documents up to 75 MB direct / unlimited via presigned R2 URLs; drag-and-drop, inline previews, lightbox
- **Google & Apple SSO** -- OAuth 2.0 / OpenID Connect with automatic account linking when emails match
- **Push Notifications** -- Web Push via VAPID; offline delivery from Durable Objects
- **Server Privacy** -- Toggle servers between public (browsable) and private (invite-only)
- **Admin Tools** -- Kick members, regenerate/revoke invite codes, delete channels/servers, role badges
- **Mobile Responsive** -- Collapsible sidebar, safe area insets, touch-optimized targets, `dvh` viewport units
- **PWA** -- Installable Progressive Web App with service worker

---

## Architecture

```
Browser (React SPA)
  |
  |-- HTTPS ---------> Cloudflare Worker (Hono)
  |                      |-- D1 (SQLite) ......... users, servers, channels, memberships, files, push subs, oauth
  |                      |-- R2 ................... file storage (chat-app-files bucket)
  |                      |-- KV ................... rate limiting, OAuth state tokens, account-link tokens
  |                      |-- Durable Objects ...... ChatRoom (one per text channel, WebSocket hub)
  |                      |-- Cloudflare RTK API ... voice/video meeting creation & participant tokens
  |
  |-- WSS -----------> Durable Object (ChatRoom)
  |                      WebSocket Hibernation API, message broadcast, push notification dispatch
  |
  |-- RTK SDK -------> Cloudflare RealtimeKit (*.dyte.io)
                         Audio/video/screenshare via SFU
```

| Discord Concept     | Implementation                |
|---------------------|-------------------------------|
| Server              | `servers` table row           |
| Text Channel        | `channels` row + Durable Object (ChatRoom) |
| Voice Channel       | `channels` row + RTK Meeting  |
| User                | `users` table row             |
| Roles / Permissions | `server_members.role` (owner / admin / member) |
| DMs                 | Not yet implemented           |

---

## Tech Stack

| Layer       | Technology                                       |
|-------------|--------------------------------------------------|
| Frontend    | React 18, Vite 6, Cloudflare RealtimeKit React SDK |
| Backend     | Cloudflare Workers (Hono 4), TypeScript          |
| Database    | Cloudflare D1 (SQLite)                           |
| Realtime    | Durable Objects (WebSocket Hibernation API)      |
| Voice/Video | Cloudflare RealtimeKit                           |
| Storage     | Cloudflare R2                                    |
| Auth        | JWT (jose), bcrypt-equivalent (PBKDF2), Google/Apple OAuth |
| Rate Limit  | Cloudflare KV                                    |
| Push        | Web Push (VAPID)                                 |

---

## Prerequisites

- **Node.js** >= 18
- **Wrangler** >= 4.69.0 (`npm install -g wrangler` or use the project-local version)
- A **Cloudflare account** with:
  - Workers paid plan (for Durable Objects)
  - D1 database
  - R2 bucket
  - KV namespace
  - RealtimeKit app

---

## Project Structure

```
chat-app/
├── client/                          # React SPA (Vite)
│   ├── src/
│   │   ├── main.jsx                 # Entry point, ErrorBoundary + providers
│   │   ├── App.jsx                  # Main app shell, voice lifecycle, meeting management
│   │   ├── App.css                  # All styles (SSO, uploads, voice bar, mobile, etc.)
│   │   ├── api.js                   # HTTP client (fetch wrappers for all API endpoints)
│   │   ├── context/
│   │   │   ├── AuthContext.jsx      # Login/register/logout, exports setUser for OAuth
│   │   │   └── AppContext.jsx       # Servers, channels, active state, voice connection
│   │   ├── hooks/
│   │   │   ├── useChatRoom.js       # WebSocket connection to Durable Object
│   │   │   └── usePushNotifications.js
│   │   └── components/
│   │       ├── ChatArea.jsx         # Messages, file upload UI, attachments, lightbox
│   │       ├── Sidebar.jsx          # Server/channel list, admin panel, privacy toggle
│   │       ├── VoiceArea.jsx        # RTK meeting UI, minimized floating bar
│   │       ├── LoginScreen.jsx      # Email/password + Google/Apple SSO
│   │       ├── ServerBrowser.jsx    # Public server discovery
│   │       └── ErrorBoundary.jsx    # React error boundary
│   └── public/
│       └── sw.js                    # Service worker (push notifications)
│
├── worker/                          # Cloudflare Worker (Hono)
│   ├── wrangler.toml                # Bindings: D1, R2, KV, DO, routes, vars
│   ├── db/
│   │   └── schema.sql               # Full database schema
│   └── src/
│       ├── index.ts                 # App entry, middleware (CSRF, CSP, CORS), route mounting
│       ├── types.ts                 # TypeScript env bindings
│       ├── middleware/
│       │   └── rateLimit.ts         # KV-based rate limiter
│       ├── auth/
│       │   ├── router.ts            # /auth/* routes (register, login, logout, me)
│       │   ├── middleware.ts         # JWT cookie verification middleware
│       │   ├── jwt.ts               # Sign/verify JWT tokens
│       │   ├── passwords.ts         # PBKDF2 hash/verify (handles OAuth empty sentinel)
│       │   └── oauth.ts             # Google + Apple OAuth flows, account linking
│       ├── channels/
│       │   └── router.ts            # Server/channel CRUD, membership, invites, privacy
│       ├── durable-objects/
│       │   └── ChatRoom.ts          # WebSocket hub, hibernation, push dispatch
│       ├── files/
│       │   ├── router.ts            # Upload (direct + presigned), confirm, serve
│       │   └── s3signer.ts          # SigV4 presigned URL generator
│       ├── push/
│       │   └── router.ts            # Push subscription management
│       └── rtk/
│           └── router.ts            # RTK meeting/participant creation
│
└── server/                          # Legacy Express prototype (not used in production)
```

---

## Setup

### Cloudflare Dashboard Setup

#### 1. D1 Database

Create a D1 database named `chat-app` and note the **database ID**. Update `worker/wrangler.toml` if the ID differs.

#### 2. R2 Bucket

Create an R2 bucket named `chat-app-files`.

For presigned uploads (files > 75 MB), create an **S3-compatible API token** in the R2 dashboard:
- Note the **Access Key ID** and **Secret Access Key**
- Configure CORS on the bucket to allow PUT from your domain with `Content-Type` header

#### 3. KV Namespace

Create a KV namespace and note the **ID**. Update the `kv_namespaces` section in `wrangler.toml` if it differs. This is used for rate limiting, OAuth state tokens, and account-link tokens.

#### 4. RealtimeKit App

- Navigate to **Realtime > RealtimeKit** in the Cloudflare dashboard
- Create an app and note the **App ID**
- Create a preset named `group_call_host` with:
  - `canProduceAudio`: ALLOWED
  - `canProduceVideo`: ALLOWED
  - `canProduceScreenshare`: ALLOWED
  - `viewType`: GROUP_CALL (not AUDIO_ROOM)

#### 5. Google OAuth (optional)

- Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- Create an OAuth 2.0 Client ID (Web application)
- Add authorized redirect URI: `https://goodshab.com/auth/google/callback`

#### 6. Apple OAuth (optional)

- In [Apple Developer](https://developer.apple.com/account/resources/identifiers/list/serviceId):
  - Register a Services ID (e.g. `com.example.chat.web`)
  - Enable "Sign in with Apple", configure the domain and return URL: `https://goodshab.com/auth/apple/callback`
  - Create a key with "Sign in with Apple" enabled, download the `.p8` file
- Note: Apple's callback uses `form_post` response mode (POST with `Origin: https://appleid.apple.com`)

### Local Development

```bash
# Clone the repository
git clone <repo-url> && cd chat-app

# Install dependencies
cd client && npm install && cd ..
cd worker && npm install && cd ..

# Initialize local D1 database
cd worker && npm run db:init && cd ..

# Start the worker (serves both API and SPA)
cd worker && npm run dev
```

The dev server starts at `http://localhost:8787`. The worker serves the React SPA via Cloudflare Workers Assets.

### Database Initialization

For a fresh production database:

```bash
cd worker
npm run db:init:remote
```

This runs `schema.sql` against the remote D1 database.

### Secrets

All secrets are set via Wrangler from the `worker/` directory:

```bash
cd worker

# Required
npx wrangler secret put JWT_SECRET
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_APP_ID

# Push notifications
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_CONTACT          # e.g. "mailto:admin@goodshab.com"

# R2 presigned uploads (for files > 75 MB)
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY

# Google OAuth (optional)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# Apple OAuth (optional)
npx wrangler secret put APPLE_CLIENT_ID         # Services ID
npx wrangler secret put APPLE_TEAM_ID
npx wrangler secret put APPLE_KEY_ID
npx wrangler secret put APPLE_PRIVATE_KEY       # .p8 file contents, replace newlines with \n
```

> Never commit secrets. The `wrangler.toml` file only contains non-sensitive `[vars]`.

---

## Deployment

Build the client and deploy everything in one step:

```bash
cd client && npm run build && cd ../worker && npx wrangler deploy
```

The worker serves the React SPA via `[assets]` binding with `not_found_handling = "single-page-application"` and `run_worker_first = true` (so API routes are matched before falling through to the SPA).

The app is deployed to **goodshab.com** via Cloudflare custom domain routing.

---

## Authentication

### Email/Password

- **Register**: `POST /auth/register` -- username (2-32 alphanum/underscore), email, password (8-128 chars)
- **Login**: `POST /auth/login` -- email + password
- Passwords are hashed with PBKDF2 (SHA-256, 100k iterations, 128-bit salt)
- Auth state is stored in an `HttpOnly`, `Secure`, `SameSite=None` JWT cookie

### Google SSO

`GET /auth/google` redirects to Google's OAuth consent screen. After consent, Google redirects to `/auth/google/callback` which:
1. Exchanges the authorization code for tokens
2. Looks up the user by Google ID in `oauth_accounts`
3. If not found, checks for an existing user with the same email
4. If email matches, prompts the user to link accounts (via a time-limited KV token)
5. Otherwise, creates a new user and links the OAuth account

### Apple SSO

`GET /auth/apple` redirects to Apple's authorization page. Apple POSTs back to `/auth/apple/callback` with an authorization code and (on first consent) an `id_token` containing the user's name and email. The same find-or-create-or-link logic applies.

### Account Linking

When an OAuth login matches an existing email, the user is redirected to the login page with a `link_token` URL parameter. The UI shows a modal prompting them to enter their password to confirm the link. On success, the OAuth account is associated with their existing user record.

---

## File Uploads

Files are uploaded to Cloudflare R2 and served through the worker with auth + membership checks.

### Direct Upload (<=75 MB)

1. Client sends `POST /files/upload` with `multipart/form-data` (file + `channelId`)
2. Worker streams the file to R2, creates a `files` row with status `ready`
3. Returns the file metadata (id, filename, content_type, size)

### Presigned Upload (>75 MB)

1. Client sends `POST /files/presign` with `{ channelId, filename, contentType, size }`
2. Worker creates a `files` row with status `pending` and returns a presigned R2 PUT URL (SigV4)
3. Client uploads directly to R2 using the presigned URL
4. Client calls `POST /files/confirm` with the file ID
5. Worker verifies the object exists in R2, updates status to `ready`

### Serving Files

`GET /files/:fileId/download` -- requires authentication and server membership. Returns the file with appropriate `Content-Type` and `Content-Disposition` headers (filename quote-escaped for safety).

### Supported Previews

- **Images**: Inline preview with lightbox on click (jpg, png, gif, webp)
- **Video**: Inline `<video>` player
- **Audio**: Inline `<audio>` player
- **Other**: Download link with filename and size

---

## Voice & Video

Voice and video are powered by **Cloudflare RealtimeKit** (built on Dyte's SFU infrastructure).

### Join Flow

1. User clicks a voice channel
2. Client requests `POST /rtk/join` with the channel's meeting ID
3. Worker calls the Cloudflare RTK API to add the user as a participant, returns an `authToken`
4. Client initializes the RTK SDK with the auth token
5. On mobile, portrait camera constraints (720x1280, 24fps) are applied; desktop uses 1280x720

### Voice While Browsing

- Joining a voice channel sets `connectedVoiceChannel` in AppContext
- Navigating to other text channels or servers does not disconnect voice
- When viewing a different channel, the voice UI appears as a minimized floating bar with mic toggle and disconnect button
- Switching to a different server automatically disconnects voice
- The sidebar shows a green indicator on the active voice channel

### Unexpected Disconnect Handling

A persistent `roomLeft` listener is registered after joining to detect unexpected disconnects (network loss, server-side kick) and reset the global voice state.

---

## Push Notifications

Web Push notifications are delivered when a user is mentioned or a message arrives in a channel they belong to.

### Setup

- VAPID keys are configured via `VAPID_PUBLIC_KEY` (in `wrangler.toml` vars) and `VAPID_PRIVATE_KEY` (secret)
- The service worker (`public/sw.js`) handles push events and displays notifications

### Flow

1. Client subscribes via `POST /push/subscribe` with the PushSubscription JSON
2. When a message is sent in a ChatRoom Durable Object, it fetches push subscriptions for channel members
3. Push payloads are sent directly from the Durable Object using the Web Push protocol with VAPID authentication

---

## Security

### CSRF Protection

All mutating requests (POST, PUT, PATCH, DELETE) must include an `Origin` header matching the allowed origins (`goodshab.com`, `www.goodshab.com`). Apple's OAuth callback (which POSTs with `Origin: https://appleid.apple.com`) is exempted.

### Content Security Policy

A strict CSP is applied to all non-101 responses:
- `default-src 'self'`
- RTK SDK domains (`*.dyte.io`, `rtk-assets.realtime.cloudflare.com`, etc.) in `connect-src`, `script-src`, `style-src`
- `worker-src blob:`, `child-src blob:` for RTK Web Workers
- Google Fonts in `style-src` and `font-src`
- R2 storage domain in `connect-src` for presigned uploads

### Rate Limiting

KV-based sliding window rate limits:
- **Login**: 5 attempts per minute per IP
- **Register**: 3 per hour per IP
- **Join by invite**: 10 per minute per IP
- **OAuth account link**: 5 per minute per IP

Rate limit state falls back gracefully (allows the request) if KV is unavailable.

### Input Validation

- Username: 2-32 characters, alphanumeric + underscore only
- Email: standard format validation
- Password: 8-128 characters
- Server/channel names: <= 100 characters
- SVG uploads are blocked (both client-side and server-side)
- File download filenames are quote-escaped in `Content-Disposition`

### CORS

`Access-Control-Allow-Origin` is set to the request origin if it matches the allow list. `Access-Control-Max-Age: 86400` reduces preflight frequency.

### Cookies

- `HttpOnly`: prevents JavaScript access
- `Secure`: HTTPS only
- `SameSite=None`: required for cross-site scenarios
- `Path=/`: available to all routes

---

## Database Schema

### `users`
| Column     | Type | Notes |
|------------|------|-------|
| id         | TEXT | PK, random hex |
| username   | TEXT | UNIQUE, 2-32 chars |
| email      | TEXT | UNIQUE |
| pw_hash    | TEXT | PBKDF2 hash (empty string for OAuth-only users) |
| pw_salt    | TEXT | 128-bit salt (empty string for OAuth-only users) |
| avatar_url | TEXT | nullable |
| created_at | INTEGER | unix epoch |

### `oauth_accounts`
| Column           | Type | Notes |
|------------------|------|-------|
| id               | TEXT | PK |
| user_id          | TEXT | FK -> users |
| provider         | TEXT | 'google' or 'apple' |
| provider_user_id | TEXT | provider's unique user ID |
| created_at       | INTEGER | unix epoch |
| | | UNIQUE(provider, provider_user_id) |

### `servers`
| Column      | Type    | Notes |
|-------------|---------|-------|
| id          | TEXT    | PK |
| name        | TEXT    | |
| owner_id    | TEXT    | FK -> users |
| invite_code | TEXT    | UNIQUE, 16 hex chars |
| is_public   | INTEGER | 0 = private, 1 = public (default) |
| created_at  | INTEGER | unix epoch |

### `channels`
| Column     | Type | Notes |
|------------|------|-------|
| id         | TEXT | PK |
| server_id  | TEXT | FK -> servers (CASCADE) |
| name       | TEXT | |
| type       | TEXT | 'text' or 'voice' |
| meeting_id | TEXT | RTK meeting ID (voice channels) |
| created_at | INTEGER | unix epoch |

### `server_members`
| Column    | Type | Notes |
|-----------|------|-------|
| server_id | TEXT | PK (composite) |
| user_id   | TEXT | PK (composite) |
| role      | TEXT | 'owner', 'admin', or 'member' |
| joined_at | INTEGER | unix epoch |

### `files`
| Column       | Type    | Notes |
|--------------|---------|-------|
| id           | TEXT    | PK |
| user_id      | TEXT    | FK -> users |
| channel_id   | TEXT    | FK -> channels |
| r2_key       | TEXT    | UNIQUE, R2 object key |
| filename     | TEXT    | original filename |
| content_type | TEXT    | MIME type |
| size         | INTEGER | bytes |
| status       | TEXT    | 'pending' or 'ready' |
| created_at   | INTEGER | unix epoch |

### `push_subscriptions`
| Column   | Type | Notes |
|----------|------|-------|
| id       | TEXT | PK |
| user_id  | TEXT | FK -> users |
| endpoint | TEXT | UNIQUE, push endpoint URL |
| p256dh   | TEXT | public key |
| auth     | TEXT | auth secret |
| created_at | INTEGER | unix epoch |

### Indexes

- `idx_oauth_accounts_user_id` -- OAuth lookups by user
- `idx_channels_server_id` -- channels by server
- `idx_server_members_user_id` -- memberships by user
- `idx_servers_public` -- partial index on public servers
- `idx_files_channel_id` -- files by channel
- `idx_files_user_id` -- files by uploader
- `idx_push_subscriptions_user_id` -- push subs by user
