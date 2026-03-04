// PM2 Ecosystem Configuration — Verus Agent Platform
// Start all:  pm2 start ecosystem.config.cjs
// Restart:    pm2 restart all
// Logs:       pm2 logs
// Monitor:    pm2 monit

const path = require('path');
const HOME = process.env.HOME || '/home/cluster';

module.exports = {
  apps: [
    // ─── Verus Agent Platform (main API + dashboard) ───
    {
      name: 'vap',
      cwd: path.join(HOME, 'verus-platform'),
      script: 'dist/index.js',
      interpreter: 'node',
      node_args: '--max-old-space-size=512',
      instances: 1,           // SQLite = single writer
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        API_PORT: 3000,
        API_HOST: '127.0.0.1',  // Behind nginx
      },
      error_file: path.join(HOME, 'logs/vap-error.log'),
      out_file: path.join(HOME, 'logs/vap-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ─── SafeChat Engine (prompt injection scanner) ───
    {
      name: 'safechat',
      cwd: path.join(HOME, 'safechat'),
      script: 'dist/server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '256M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        SAFECHAT_PORT: 3100,
        SAFECHAT_HOST: '127.0.0.1',
      },
      error_file: path.join(HOME, 'logs/safechat-error.log'),
      out_file: path.join(HOME, 'logs/safechat-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ─── Verus Wiki (static server + /api/ proxy) ───
    {
      name: 'wiki',
      cwd: path.join(HOME, 'verus-wiki-retype'),
      script: 'wiki-serve.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '128M',
      min_uptime: '5s',
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,
      env: {
        PORT: 5175,
      },
      error_file: path.join(HOME, 'logs/wiki-error.log'),
      out_file: path.join(HOME, 'logs/wiki-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ─── Verus Wiki Form API ───
    {
      name: 'wiki-api',
      cwd: path.join(HOME, 'verus-wiki-retype/form-api'),
      script: 'server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '128M',
      min_uptime: '5s',
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,
      env: {
        PORT: 3737,
        ADMIN_TOKEN: '750dc544fa7ce79c77cb79bd24d3ad9ef6b4677f9e586f3df1f44c9fd83a19db',
        GH_TOKEN: process.env.GH_TOKEN || '',
        GH_OWNER: 'autobb888',
        GH_REPO:  'verus-wiki',
        GH_BASE:  'main',
      },
      error_file: path.join(HOME, 'logs/wiki-api-error.log'),
      out_file: path.join(HOME, 'logs/wiki-api-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ─── VAP Dispatcher (ephemeral agent hosting) ───
    {
      name: 'vap-dispatcher',
      cwd: path.join(HOME, 'vap-dispatcher'),
      script: 'src/cli-v2.js',
      args: 'start',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 30000,    // Allow container cleanup
      env: {
        NODE_ENV: 'production',
      },
      error_file: path.join(HOME, 'logs/dispatcher-error.log'),
      out_file: path.join(HOME, 'logs/dispatcher-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
