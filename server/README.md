# Context Lens Server (MVP)

Local dev backend for streaming transcript chunks and emitting overlay updates.

## Requirements
- Node.js 20+
- Docker (optional, for local MongoDB)

## Setup
```bash
cp .env.example .env
```
Update `.env` with your Gemini and Deepgram keys if available.

Start MongoDB locally (optional):
```bash
docker compose -f ../docker/docker-compose.yml up -d
```

## Run
```bash
npm install
npm run dev
```

The server starts on `PORT` (default `8080`) with WebSocket path `WS_PATH` (default `/ws`).

## WebSocket Protocol
Client -> Server:
- `start_session`: `{ type: "start_session", sessionId?, userId?, language?, saveMode: "none"|"mongo" }`
- `transcript_chunk`: `{ type: "transcript_chunk", sessionId, text, t0_ms, t1_ms, speaker? }`
- `end_session`: `{ type: "end_session", sessionId }`
- `pause_overlay` (optional): `{ type: "pause_overlay", sessionId, paused: true|false }`

Server -> Client:
- `overlay_update`: `{ type: "overlay_update", sessionId, topic_line, intent_tags, confidence, last_updated_ms }`
- `debrief`: `{ type: "debrief", sessionId, bullets, suggestions, uncertainty_notes }`
- `error`: `{ type: "error", sessionId?, code, message }`

If `sessionId` is omitted on `start_session`, the server creates one and immediately emits an `overlay_update` containing the generated `sessionId`.

## Example (wscat)
```bash
wscat -c ws://localhost:8080/ws
```
```json
{"type":"start_session","sessionId":"demo-1","userId":"u1","language":"en","saveMode":"none"}
```
```json
{"type":"transcript_chunk","sessionId":"demo-1","text":"We should plan next week.","t0_ms":0,"t1_ms":1200}
```
```json
{"type":"transcript_chunk","sessionId":"demo-1","text":"Let us assign owners.","t0_ms":1200,"t1_ms":2400}
```
```json
{"type":"transcript_chunk","sessionId":"demo-1","text":"Feedback on the approach?","t0_ms":2400,"t1_ms":3600}
```
```json
{"type":"end_session","sessionId":"demo-1"}
```

## Client Stub
From repo root:
```bash
node client_stub/index.js
```

## Notes
- If `GEMINI_API_KEY` is not set, the server uses a heuristic summary and tags.
- `SAVE_DEFAULT=none` avoids persistence by default. If `saveMode=mongo`, sessions are stored with a 24h TTL index.
- Analytics output is appended to `ANALYTICS_PATH` as JSONL (default `./analytics_out/metrics.jsonl`).

## Deploy Notes (optional)
- Use `pm2` or `systemd` to run `npm run start` after `npm run build`.
- Configure `MONGO_URI` for Atlas when deploying.
