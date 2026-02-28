#!/bin/bash
# Service Health Monitor — Run via cron every minute
# Checks if services are responding and alerts on failure
#
# Cron entry:
#   * * * * * /home/cluster/verus-platform/deploy/monitor-services.sh
#
# Requires: ALERT_WEBHOOK_URL env var (set in crontab or .env)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ALERT_SCRIPT="${SCRIPT_DIR}/alert-on-crash.sh"
STATE_DIR="${HOME}/.vap-monitor"
mkdir -p "$STATE_DIR"

check_service() {
  local name="$1"
  local url="$2"
  local state_file="${STATE_DIR}/${name}.down"

  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$url" 2>/dev/null)

  if [ "$status" = "200" ]; then
    # Service is up — clear down state if it was down
    if [ -f "$state_file" ]; then
      rm -f "$state_file"
      bash "$ALERT_SCRIPT" "$name" "recovered" "Service is back up (HTTP ${status})"
    fi
  else
    # Service is down — alert only on first failure (avoid spam)
    if [ ! -f "$state_file" ]; then
      echo "$(date -u +%s)" > "$state_file"
      bash "$ALERT_SCRIPT" "$name" "down" "Health check failed (HTTP ${status:-timeout})"
    fi
  fi
}

# Check each service
check_service "vap" "http://127.0.0.1:3000/v1/health"
check_service "safechat" "http://127.0.0.1:3100/health"
