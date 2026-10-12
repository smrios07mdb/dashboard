# dashboard-mcp

One-repo MCP server (Cloudflare Worker) so Claude Chat has full read/write on
`smrios07mdb/dashboard`. Copied from `dynasty-edge/infra/edge-mcp`; the TAT
probe cron was removed.

Tools: `read_file`, `write_file`, `edit_file`, `list_files`, `list_pull_requests`,
`get_pull_request`, `get_pull_request_diff`, `compare`, `create_pull_request`,
`add_pull_request_comment`, `merge_pull_request` (needs the reviewed head sha),
`list_runs`, `get_run_log`, `run_workflow`.

Repo, branch and allowed login are `vars` in `wrangler.jsonc` — a tool call cannot
retarget another repo. OAuth via GitHub, only `smrios07mdb` can connect. Repo
access uses the separate fine-grained PAT in `GITHUB_REPO_PAT`.

## Test

```bash
npm install && npm test && npm run typecheck
```

## Setup (run on the Mac, from `infra/edge-mcp/`)

1. `npx wrangler kv namespace create OAUTH_KV` → paste the id into `wrangler.jsonc`.
2. `npx wrangler deploy` → URL is `https://dashboard-mcp.<subdomain>.workers.dev` (`$WORKER`).
3. Fine-grained PAT (github.com/settings/personal-access-tokens/new): only `smrios07mdb/dashboard`;
   Contents RW, Pull requests RW, Actions RW, Commit statuses R.
4. OAuth App (github.com/settings/developers): homepage `$WORKER`, callback `$WORKER/callback`.
5. Secrets, then redeploy:
   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put GITHUB_REPO_PAT
   openssl rand -hex 32 | npx wrangler secret put COOKIE_SECRET
   npx wrangler deploy
   ```
6. claude.ai → Settings → Connectors → Add custom connector → `$WORKER/mcp`, name `dashboard`.
