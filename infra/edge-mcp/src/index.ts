/**
 * dashboard-mcp — a one-repo MCP server so Claude Chat can read and write
 * files, open, review and merge pull requests, and run Actions workflows.
 *
 * Chat's GitHub connector is read-only for this repo. This Worker exposes
 * file, pull-request and Actions tools against one repo only, behind GitHub
 * OAuth restricted to one login. Merge requires the reviewed head sha.
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { githubAuthHandler, type AuthEnv, type Props } from "./github-auth";
import { listFiles, readFile, writeFile, RepoError, type RepoEnv } from "./github-repo";
import { editFile } from "./github-edit";
import {
  addPullRequestComment,
  compare,
  createPullRequest,
  DIFF_DEFAULT_BYTES,
  DIFF_MAX_BYTES,
  getPullRequest,
  getPullRequestDiff,
  listPullRequests,
  MERGE_METHODS,
  mergePullRequest,
} from "./github-pulls";
import {
  getRunLog,
  listRuns,
  LOG_DEFAULT_BYTES,
  LOG_MAX_BYTES,
  RUN_STATUSES,
  runWorkflow,
} from "./github-actions";

type Env = AuthEnv & RepoEnv & { MCP_OBJECT: DurableObjectNamespace };

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown) {
  const message = error instanceof RepoError || error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `ERROR: ${message}` }], isError: true };
}

const refArg = z
  .string()
  .optional()
  .describe("Branch, tag or commit sha to read from. Default: main.");

export class HandoffMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: "dashboard", version: "0.5.0" });

  async init() {
    const repo = () => `${this.env.REPO_OWNER}/${this.env.REPO_NAME}`;

    // ---- files -----------------------------------------------------------

    this.server.tool(
      "read_file",
      "Read a file from the dashboard repo at a branch, tag or sha (default main). Returns its text and its sha — pass that sha back to write_file as expected_sha to avoid clobbering a concurrent edit.",
      { path: z.string().describe("Repo-relative path, e.g. handoff.md"), ref: refArg },
      async ({ path, ref }) => {
        try {
          const file = await readFile(this.env, path, ref);
          if (!file) return ok({ repo: repo(), path, ref: ref || this.env.REPO_BRANCH, exists: false });
          return ok({ repo: repo(), ...file, exists: true });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "write_file",
      "Create or replace a file in the dashboard repo and commit it to a branch (default main; a missing branch is created from main). Read the file first at the same branch and pass its sha as expected_sha so a concurrent edit is rejected instead of overwritten.",
      {
        path: z.string().describe("Repo-relative path, e.g. handoff.md"),
        content: z.string().describe("Full new file contents — this replaces the file, it does not append"),
        message: z.string().describe("Commit message, e.g. 'handoff: chat update 2026-09-05'"),
        expected_sha: z
          .string()
          .optional()
          .describe("The sha from read_file at the same branch. Omit only when creating a new file."),
        branch: z
          .string()
          .optional()
          .describe("Branch to commit to. Default: main. Created from main if it does not exist."),
      },
      async ({ path, content, message, expected_sha, branch }) => {
        try {
          return ok({
            repo: repo(),
            ...(await writeFile(this.env, path, content, message, expected_sha, branch)),
          });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "edit_file",
      "Replace text in an existing file and commit it to a branch (default main; a missing branch is created from main), without resending the file. old_text must match the file exactly, whitespace and newlines included, and exactly once unless replace_all is true: add surrounding text until it is unique. An empty new_text deletes the match. To add text, include an anchor line in old_text and repeat it in new_text. Prefer this over write_file for any change to a large file.",
      {
        path: z.string().describe("Repo-relative path of an existing file, e.g. docs/ROADMAP.md"),
        old_text: z.string().describe("Exact text to replace. Must match once unless replace_all is true."),
        new_text: z.string().describe("Replacement text. Empty string deletes the match."),
        message: z.string().describe("Commit message"),
        replace_all: z.boolean().default(false).describe("Replace every match instead of requiring one. Default false."),
        branch: z
          .string()
          .optional()
          .describe("Branch to commit to. Default: main. Created from main if it does not exist."),
        expected_sha: z
          .string()
          .optional()
          .describe("Optional: the sha from read_file at the same branch. The edit is refused if the file changed since."),
      },
      async ({ path, old_text, new_text, message, replace_all, branch, expected_sha }) => {
        try {
          return ok({
            repo: repo(),
            ...(await editFile(this.env, path, old_text, new_text, message, replace_all, branch, expected_sha)),
          });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "list_files",
      "List one directory in the dashboard repo (non-recursive) at a branch, tag or sha (default main).",
      { path: z.string().default("").describe("Directory path; empty string for the repo root"), ref: refArg },
      async ({ path, ref }) => {
        try {
          return ok({
            repo: repo(),
            path,
            ref: ref || this.env.REPO_BRANCH,
            entries: await listFiles(this.env, path, ref),
          });
        } catch (error) {
          return fail(error);
        }
      },
    );

    // ---- pull requests (read) --------------------------------------------

    this.server.tool(
      "list_pull_requests",
      "List pull requests in the dashboard repo with head/base branch, head_sha, mergeable_state and changed-file count. Each row carries asks_found: whether docs/ops/asks/<head branch, '/' replaced by '--'>.md exists on main. mergeable_state 'unknown' means GitHub is still computing it; call again.",
      {
        state: z
          .enum(["open", "closed", "all"])
          .default("open")
          .describe("Which PRs to list. Default: open."),
      },
      async ({ state }) => {
        try {
          return ok({ repo: repo(), state, pull_requests: await listPullRequests(this.env, state) });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "get_pull_request",
      "One pull request, asks first. 'asks' is the list of asks for this branch, read from docs/ops/asks/<head branch, '/' replaced by '--'>.md on main (never from the PR branch). 'checks' is the Actions workflow runs and the combined commit status for the head sha; available:false means the token cannot read them, not that the checks passed. Then title, body, branches, head_sha, mergeable_state, and every changed file with status, additions, deletions and a per-file patch (patches over 30 KB are truncated; use get_pull_request_diff for the full text).",
      { number: z.number().int().positive().describe("Pull request number") },
      async ({ number }) => {
        try {
          // asks and checks lead the result; a reviewer must see them before the diff.
          const { asks, checks, ...pull } = await getPullRequest(this.env, number);
          return ok({ asks, checks, repo: repo(), ...pull });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "get_pull_request_diff",
      `Unified diff of a pull request as text, paginated by byte offset. Start at offset 0; if next_offset is not null, call again with offset = next_offset. Default page ${DIFF_DEFAULT_BYTES} bytes, max ${DIFF_MAX_BYTES}.`,
      {
        number: z.number().int().positive().describe("Pull request number"),
        offset: z.number().int().nonnegative().default(0).describe("Byte offset into the diff. Default 0."),
        max_bytes: z
          .number()
          .int()
          .positive()
          .max(DIFF_MAX_BYTES)
          .default(DIFF_DEFAULT_BYTES)
          .describe(`Bytes per page. Default ${DIFF_DEFAULT_BYTES}, max ${DIFF_MAX_BYTES}.`),
      },
      async ({ number, offset, max_bytes }) => {
        try {
          return ok({ repo: repo(), ...(await getPullRequestDiff(this.env, number, offset, max_bytes)) });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "compare",
      "Compare two refs (base...head): files changed on head since it diverged from base, each with status, additions, deletions and a per-file patch (truncated over 30 KB). Also reports ahead_by / behind_by.",
      {
        base: z.string().describe("Base branch, tag or sha, e.g. main"),
        head: z.string().describe("Head branch, tag or sha, e.g. roster-fit"),
      },
      async ({ base, head }) => {
        try {
          return ok({ repo: repo(), ...(await compare(this.env, base, head)) });
        } catch (error) {
          return fail(error);
        }
      },
    );

    // ---- pull requests (write) -------------------------------------------

    this.server.tool(
      "add_pull_request_comment",
      "Post a conversation comment on a pull request (Markdown).",
      {
        number: z.number().int().positive().describe("Pull request number"),
        body: z.string().describe("Comment body in Markdown"),
      },
      async ({ number, body }) => {
        try {
          return ok({ repo: repo(), ...(await addPullRequestComment(this.env, number, body)) });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "create_pull_request",
      "Open a pull request from a branch of this repo into base (default main). Fails with 422 if there are no commits between them or a PR for that head is already open.",
      {
        head: z.string().describe("Branch with the changes, e.g. roster-fit"),
        base: z.string().optional().describe("Branch to merge into. Default: main."),
        title: z.string().describe("PR title"),
        body: z.string().optional().describe("PR description (Markdown)"),
        draft: z.boolean().default(false).describe("Open as a draft. Default false."),
      },
      async ({ head, base, title, body, draft }) => {
        try {
          return ok({ repo: repo(), ...(await createPullRequest(this.env, head, base, title, body, draft)) });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "merge_pull_request",
      "Merge an open, non-draft pull request. expected_head_sha is required: the head_sha you reviewed (from get_pull_request or list_pull_requests). If anything was pushed after that, the merge is refused. Only merge when Sergio has asked for it.",
      {
        number: z.number().int().positive().describe("Pull request number"),
        expected_head_sha: z.string().describe("Full 40-char head sha that was reviewed"),
        method: z.enum(MERGE_METHODS).default("merge").describe("merge (default), squash or rebase"),
        commit_title: z.string().optional().describe("Optional merge commit title"),
      },
      async ({ number, expected_head_sha, method, commit_title }) => {
        try {
          return ok({
            repo: repo(),
            ...(await mergePullRequest(this.env, number, expected_head_sha, method, commit_title)),
          });
        } catch (error) {
          return fail(error);
        }
      },
    );

    // ---- GitHub Actions --------------------------------------------------

    this.server.tool(
      "list_runs",
      "List recent GitHub Actions workflow runs in this repo, newest first: id, workflow file, event, status, conclusion, branch, times, url. Filter by workflow file (e.g. deploy.yml), status, branch or event.",
      {
        workflow: z.string().optional().describe("Workflow file name, e.g. deploy.yml. Omit for all workflows."),
        status: z.enum(RUN_STATUSES).optional().describe("Filter: queued, in_progress, completed, success, failure, cancelled."),
        branch: z.string().optional().describe("Filter by branch."),
        event: z.string().optional().describe("Filter by trigger, e.g. schedule, workflow_dispatch, push."),
        limit: z.number().int().min(1).max(50).default(10).describe("Rows to return. Default 10, max 50."),
      },
      async ({ workflow, status, branch, event, limit }) => {
        try {
          return ok({ repo: repo(), runs: await listRuns(this.env, { workflow, status, branch, event, limit }) });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "get_run_log",
      `One workflow run: summary, every job's step list (with failed steps named), and the tail of each non-successful job's log with timestamps stripped. all_jobs=true includes logs of successful jobs too. Log budget default ${LOG_DEFAULT_BYTES} bytes, max ${LOG_MAX_BYTES}, split across jobs.`,
      {
        run_id: z.number().int().positive().describe("Run id from list_runs or run_workflow"),
        max_bytes: z
          .number()
          .int()
          .positive()
          .max(LOG_MAX_BYTES)
          .default(LOG_DEFAULT_BYTES)
          .describe(`Total log bytes to return. Default ${LOG_DEFAULT_BYTES}, max ${LOG_MAX_BYTES}.`),
        all_jobs: z.boolean().default(false).describe("Include logs of successful jobs. Default false."),
      },
      async ({ run_id, max_bytes, all_jobs }) => {
        try {
          return ok({ repo: repo(), ...(await getRunLog(this.env, run_id, max_bytes, all_jobs)) });
        } catch (error) {
          return fail(error);
        }
      },
    );

    this.server.tool(
      "run_workflow",
      "Dispatch an existing workflow that declares workflow_dispatch (e.g. deploy.yml). Returns the new run id when GitHub lists it within ~8s; then poll list_runs / get_run_log. Cannot create or edit workflows.",
      {
        workflow: z.string().describe("Workflow file name, e.g. deploy.yml"),
        ref: z.string().optional().describe("Branch or tag to run on. Default: main."),
        inputs: z
          .record(z.string(), z.string())
          .default({})
          .describe("workflow_dispatch inputs as strings, e.g. {\"key\": \"value\"}"),
      },
      async ({ workflow, ref, inputs }) => {
        try {
          return ok({ repo: repo(), ...(await runWorkflow(this.env, workflow, ref, inputs)) });
        } catch (error) {
          return fail(error);
        }
      },
    );
  }
}

const provider = new OAuthProvider({
  apiHandlers: { "/mcp": HandoffMCP.serve("/mcp") },
  defaultHandler: githubAuthHandler as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => provider.fetch(request, env, ctx),
};
