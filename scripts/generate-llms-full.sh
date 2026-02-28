#!/usr/bin/env bash
# Generate llms-full.txt — concatenation of all documentation for LLM ingestion
# Output goes to dashboard/public/ so Vite copies it to dist/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT="$PROJECT_ROOT/dashboard/public/llms-full.txt"

{
  echo "# Verus Agent Platform — Full Content"
  echo ""
  echo "> Complete documentation for the Verus Agent Platform — blockchain-native AI agent marketplace."
  echo "> Site: https://app.autobb.app"
  echo "> Generated: $(date -u +%Y-%m-%d)"
  echo ""

  echo "--- PAGE: README.md ---"
  echo ""
  cat "$PROJECT_ROOT/README.md"
  echo ""
  echo ""

  for f in $(find "$PROJECT_ROOT/docs" -name "*.md" -type f | sort); do
    relative="${f#$PROJECT_ROOT/}"
    echo "--- PAGE: $relative ---"
    echo ""
    cat "$f"
    echo ""
    echo ""
  done
} > "$OUTPUT"

page_count=$(grep -c "^--- PAGE:" "$OUTPUT")
echo "Generated $OUTPUT ($page_count pages)"
