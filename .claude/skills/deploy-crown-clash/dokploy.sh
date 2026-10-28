#!/bin/sh
# Calls the Dokploy REST API with the owner's key without ever printing it.
#   dokploy.sh GET  "compose.one?composeId=<id>"
#   dokploy.sh POST compose.deploy '{"composeId":"<id>","title":"...","description":"..."}'
# URL and key come from DOKPLOY_URL / DOKPLOY_API_KEY, else from the dokploy MCP server entry in ~/.claude.json.
# The DOKPLOY_URL in the repo's .env points at a different host (dokploy.geeksesi.ir): use the MCP one.
set -eu
METHOD=${1:?GET or POST}; PATH_=${2:?api path}; BODY=${3:-}
read_cfg() {
  python3 - "$1" <<'PY'
import json, os, sys
name = sys.argv[1]
if os.environ.get(name):
    print(os.environ[name]); raise SystemExit
def find(o):
    if isinstance(o, dict):
        if name in o: return o[name]
        for v in o.values():
            r = find(v)
            if r: return r
    if isinstance(o, list):
        for v in o:
            r = find(v)
            if r: return r
with open(os.path.expanduser('~/.claude.json')) as f:
    print(find(json.load(f)) or '')
PY
}
URL=$(read_cfg DOKPLOY_URL); KEY=$(read_cfg DOKPLOY_API_KEY)
[ -n "$URL" ] && [ -n "$KEY" ] || { echo "no Dokploy URL/key found" >&2; exit 1; }
if [ "$METHOD" = GET ]; then
  curl -s -m 40 -H "x-api-key: $KEY" "$URL/$PATH_"
else
  curl -s -m 60 -X POST -H "x-api-key: $KEY" -H 'content-type: application/json' -d "$BODY" "$URL/$PATH_"
fi
