# Context Lens Backend (SB Hacks XII Education Track)

Real-time backend for Context Lens with streaming transcripts, Gemini rolling summaries, optional Deepgram STT, MongoDB Atlas persistence (opt-in), and Snowflake analytics.

## Local Run (Mock Mode)
```bash
cp .env.example .env

docker compose -f docker/docker-compose.yml up -d

cd server
npm install
npm run dev
```

In another terminal, run the client stub (Node 20+ with global WebSocket):
```bash
node --loader tsx ../client_stub/index.ts
```

Quick HTTP sanity check:
```bash
./scripts/http_test.sh
```

Swagger UI (HTTP only):
```
http://localhost:8080/docs
```

WebSocket tester page:
```
http://localhost:8080/ws-test
```

## WebSocket Contract
Client → Server:
- `start_session`: `{type:"start_session", sessionId?, userId?, language?, saveMode:"none"|"mongo", sttMode:"mock"|"deepgram"}`
- `audio_chunk`: `{type:"audio_chunk", sessionId, pcm16_base64, sampleRate, t_ms}`
- `transcript_chunk`: `{type:"transcript_chunk", sessionId, text, t0_ms?, t1_ms?, speaker?}`
- `vision_frame`: `{type:"vision_frame", sessionId, image_base64, mime:"image/jpeg"|"image/png", t_ms}`
- `end_session`: `{type:"end_session", sessionId}`

Server → Client:
- `overlay_update`: `{type:"overlay_update", sessionId, topic_line, intent_tags, confidence, uncertainty_notes, last_updated_ms}`
- `debrief`: `{type:"debrief", sessionId, bullets, suggestions, uncertainty_notes}`
- `error`: `{type:"error", sessionId?, code, message}`
- `tool_event`: `{type:"tool_event", sessionId, tool:"practice_prompt", suggestion, last_updated_ms}`
- `vision_update`: `{type:"vision_update", sessionId, scene_summary, confidence, uncertainty_notes, last_updated_ms}`

HTTP:
- `GET /health` → `{ ok: true }`
- `GET /status` → `{ ok: true, sessions: number }`
- `GET /integrations/test?mode=keys|live` → checks keys or runs live connectivity tests

## Deepgram (Mock vs Real)
- Mock mode: `STT_DEFAULT=mock` and send `transcript_chunk` messages.
- Real mode: set `STT_DEFAULT=deepgram`, provide `DEEPGRAM_API_KEY`, then send `audio_chunk` frames (pcm16 base64). The server starts a Deepgram streaming connection per session.

## Audio Test (Deepgram)
Stream raw PCM16 (16kHz mono) into the audio pipe stub:
```bash
ffmpeg -i sample.wav -f s16le -ac 1 -ar 16000 - | node --loader tsx ../client_stub/audio_pipe.ts ws://localhost:8080/ws
```

## Vision Test (Camera Frames)
Send a JPEG/PNG frame to the backend:
```bash
node --loader tsx ../client_stub/vision_sender.ts ws://localhost:8080/ws demo-session ./sample.jpg
```
Or use `http://localhost:8080/ws-test` and select an image file.

## Gemini (Rolling Summary + Debrief)
Set `GEMINI_API_KEY` and `GEMINI_MODEL` (default `gemini-1.5-pro`). If the key is missing, the server uses heuristic summaries.

## MongoDB Atlas (Opt-In)
- Default `saveMode=none` (no persistence).
- Use `saveMode:"mongo"` to persist.
- Sessions are stored with a 24h TTL index.

## Snowflake (Mock vs Real)
- Mock mode: `ANALYTICS_DEFAULT=mock` writes JSONL to `ANALYTICS_PATH`.
- Real mode: `ANALYTICS_DEFAULT=snowflake` and set Snowflake env vars. Create the table:
```sql
create table if not exists CONTEXT_LENS_METRICS (
  payload variant,
  created_at timestamp_ntz
);
```

## Environment Variables
See `.env.example`.

## AsyncAPI Spec
The WebSocket contract is described in `asyncapi.yaml`.

## Vultr Deploy (Systemd Example)
On a Vultr VM (Ubuntu):
```bash
sudo apt-get update
sudo apt-get install -y nodejs npm

# app
cd /opt/contextlens
npm install --prefix server
npm run build --prefix server
```

Create `/etc/systemd/system/contextlens.service`:
```ini
[Unit]
Description=Context Lens Backend
After=network.target

[Service]
WorkingDirectory=/opt/contextlens/server
ExecStart=/usr/bin/node /opt/contextlens/server/dist/index.js
Restart=always
EnvironmentFile=/opt/contextlens/.env

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable contextlens
sudo systemctl start contextlens
```

## Notes
- Ethics: outputs include confidence + uncertainty notes and avoid medical/diagnostic language.
- Tool orchestration: when intent includes `instruction`, the server emits a `tool_event` with a practice prompt.
