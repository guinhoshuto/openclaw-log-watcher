# OpenClaw Logs Dashboard

Node.js/Express app that reads **session `.jsonl` files** under the OpenClaw sessions directory (deduplicated by UUID) and serves a web dashboard:

- **All historical sessions** (active `.jsonl`, then `.jsonl.reset.<ts>`, then `.jsonl.deleted.<ts>` per UUID — one source per session, no double-counting)
- Sessions table (filters, sorting, pagination)
- Charts (sessions/day and tokens/day)
- Per-session JSON viewer (metadata from optional `sessions.json` / `logs.json` merged in)
- Per-session **session file** viewer (the chosen `.jsonl`)

## Requirements

- Node.js (recommended: 18+)
- npm

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Then open `http://localhost:3001`.

### Dev mode (auto-reload)

```bash
npm run dev
```

## Configuration

| Variable        | Description |
|-----------------|-------------|
| `PORT`          | HTTP port (default: `3001`) |
| `SESSIONS_DIR`  | Folder with `*.jsonl` (default: `~/.openclaw/agents/main/sessions`) |
| `LOGS_FILE`     | Optional path to `logs.json` — **metadata only** (merged by `sessionId`) |

Example (e.g. server paths):

```bash
SESSIONS_DIR=/root/.openclaw/agents/main/sessions \
LOGS_FILE=/root/.openclaw/logs.json \
PORT=8080 npm start
```

### Session files (primary source)

For each **base UUID**, exactly one file is used:

1. `<uuid>.jsonl` if present  
2. Else `<uuid>.jsonl.reset.<timestamp>` (newest timestamp if several)  
3. Else `<uuid>.jsonl.deleted.<timestamp>` (newest if several)  

Tokens and times are aggregated **only** from that file. `sessions.json` and `logs.json` enrich labels, origin, etc., but do not define history or token totals.

## API

### `GET /api/sessions`

Returns an array of session objects, each including at least:

- `sessionId`, `key` (UUID), `sessionFile`, `fileKind` (`active` | `reset` | `deleted`)
- `startAt`, `endAt`, `updatedAt`
- `inputTokens`, `outputTokens`, `cacheRead`, `cacheWrite`, `totalTokens`, `model`

`skillsSnapshot.prompt` is stripped when present to keep payloads small.

### `GET /api/session-file?path=/abs/path/to/session.jsonl`

Reads a `.jsonl` under `SESSIONS_DIR` and returns one JSON object per line.

- Path must resolve **inside** `SESSIONS_DIR` (403 otherwise)

## UI

- **Filters**: date range, model, provider, origin  
- **Source**: active vs archived reset/deleted file  
- **Actions**: `{ }` session JSON, `≡` session file modal  
