const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3001;

const homedir = os.homedir();
const DEFAULT_SESSIONS_DIR = path.join(
  homedir,
  '.openclaw',
  'agents',
  'main',
  'sessions',
);

/** Directory containing *.jsonl session files (primary source). */
const SESSIONS_DIR = path.resolve(
  process.env.SESSIONS_DIR || DEFAULT_SESSIONS_DIR,
);

/** Optional logs.json — metadata only. */
const LOGS_FILE = process.env.LOGS_FILE
  ? path.resolve(process.env.LOGS_FILE)
  : null;

const UUID =
  '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
const RE_ACTIVE = new RegExp(`^${UUID}\\.jsonl$`);
const RE_RESET = new RegExp(`^${UUID}\\.jsonl\\.reset\\.(.+)$`);
const RE_DELETED = new RegExp(`^${UUID}\\.jsonl\\.deleted\\.(.+)$`);

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadSessionsJsonMeta() {
  const p = path.join(SESSIONS_DIR, 'sessions.json');
  if (!fs.existsSync(p)) return { bySessionId: new Map(), raw: null };
  const data = safeReadJson(p);
  if (!data || typeof data !== 'object') return { bySessionId: new Map(), raw: null };
  const bySessionId = new Map();

  for (const [mapKey, s] of Object.entries(data)) {
    if (!s || typeof s !== 'object') continue;

    // Derive a human label from the mapKey when none is set
    const derivedLabel = s.label || _labelFromMapKey(mapKey);
    const enriched = { mapKey, label: derivedLabel, ...s };

    const setIf = k => {
      if (!k) return;
      const nk = String(k).toLowerCase();
      if (!bySessionId.has(nk)) bySessionId.set(nk, enriched);
    };
    setIf(s.sessionId);
    setIf(mapKey);

    // Also index by the UUID inside sessionFile path so lookup always works
    const sf = s.sessionFile;
    if (sf && typeof sf === 'string') {
      const base = path.basename(sf).replace(/\.jsonl.*$/, '').toLowerCase();
      if (base) setIf(base);
    }
  }
  return { bySessionId, raw: data };
}

/** Derive a readable label from an agent mapKey like agent:main:cron:xxx:run:yyy */
function _labelFromMapKey(mapKey) {
  if (!mapKey) return null;
  // e.g. agent:main:cron:uuid → Cron
  //      agent:main:discord:channel:id → Discord #id
  //      agent:main:telegram:direct:id → Telegram
  //      agent:main:main → Main
  const parts = String(mapKey).split(':');
  // parts[0]=agent parts[1]=agentName parts[2]=type ...
  const type = parts[2];
  if (!type) return mapKey;
  if (type === 'main') return 'Main';
  if (type === 'cron') return `Cron`;
  if (type === 'discord') return `Discord ${parts[4] ? '#' + parts[4] : ''}`.trim();
  if (type === 'telegram') return `Telegram`;
  if (type === 'hook') return `Hook: ${parts[3] || ''}`;
  return type;
}

function loadLogsJsonMeta() {
  if (!LOGS_FILE || !fs.existsSync(LOGS_FILE)) return new Map();
  const data = safeReadJson(LOGS_FILE);
  if (!data || typeof data !== 'object') return new Map();
  const bySessionId = new Map();
  for (const [k, v] of Object.entries(data)) {
    if (!v || typeof v !== 'object') continue;
    const sid = String(v.sessionId || k).toLowerCase();
    if (!bySessionId.has(sid)) bySessionId.set(sid, v);
  }
  return bySessionId;
}

function compareSuffixTs(a, b) {
  const na = parseInt(String(a), 10);
  const nb = parseInt(String(b), 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
  return String(b).localeCompare(String(a));
}

/**
 * Scan SESSIONS_DIR and group files by base UUID.
 * @returns {Map<string, { active: string|null, resets: Array<{ts:string, path:string}>, deleteds: Array<{ts:string, path:string}> }>}
 */
function groupSessionFilesByUuid() {
  const map = new Map();
  if (!fs.existsSync(SESSIONS_DIR)) return map;

  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    let m = name.match(RE_ACTIVE);
    if (m) {
      const uuid = m[1].toLowerCase();
      if (!map.has(uuid)) map.set(uuid, { active: null, resets: [], deleteds: [] });
      map.get(uuid).active = path.join(SESSIONS_DIR, name);
      continue;
    }
    m = name.match(RE_RESET);
    if (m) {
      const uuid = m[1].toLowerCase();
      const ts = m[2];
      if (!map.has(uuid)) map.set(uuid, { active: null, resets: [], deleteds: [] });
      map.get(uuid).resets.push({ ts, path: path.join(SESSIONS_DIR, name) });
      continue;
    }
    m = name.match(RE_DELETED);
    if (m) {
      const uuid = m[1].toLowerCase();
      const ts = m[2];
      if (!map.has(uuid)) map.set(uuid, { active: null, resets: [], deleteds: [] });
      map.get(uuid).deleteds.push({ ts, path: path.join(SESSIONS_DIR, name) });
    }
  }
  return map;
}

/**
 * Pick single file per UUID: .jsonl > newest .reset > newest .deleted
 */
function pickSessionFile(group) {
  if (group.active) {
    return { sessionFile: group.active, fileKind: 'active' };
  }
  if (group.resets.length) {
    group.resets.sort((a, b) => compareSuffixTs(a.ts, b.ts));
    const best = group.resets[0];
    return { sessionFile: best.path, fileKind: 'reset' };
  }
  if (group.deleteds.length) {
    group.deleteds.sort((a, b) => compareSuffixTs(a.ts, b.ts));
    const best = group.deleteds[0];
    return { sessionFile: best.path, fileKind: 'deleted' };
  }
  return { sessionFile: null, fileKind: null };
}

function getUsage(entry) {
  return entry?.message?.usage || entry?.usage || null;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Aggregate tokens and times from one .jsonl file.
 */
function aggregateFromJsonl(filePath) {
  const result = {
    sessionIdFromFile: null,
    startAt: null,
    endAt: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    model: null,
  };

  if (!filePath || !fs.existsSync(filePath)) return result;

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return result;
  }

  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    const ts =
      e.timestamp ??
      e.updatedAt ??
      e.message?.timestamp ??
      e.message?.createdAt;
    if (ts != null) {
      const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
      if (Number.isFinite(t)) {
        if (result.startAt == null || t < result.startAt) result.startAt = t;
        if (result.endAt == null || t > result.endAt) result.endAt = t;
      }
    }

    if (e.sessionId && typeof e.sessionId === 'string') {
      result.sessionIdFromFile = e.sessionId;
    }
    if (e._key && typeof e._key === 'string' && !result.sessionIdFromFile) {
      result.sessionIdFromFile = e._key;
    }

    const u = getUsage(e);
    if (u && typeof u === 'object') {
      const inp = num(
        u.input ?? u.input_tokens ?? u.prompt_tokens ?? u.promptTokens,
      );
      const out = num(
        u.output ??
          u.output_tokens ??
          u.completion_tokens ??
          u.completionTokens,
      );
      const cr = num(
        u.cache_read_input_tokens ??
          u.cacheRead ??
          u.cache_read ??
          u.cacheReadInputTokens,
      );
      const cw = num(
        u.cache_creation_input_tokens ??
          u.cacheWrite ??
          u.cache_write ??
          u.cacheCreationInputTokens,
      );
      const tt = num(u.totalTokens ?? u.total_tokens);

      if (inp != null) result.inputTokens += inp;
      if (out != null) result.outputTokens += out;
      if (cr != null) result.cacheRead += cr;
      if (cw != null) result.cacheWrite += cw;

      if (tt != null) result.totalTokens += tt;
      else if (inp != null || out != null) {
        result.totalTokens += (inp || 0) + (out || 0);
      }
    }

    const m =
      e.message?.model ?? e.modelId ?? e.model ?? e.message?.modelId ?? null;
    if (m && typeof m === 'string') result.model = m;
  }

  if (result.totalTokens === 0 && (result.inputTokens || result.outputTokens)) {
    result.totalTokens = result.inputTokens + result.outputTokens;
  }

  return result;
}

/**
 * Aggregate tokens and times from ALL files in a group (active + resets + deleteds).
 * This ensures historical token data is never lost when a session is reset daily.
 */
function aggregateAllFilesInGroup(group) {
  const combined = {
    sessionIdFromFile: null,
    startAt: null,
    endAt: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    model: null,
    resetCount: 0,
  };

  const allFiles = [];
  if (group.active) allFiles.push(group.active);
  for (const r of group.resets)   allFiles.push(r.path);
  for (const d of group.deleteds) allFiles.push(d.path);

  combined.resetCount = group.resets.length;

  for (const fp of allFiles) {
    const agg = aggregateFromJsonl(fp);
    if (!combined.sessionIdFromFile && agg.sessionIdFromFile) {
      combined.sessionIdFromFile = agg.sessionIdFromFile;
    }
    if (agg.startAt != null && (combined.startAt == null || agg.startAt < combined.startAt)) {
      combined.startAt = agg.startAt;
    }
    if (agg.endAt != null && (combined.endAt == null || agg.endAt > combined.endAt)) {
      combined.endAt = agg.endAt;
    }
    combined.inputTokens  += agg.inputTokens;
    combined.outputTokens += agg.outputTokens;
    combined.cacheRead    += agg.cacheRead;
    combined.cacheWrite   += agg.cacheWrite;
    combined.totalTokens  += agg.totalTokens;
    if (agg.model) combined.model = agg.model;
  }

  return combined;
}

function stripSkillsPrompt(session) {
  if (!session?.skillsSnapshot) return session;
  const { prompt, ...rest } = session.skillsSnapshot;
  return { ...session, skillsSnapshot: rest };
}

function mergeMeta(base, sessionsMeta, logsMeta) {
  const sid = base.sessionId;
  const uuid = base.key;
  const fromS =
    sessionsMeta.get(String(sid).toLowerCase()) ||
    sessionsMeta.get(String(uuid).toLowerCase());
  const fromL =
    logsMeta.get(String(sid).toLowerCase()) ||
    logsMeta.get(String(uuid).toLowerCase());
  const meta = { ...(fromL || {}), ...(fromS || {}) };
  if (!Object.keys(meta).length) return base;

  const cleaned = stripSkillsPrompt(meta);
  if (cleaned.skillsSnapshot?.prompt) {
    const { prompt, ...r } = cleaned.skillsSnapshot;
    cleaned.skillsSnapshot = r;
  }

  // Token counts from file aggregation are always authoritative (sessions.json can be stale)
  // Use file tokens when non-zero; fall back to sessions.json tokens otherwise
  const bestInput  = base.inputTokens  || cleaned.inputTokens  || 0;
  const bestOutput = base.outputTokens || cleaned.outputTokens || 0;
  const bestCacheR = base.cacheRead    || cleaned.cacheRead    || 0;
  const bestCacheW = base.cacheWrite   || cleaned.cacheWrite   || 0;
  const bestTotal  = base.totalTokens  || cleaned.totalTokens  || 0;

  return {
    ...cleaned,
    key: base.key,
    sessionId: base.sessionId,
    sessionFile: base.sessionFile,
    fileKind: base.fileKind,
    resetCount: base.resetCount,
    startAt: base.startAt,
    endAt: base.endAt,
    updatedAt: base.updatedAt,
    inputTokens: bestInput,
    outputTokens: bestOutput,
    cacheRead: bestCacheR,
    cacheWrite: bestCacheW,
    totalTokens: bestTotal,
    model: base.model || cleaned.model,
  };
}

function modelProviderFromModel(model) {
  if (!model || typeof model !== 'string') return null;
  const m = model.toLowerCase();
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.includes('gpt') || m.includes('openai') || m.includes('o1') || m.includes('o3'))
    return 'openai';
  if (m.includes('gemini') || m.includes('google')) return 'google';
  return null;
}

function buildSessionList() {
  const groups = groupSessionFilesByUuid();
  const { bySessionId: sessionsMeta } = loadSessionsJsonMeta();
  const logsMeta = loadLogsJsonMeta();
  const list = [];

  for (const [uuid, group] of groups) {
    const { sessionFile, fileKind } = pickSessionFile(group);
    if (!sessionFile) continue;

    // Aggregate ALL files (active + resets + deleteds) so token history survives daily resets
    const agg = aggregateAllFilesInGroup(group);
    const sessionId = agg.sessionIdFromFile || uuid;
    const updatedAt = agg.endAt ?? agg.startAt ?? Date.now();

    let base = {
      key: uuid,
      sessionId,
      sessionFile,
      fileKind,
      resetCount: agg.resetCount,
      startAt: agg.startAt,
      endAt: agg.endAt,
      updatedAt,
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      cacheRead: agg.cacheRead,
      cacheWrite: agg.cacheWrite,
      totalTokens: agg.totalTokens,
      model: agg.model,
      modelProvider: modelProviderFromModel(agg.model),
    };

    base = mergeMeta(base, sessionsMeta, logsMeta);
    if (!base.modelProvider && base.model) {
      base.modelProvider = modelProviderFromModel(base.model);
    }
    list.push(base);
  }

  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return list;
}

function isPathUnderSessionDir(resolvedPath) {
  const dir = path.resolve(SESSIONS_DIR);
  const file = path.resolve(resolvedPath);
  if (file === dir) return false;
  return file.startsWith(dir + path.sep);
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sessions', (req, res) => {
  try {
    const sessions = buildSessionList();
    res.json(sessions);
  } catch (err) {
    console.error('Error building sessions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/session-file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing path' });
  }

  let resolved;
  try {
    resolved = path.resolve(filePath);
  } catch {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (!resolved.endsWith('.jsonl')) {
    return res.status(400).json({ error: 'Path must be a .jsonl file' });
  }

  if (!isPathUnderSessionDir(resolved)) {
    return res.status(403).json({ error: 'Path must be under sessions directory' });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: `Session file not found: ${resolved}` });
  }

  try {
    const content = fs.readFileSync(resolved, 'utf8');
    const entries = content
      .split('\n')
      .filter(l => l.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { _raw: line };
        }
      });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`OpenClaw Logs Dashboard running at http://localhost:${PORT}`);
  console.log(`Sessions directory (primary): ${SESSIONS_DIR}`);
  if (LOGS_FILE) console.log(`logs.json (metadata): ${LOGS_FILE}`);
});
