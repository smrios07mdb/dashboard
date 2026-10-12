#!/usr/bin/env bash
# Smoke-test every tool on the live Worker, as Claude Chat would call it.
#
# Runs the same OAuth flow the claude.ai connector uses (dynamic client
# registration + PKCE), opens GitHub in your browser once, then calls each
# tool over MCP Streamable HTTP. Tokens live only in a temp dir for this run.
#
#   ./scripts/smoke.sh                      # against https://dashboard-mcp.smrios07.workers.dev
#   WORKER=http://localhost:8787 ./scripts/smoke.sh   # against wrangler dev
#   PR=5 ./scripts/smoke.sh                 # which PR the read tools inspect (default: newest open)
set -euo pipefail

WORKER="${WORKER:-https://dashboard-mcp.smrios07.workers.dev}"
PORT=8765
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

command -v python3 >/dev/null || { echo "python3 required"; exit 1; }

# ---- 1. register a throwaway OAuth client ------------------------------------
CLIENT_ID=$(curl -sf -X POST "$WORKER/register" -H 'content-type: application/json' \
  -d "{\"client_name\":\"handoff-mcp smoke\",\"redirect_uris\":[\"http://localhost:$PORT/callback\"],\"token_endpoint_auth_method\":\"none\",\"grant_types\":[\"authorization_code\"],\"response_types\":[\"code\"]}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["client_id"])')

# ---- 2. PKCE + one-shot localhost listener for the callback -------------------
python3 - "$DIR" "$CLIENT_ID" "$WORKER" "$PORT" <<'PY'
import sys, secrets, hashlib, base64
d, cid, worker, port = sys.argv[1:]
v = secrets.token_urlsafe(64)
c = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()
open(f"{d}/verifier", "w").write(v)
open(f"{d}/authorize_url", "w").write(
    f"{worker}/authorize?response_type=code&client_id={cid}"
    f"&redirect_uri=http%3A%2F%2Flocalhost%3A{port}%2Fcallback"
    f"&code_challenge={c}&code_challenge_method=S256&state=smoke")
PY

python3 - "$DIR" "$PORT" <<'PY' &
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
d, port = sys.argv[1], int(sys.argv[2])
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        open(f"{d}/code", "w").write(parse_qs(urlparse(self.path).query).get("code", [""])[0])
        self.send_response(200); self.end_headers(); self.wfile.write(b"handoff-mcp smoke: logged in, you can close this tab")
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", port), H).handle_request()
PY
LISTENER=$!

echo "Opening GitHub login in your browser..."
URL=$(cat "$DIR/authorize_url")
if command -v open >/dev/null; then open "$URL"; else echo "Open this URL: $URL"; fi
wait $LISTENER
[ -s "$DIR/code" ] || { echo "no auth code received"; exit 1; }

# ---- 3. token -----------------------------------------------------------------
TOKEN=$(curl -sf -X POST "$WORKER/token" -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=authorization_code --data-urlencode "code=$(cat "$DIR/code")" \
  --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "redirect_uri=http://localhost:$PORT/callback" \
  --data-urlencode "code_verifier=$(cat "$DIR/verifier")" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# ---- 4. MCP session -----------------------------------------------------------
MCP="$WORKER/mcp"
hdr=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream')
curl -sf -D "$DIR/init.h" -o /dev/null -X POST "$MCP" "${hdr[@]}" \
  -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
SID=$(grep -i '^mcp-session-id' "$DIR/init.h" | awk '{print $2}' | tr -d '\r')
curl -s -o /dev/null -X POST "$MCP" "${hdr[@]}" -H "mcp-session-id: $SID" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

call() { # call <tool> '<json args>'  -> prints "ok"/"ERROR" and the first lines of the result
  local body
  body=$(python3 -c 'import json,sys;print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":sys.argv[1],"arguments":json.loads(sys.argv[2])}}))' "$1" "$2")
  printf '\n== %s %s\n' "$1" "$2"
  curl -s -X POST "$MCP" "${hdr[@]}" -H "mcp-session-id: $SID" -d "$body" | sed -n 's/^data: //p' | python3 -c '
import json,sys
for line in sys.stdin:
    m=json.loads(line); r=m.get("result")
    if not r: print("RPC ERROR", json.dumps(m)); continue
    text=r["content"][0]["text"]
    print("ERROR" if r.get("isError") else "ok", "|", text[:600].replace("\n"," ")[:600])
'
}

echo; echo "tools/list:"
curl -s -X POST "$MCP" "${hdr[@]}" -H "mcp-session-id: $SID" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | sed -n 's/^data: //p' | python3 -c 'import json,sys;[print("  "+t["name"]) for t in json.loads(sys.stdin.readline())["result"]["tools"]]'

PR="${PR:-}"
if [ -z "$PR" ]; then
  PR=$(gh pr list --state open --limit 1 --json number -q '.[0].number' 2>/dev/null || true)
fi

SCRATCH="chat/smoke-$(date +%s)"
call read_file  '{"path":"handoff.md"}'
call list_files '{"path":"infra/handoff-mcp","ref":"main"}'
call write_file "{\"path\":\"docs/smoke.md\",\"content\":\"smoke\\n\",\"message\":\"smoke: branch write\",\"branch\":\"$SCRATCH\"}"
call read_file  "{\"path\":\"docs/smoke.md\",\"ref\":\"$SCRATCH\"}"
call compare    "{\"base\":\"main\",\"head\":\"$SCRATCH\"}"
call list_pull_requests '{"state":"open"}'
if [ -n "$PR" ]; then
  call get_pull_request      "{\"number\":$PR}"
  call get_pull_request_diff "{\"number\":$PR,\"max_bytes\":1500}"
  if [ "${COMMENT:-}" = "1" ]; then
    call add_pull_request_comment "{\"number\":$PR,\"body\":\"handoff-mcp smoke test comment ($(date -u +%FT%TZ)). Safe to delete.\"}"
  else
    echo; echo "== add_pull_request_comment skipped (set COMMENT=1 to post a real comment on #$PR)"
  fi
else
  echo; echo "== no open PR found; skipping get_pull_request / get_pull_request_diff (set PR=<n>)"
fi

echo; echo "Deleting scratch branch $SCRATCH"
git push -q origin --delete "$SCRATCH" 2>/dev/null || echo "  (delete it by hand: git push origin --delete $SCRATCH)"
echo "done"
