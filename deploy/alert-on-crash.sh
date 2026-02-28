#!/bin/bash
# Crash Alert Script — Called by pm2 on process events or by cron
# Sends a webhook notification when a service crashes
#
# Usage:
#   ./deploy/alert-on-crash.sh <service-name> <event> [message]
#
# Configure:
#   export ALERT_WEBHOOK_URL="https://discord.com/api/webhooks/..."
#   # OR
#   export ALERT_WEBHOOK_URL="https://hooks.slack.com/services/..."
#
# pm2 integration (add to ecosystem.config.cjs):
#   See pm2 docs for --on-exit or use cron-based monitoring below

set -e

SERVICE="${1:-unknown}"
EVENT="${2:-crash}"
MESSAGE="${3:-No details}"
WEBHOOK_URL="${ALERT_WEBHOOK_URL}"

if [ -z "$WEBHOOK_URL" ]; then
  echo "[Alert] ALERT_WEBHOOK_URL not set — skipping notification"
  exit 0
fi

HOSTNAME=$(hostname)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Detect webhook type and format accordingly
if echo "$WEBHOOK_URL" | grep -q "discord.com"; then
  # Discord webhook
  PAYLOAD=$(cat <<EOF
{
  "content": null,
  "embeds": [{
    "title": "VAP Alert: ${SERVICE} ${EVENT}",
    "description": "${MESSAGE}",
    "color": 15548997,
    "fields": [
      {"name": "Host", "value": "${HOSTNAME}", "inline": true},
      {"name": "Service", "value": "${SERVICE}", "inline": true},
      {"name": "Event", "value": "${EVENT}", "inline": true}
    ],
    "timestamp": "${TIMESTAMP}"
  }]
}
EOF
)
else
  # Slack-compatible webhook
  PAYLOAD=$(cat <<EOF
{
  "text": "VAP Alert: ${SERVICE} ${EVENT}",
  "blocks": [{
    "type": "section",
    "text": {
      "type": "mrkdwn",
      "text": "*VAP Alert: ${SERVICE} ${EVENT}*\n${MESSAGE}\n\n*Host:* ${HOSTNAME}\n*Time:* ${TIMESTAMP}"
    }
  }]
}
EOF
)
fi

curl -s -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$WEBHOOK_URL"

echo "[Alert] Sent ${EVENT} notification for ${SERVICE}"
