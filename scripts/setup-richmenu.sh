#!/usr/bin/env bash
# Create + upload + activate the rich menu. Re-runnable (replaces old menus).
# Usage: set -a && source .env && set +a && ./scripts/setup-richmenu.sh /tmp/richmenu.png
set -euo pipefail

IMAGE="${1:-/tmp/richmenu.png}"
TOKEN="${LINE_CHANNEL_ACCESS_TOKEN:?LINE_CHANNEL_ACCESS_TOKEN not set}"

# Remove existing rich menus (keeps the account clean on re-run)
for id in $(curl -s -H "Authorization: Bearer $TOKEN" https://api.line.me/v2/bot/richmenu/list \
  | python3 -c "import sys,json; [print(m['richMenuId']) for m in json.load(sys.stdin).get('richmenus',[])]"); do
  echo "deleting old rich menu: $id"
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "https://api.line.me/v2/bot/richmenu/$id" > /dev/null
done

MENU_ID=$(curl -s -X POST https://api.line.me/v2/bot/richmenu \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "size": {"width": 2500, "height": 1686},
    "selected": true,
    "name": "nova-main-menu",
    "chatBarText": "เมนู",
    "areas": [
      {"bounds": {"x": 0,    "y": 0,   "width": 833, "height": 843}, "action": {"type": "message", "text": "/analyze"}},
      {"bounds": {"x": 833,  "y": 0,   "width": 833, "height": 843}, "action": {"type": "message", "text": "/status"}},
      {"bounds": {"x": 1666, "y": 0,   "width": 834, "height": 843}, "action": {"type": "message", "text": "/update"}},
      {"bounds": {"x": 0,    "y": 843, "width": 833, "height": 843}, "action": {"type": "message", "text": "/new"}},
      {"bounds": {"x": 833,  "y": 843, "width": 833, "height": 843}, "action": {"type": "message", "text": "/switch"}},
      {"bounds": {"x": 1666, "y": 843, "width": 834, "height": 843}, "action": {"type": "message", "text": "/edit"}}
    ]
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['richMenuId'])")
echo "created rich menu: $MENU_ID"

curl -s -X POST "https://api-data.line.me/v2/bot/richmenu/$MENU_ID/content" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: image/png" \
  --data-binary "@$IMAGE" > /dev/null
echo "image uploaded"

curl -s -X POST "https://api.line.me/v2/bot/user/all/richmenu/$MENU_ID" \
  -H "Authorization: Bearer $TOKEN" > /dev/null
echo "✅ set as default rich menu for all users"
