module.exports = {
  apps: [
    {
      name: 'openclaw-logs-dashboard',
      script: './server.js',
      cwd: '/root/.openclaw/workspace/openclaw-log-watcher',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        SESSIONS_DIR: '/root/.openclaw/agents/main/sessions'
      }
    }
  ]
};
