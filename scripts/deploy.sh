#!/usr/bin/env bash
# Deploy and point hold-still-app.vercel.app at the new build in one step.
set -euo pipefail

ALIAS="hold-still-app.vercel.app"
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

vercel deploy --prod --yes 2>&1 | tee "$LOG"

URL=$(grep -oE 'https://hold-still-[a-z0-9]+-[a-z0-9-]+\.vercel\.app' "$LOG" | tail -1)
if [ -z "$URL" ]; then
  echo "deploy.sh: couldn't find deployment URL in vercel output" >&2
  exit 1
fi

echo
echo "→ aliasing $ALIAS to $URL"
vercel alias set "$URL" "$ALIAS"
