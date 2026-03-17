const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3001;

// Default sessions.json path used by OpenClaw main agent
const DEFAULT_SESSIONS_FILE = path.join(
  os.homedir(),
  '.openclaw',
  'agents',
  'main',
  'sessions',
  'sessions.json',
);

// Allow override via LOGS_FILE; otherwise use the OpenClaw sessions.json path
const LOGS_FILE = process.env.LOGS_FILE || DEFAULT_SESSIONS_FILE;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sessions', (req, res) => {
  try {
    const raw = fs.readFileSync(LOGS_FILE, 'utf8');
    const data = JSON.parse(raw);

    const sessions = Object.entries(data).map(([key, s]) => {
      const session = { key, ...s };

      // Strip the compiled prompt blob — it's just a huge concatenation of skill
      // descriptions that adds no value in the dashboard and bloats the payload.
      if (session.skillsSnapshot) {
        const { prompt, ...rest } = session.skillsSnapshot;
        session.skillsSnapshot = rest;
      }

      return session;
    });

    res.json(sessions);
  } catch (err) {
    console.error('Error reading logs:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/session-file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !filePath.endsWith('.jsonl')) {
    return res.status(400).json({ error: 'Invalid or missing path' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `Session file not found: ${filePath}` });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const entries = content
      .split('\n')
      .filter(l => l.trim())
      .map(line => {
        try { return JSON.parse(line); }
        catch { return { _raw: line }; }
      });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`OpenClaw Logs Dashboard running at http://localhost:${PORT}`);
  console.log(`Reading logs from: ${LOGS_FILE}`);
});
