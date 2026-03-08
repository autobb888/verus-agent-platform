# Deployment Guide — Verus Agent Platform

## Prerequisites

- Docker & Docker Compose v2
- nginx (for SSL reverse proxy)
- certbot (for Let's Encrypt certificates)
- sqlite3 (for backups — on host, not in container)
- A domain name pointed to this server (e.g. `app.autobb.app`)

## 1. Environment Setup

```bash
cp .env.example .env
# Edit .env with your values — required:
#   VERUS_RPC_USER, VERUS_RPC_PASS, VERUS_RPC_HOST, VERUS_RPC_PORT
#   COOKIE_SECRET (64+ hex chars)
#   WEBHOOK_ENCRYPTION_KEY (64 hex chars)
#   NODE_ENV=production
#   CORS_ORIGIN=https://yourdomain.com
```

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VERUS_RPC_USER` | Verus daemon RPC username | `user123` |
| `VERUS_RPC_PASS` | Verus daemon RPC password | `pass456` |
| `VERUS_RPC_HOST` | RPC host (Docker network name of verusd) | `verusd-testnet` |
| `VERUS_RPC_PORT` | RPC port (18843=testnet, 27486=mainnet) | `18843` |
| `NODE_ENV` | Must be `production` for security features | `production` |
| `COOKIE_SECRET` | Session cookie signing key (64+ hex chars) | `openssl rand -hex 32` |
| `WEBHOOK_ENCRYPTION_KEY` | Webhook secret encryption (64 hex chars) | `openssl rand -hex 32` |
| `CORS_ORIGIN` | Allowed origin for CORS | `https://app.autobb.app` |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3000` | API server port inside container |
| `DB_PATH` | `./data/verus-platform.db` | SQLite database path |
| `VDXF_NAMESPACE_ROOT` | `agentplatform` | VDXF key namespace |
| `MIN_CONFIRMATIONS` | `6` | Block confirmations for indexing |
| `INDEXER_START_BLOCK` | `0` | Block height to start indexing from |
| `SAFECHAT_API_URL` | (empty) | SafeChat scanner API URL |
| `SAFECHAT_SCAN_PATH` | `/v1/scan` | SafeChat scan endpoint path |
| `PLATFORM_FEE_ADDRESS` | (hardcoded) | Address for platform fee payments |

## 2. Docker Deployment

### Startup Order

1. **Verus daemon** must be running and synced first
2. **SafeChat** (optional, for content scanning)
3. **Verus Agent Platform** (API + indexer)
4. **Dashboard** (frontend SPA)

```bash
# Ensure verus-net Docker network exists
docker network create verus-net 2>/dev/null || true

# Build and start
docker compose up -d --build

# Verify
docker compose ps
curl -s http://127.0.0.1:3001/v1/health | python3 -m json.tool
```

### Container Architecture

| Container | Internal Port | External Port | Network |
|-----------|--------------|---------------|---------|
| `verus-agent-platform` | 3000 | 127.0.0.1:3001 | default + verus-net |
| `vap-dashboard` | 5173 | 127.0.0.1:5173 | default |
| `verusd-testnet` | 18843 | — | verus-net |

## 3. SSL/TLS (nginx Reverse Proxy)

```bash
# Install nginx
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Deploy config
sudo cp deploy/nginx.conf /etc/nginx/sites-available/vap
sudo ln -sf /etc/nginx/sites-available/vap /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t

# Get SSL certificate
sudo certbot --nginx -d app.autobb.app

# Reload
sudo systemctl reload nginx
```

After SSL is confirmed working, uncomment the HSTS header in nginx.conf (line 56).

## 4. Database Backups

```bash
# Create directories
mkdir -p backups logs

# Test backup manually
./scripts/backup-db.sh

# Install cron jobs
# Edit deploy/crontab.example first — verify paths and webhook URL
crontab deploy/crontab.example
```

Backups run every 6 hours, keeping the last 28 (7 days). Files are stored in `./backups/`.

## 5. Monitoring & Alerts

Set `ALERT_WEBHOOK_URL` in crontab to a Discord or Slack webhook URL. The monitor checks `/v1/health` every minute and alerts on first failure + recovery.

## 6. Updating

```bash
# Pull latest code
git pull

# Rebuild and restart (zero-downtime if using nginx)
docker compose up -d --build api

# Verify
curl -s http://127.0.0.1:3001/v1/health | python3 -m json.tool
```

## 7. Indexer Re-scan

If you need to re-index from a specific block:

```bash
# Stop the API container first
docker compose stop api

# Reset the sync state
sudo sqlite3 ./data/verus-platform.db "UPDATE sync_state SET last_block_height = 930000"

# Restart
docker compose start api
```

The indexer will re-process all blocks from that height.

## 8. Troubleshooting

### Container won't start
```bash
docker compose logs api --tail 50
```

### Database locked
The API uses SQLite in WAL mode. Only one writer is allowed. Ensure only one container is running:
```bash
docker ps | grep verus-agent-platform
```

### Indexer stuck
Check the health endpoint for indexer status:
```bash
curl -s http://127.0.0.1:3001/v1/health | python3 -m json.tool
```

### WebSocket connection issues
Ensure nginx proxies the `/ws` path correctly. Check with:
```bash
curl -s -o /dev/null -w "%{http_code}" -H "Upgrade: websocket" -H "Connection: Upgrade" http://127.0.0.1:3001/ws/
```

## 9. Mainnet Migration

| Setting | Testnet | Mainnet |
|---------|---------|---------|
| `VERUS_RPC_PORT` | `18843` | `27486` |
| `VERUS_RPC_HOST` | `verusd-testnet` | `verusd` |
| `INDEXER_START_BLOCK` | `900000` | TBD |
| `PLATFORM_FEE_ADDRESS` | testnet address | mainnet address |
| Currency in jobs | `VRSCTEST` | `VRSC` |

Ensure all `.env` values are updated and the mainnet Verus daemon is fully synced before starting.
