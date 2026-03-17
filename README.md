# OpenClaw Logs Dashboard

Small Node.js/Express app that reads `logs.json` produced by OpenClaw and serves a web dashboard:

- Sessions table (filters, sorting, pagination)
- Charts (sessions/day and tokens/day)
- Per-session JSON viewer
- Per-session **session file** viewer (reads the `sessionFile` `.jsonl` and renders it as Table/Raw, with expandable rows)

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

The server reads configuration from environment variables:

- `PORT`: HTTP port (default: `3001`)
- `LOGS_FILE`: path to `logs.json` (default: `./logs.json`)

Example:

```bash
PORT=8080 LOGS_FILE=/root/.openclaw/logs.json npm start
```

## API

### `GET /api/sessions`

Returns an array of session objects derived from the `logs.json` root map (key → session object).

Notes:
- The `skillsSnapshot.prompt` field is removed to avoid returning a huge compiled prompt blob.

### `GET /api/session-file?path=/abs/path/to/session.jsonl`

Reads the real OpenClaw `sessionFile` (`.jsonl`) and returns an array where each line is parsed as JSON.

- If the `path` does not exist: returns `404`
- If a line is not valid JSON: it is returned as `{ "_raw": "<line>" }`

## UI usage

- **Filters**: date range, model, provider, origin
- **Actions column**:
  - `{ }` opens the full session JSON modal
  - `≡` opens the session file modal (real `.jsonl` from `sessionFile`)
- **Session file modal**:
  - Toggle **Table/Raw**
  - Click a row to expand (accordion) and show content blocks line-by-line
  - Heatmap on token columns (Total tokens; and sessions table has heatmap for In/Out/Total)

# openclaw-log-watcher
# openclaw-log-watcher
