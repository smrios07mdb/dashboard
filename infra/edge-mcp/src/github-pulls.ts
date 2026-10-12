/**
 * Pull-request tools, pinned to the same repo as github-repo.ts: reads, a PR
 * comment, opening a PR, and merging one. Merge is guarded: the caller must
 * pass the head sha it reviewed, and GitHub rejects the merge if the head has
 * moved since.
 */

import {
  encodeRef,
  gh,
  ghError,
  listFiles,
  normalizeRef,
  readFile,
  repoPath,
  RepoError,
  type RepoEnv,
} from "./github-repo";

/** Hard ceiling on one diff page. Claude's tool results get unwieldy well before this. */
export const DIFF_MAX_BYTES = 200_000;
export const DIFF_DEFAULT_BYTES = 60_000;
/** Per-file patch cap in get_pull_request / compare so one giant lockfile cannot swamp the result. */
const PATCH_CAP = 30_000;
const FILES_PAGE = 100;
const FILES_MAX_PAGES = 3;
const LIST_MAX = 30;

export type PullState = "open" | "closed" | "all";

export interface PullSummary {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  head: string;
  head_sha: string;
  base: string;
  mergeable_state: string;
  changed_files: number;
  html_url: string;
  updated_at: string;
  /** Set by listPullRequests only: does docs/ops/asks/<head with "/" as "--">.md exist on main? */
  asks_found?: boolean;
}

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  previous_filename?: string;
  patch?: string;
  patch_truncated?: boolean;
}

export interface PullDetail extends PullSummary {
  /** First field of the tool result: the prompt's asks, read from main. */
  asks: Asks;
  checks: Checks;
  body: string | null;
  author: string;
  additions: number;
  deletions: number;
  commits: number;
  mergeable: boolean | null;
  files: ChangedFile[];
  files_truncated: boolean;
}

interface RawPull {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  body: string | null;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  mergeable?: boolean | null;
  mergeable_state?: string;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  commits?: number;
  html_url: string;
  updated_at: string;
}

interface RawFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  previous_filename?: string;
  patch?: string;
}

function checkNumber(n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new RepoError(`invalid pull request number: ${n}`);
  return n;
}

// ---- asks --------------------------------------------------------------

/**
 * Where Chat writes the asks for a branch. One flat file per branch, with "/"
 * replaced by "--" so a branch like fix/tto-budget-followups maps to
 * docs/ops/asks/fix--tto-budget-followups.md.
 */
export const ASKS_DIR = "docs/ops/asks";

export function asksPath(headRef: string): string {
  return `${ASKS_DIR}/${headRef.replace(/\//g, "--")}.md`;
}

export const ASKS_MISSING_WARNING =
  "NO ASKS FILE FOR THIS BRANCH. Do not clear this PR to merge. Find the lane file and the prompt's asks first, or ask Sergio which prompt this PR answers.";

export interface AsksFound {
  found: true;
  path: string;
  content: string;
}

export interface AsksMissing {
  found: false;
  path: string;
  warning: string;
}

export type Asks = AsksFound | AsksMissing;

/**
 * The asks list for a PR's head branch, always read from REPO_BRANCH (main)
 * and never from the PR branch: the list a PR is reviewed against must not be
 * editable by the branch under review.
 *
 * A lookup that fails for any reason is reported as "not found" with the
 * warning, because a review that cannot see the asks must not start either
 * way.
 */
export async function getAsks(env: RepoEnv, headRef: string): Promise<Asks> {
  const path = asksPath(headRef);
  try {
    const file = await readFile(env, path, env.REPO_BRANCH);
    if (file) return { found: true, path, content: file.content };
    return { found: false, path, warning: ASKS_MISSING_WARNING };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { found: false, path, warning: `${ASKS_MISSING_WARNING} (lookup failed: ${message})` };
  }
}

/**
 * Every asks file on REPO_BRANCH, as one set of repo paths, from a single
 * directory listing.
 *
 * listPullRequests needs asks_found for up to LIST_MAX pull requests, and it
 * already spends one subrequest on the list plus one per PR. A Worker
 * invocation gets 50 external subrequests on the Free plan, so a read per PR
 * would put a 30-row list over the limit; one listing keeps the whole call at
 * N + 2.
 *
 * Never throws. A missing or unreadable directory means every row reports
 * asks_found false and the list itself still comes back.
 */
export async function asksIndex(env: RepoEnv): Promise<Set<string>> {
  try {
    const entries = await listFiles(env, ASKS_DIR, env.REPO_BRANCH);
    return new Set(entries.filter((entry) => entry.type === "file").map((entry) => entry.path));
  } catch {
    return new Set();
  }
}

// ---- checks ------------------------------------------------------------

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface ChecksAvailable {
  available: true;
  head_sha: string;
  combined_status: string;
  summary: string;
  runs: CheckRun[];
}

export interface ChecksUnavailable {
  available: false;
  reason: string;
}

export type Checks = ChecksAvailable | ChecksUnavailable;

/** Conclusions that mean the check did not pass. Anything else completed counts as "other" (neutral, skipped). */
const FAILING_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
  "error",
]);

export function summarizeChecks(runs: CheckRun[]): string {
  if (runs.length === 0) return "no checks reported for this sha";
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let other = 0;
  for (const run of runs) {
    if (run.status !== "completed") pending++;
    else if (run.conclusion === "success") passed++;
    else if (run.conclusion && FAILING_CONCLUSIONS.has(run.conclusion)) failed++;
    else other++;
  }
  const parts = [`${passed} passed`, `${failed} failed`, `${pending} pending`];
  if (other) parts.push(`${other} other`);
  return parts.join(", ");
}

/**
 * Actions workflow runs plus the combined commit status for one sha, flattened
 * into one list.
 *
 * Not /commits/{sha}/check-runs: GitHub has no "Checks" permission for
 * fine-grained personal access tokens, so that endpoint can never succeed with
 * this token. Workflow runs are the same information for a repo whose CI is
 * GitHub Actions, and they need only Actions: read.
 *
 * Both calls need PAT permissions the file and pull-request tools do not
 * (Actions: read, Commit statuses: read); when they are missing the field says
 * so instead of disappearing, so a reviewer can tell "no checks ran" from "I
 * cannot see the checks".
 */
export async function getChecks(env: RepoEnv, headSha: string): Promise<Checks> {
  try {
    const sha = encodeRef(headSha);
    const runs: CheckRun[] = [];

    const runsRes = await gh(env, repoPath(env, `/actions/runs?head_sha=${sha}&per_page=${FILES_PAGE}`));
    if (!runsRes.ok) throw await ghError(`workflow runs for ${headSha}`, runsRes);
    const runsBody = (await runsRes.json()) as {
      workflow_runs?: { name: string | null; status: string | null; conclusion: string | null }[];
    };
    for (const run of runsBody.workflow_runs ?? []) {
      runs.push({ name: run.name ?? "", status: run.status ?? "", conclusion: run.conclusion ?? null });
    }

    const statusRes = await gh(env, repoPath(env, `/commits/${sha}/status?per_page=${FILES_PAGE}`));
    if (!statusRes.ok) throw await ghError(`commit status for ${headSha}`, statusRes);
    const statusBody = (await statusRes.json()) as {
      state: string;
      statuses?: { context: string; state: string }[];
    };
    const statuses = statusBody.statuses ?? [];
    for (const status of statuses) {
      runs.push({
        name: status.context,
        status: status.state === "pending" ? "in_progress" : "completed",
        conclusion: status.state === "pending" ? null : status.state,
      });
    }

    return {
      available: true,
      head_sha: headSha,
      // GitHub reports "pending" for a sha nothing has posted a status on; say "none" instead.
      combined_status: statuses.length ? statusBody.state : "none",
      summary: summarizeChecks(runs),
      runs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, reason: message };
  }
}

function summarize(p: RawPull): PullSummary {
  return {
    number: p.number,
    title: p.title,
    state: p.state,
    draft: p.draft ?? false,
    head: p.head.ref,
    head_sha: p.head.sha,
    base: p.base.ref,
    // "unknown" means GitHub is still computing it; a second call a moment later usually settles it.
    mergeable_state: p.mergeable_state ?? "unknown",
    changed_files: p.changed_files ?? 0,
    html_url: p.html_url,
    updated_at: p.updated_at,
  };
}

function capPatch(f: RawFile): ChangedFile {
  const out: ChangedFile = {
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
  };
  if (f.previous_filename) out.previous_filename = f.previous_filename;
  if (f.patch !== undefined) {
    if (f.patch.length > PATCH_CAP) {
      out.patch = f.patch.slice(0, PATCH_CAP);
      out.patch_truncated = true;
    } else {
      out.patch = f.patch;
    }
  }
  return out;
}

async function fetchPull(env: RepoEnv, number: number): Promise<RawPull> {
  const res = await gh(env, repoPath(env, `/pulls/${number}`));
  if (res.status === 404) throw new RepoError(`no pull request #${number}`, 404);
  if (!res.ok) throw await ghError(`get pull request #${number}`, res);
  return (await res.json()) as RawPull;
}

/**
 * List pull requests. The list endpoint omits mergeable_state and
 * changed_files, so each PR is fetched individually afterwards (capped at
 * LIST_MAX per call, which is far above this repo's open-PR count).
 * Each row also reports whether an asks file exists on main for its head
 * branch, from one listing of docs/ops/asks shared by the whole list.
 */
export async function listPullRequests(env: RepoEnv, state: PullState = "open"): Promise<PullSummary[]> {
  const res = await gh(
    env,
    repoPath(env, `/pulls?state=${state}&sort=updated&direction=desc&per_page=${LIST_MAX}`),
  );
  if (!res.ok) throw await ghError("list pull requests", res);
  const list = (await res.json()) as RawPull[];
  const detailed = await Promise.all(list.map((p) => fetchPull(env, p.number)));
  const asks = await asksIndex(env);
  return detailed.map((p) => ({ ...summarize(p), asks_found: asks.has(asksPath(p.head.ref)) }));
}

/** One PR with its asks, its checks, and its changed files (status, additions, deletions; patch capped per file). */
export async function getPullRequest(env: RepoEnv, rawNumber: number): Promise<PullDetail> {
  const number = checkNumber(rawNumber);
  const pull = await fetchPull(env, number);
  const [asks, checks] = await Promise.all([getAsks(env, pull.head.ref), getChecks(env, pull.head.sha)]);

  const files: ChangedFile[] = [];
  let truncated = false;
  for (let page = 1; page <= FILES_MAX_PAGES; page++) {
    const res = await gh(env, repoPath(env, `/pulls/${number}/files?per_page=${FILES_PAGE}&page=${page}`));
    if (!res.ok) throw await ghError(`list files of pull request #${number}`, res);
    const batch = (await res.json()) as RawFile[];
    files.push(...batch.map(capPatch));
    if (batch.length < FILES_PAGE) break;
    if (page === FILES_MAX_PAGES) truncated = true;
  }

  return {
    // asks first: a review that cannot see the asks must not start.
    asks,
    checks,
    ...summarize(pull),
    body: pull.body,
    author: pull.user?.login ?? "",
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    commits: pull.commits ?? 0,
    mergeable: pull.mergeable ?? null,
    files,
    files_truncated: truncated,
  };
}

export interface DiffPage {
  number: number;
  offset: number;
  bytes_returned: number;
  total_bytes: number;
  next_offset: number | null;
  diff: string;
}

/**
 * Unified diff of a PR, paginated by byte offset. GitHub returns the whole
 * diff in one response; we slice it here so a large PR comes back in pages
 * the tool result can hold. A slice boundary may fall inside a multi-byte
 * character; the decoder replaces the fragment rather than failing.
 */
export async function getPullRequestDiff(
  env: RepoEnv,
  rawNumber: number,
  offset = 0,
  maxBytes = DIFF_DEFAULT_BYTES,
): Promise<DiffPage> {
  const number = checkNumber(rawNumber);
  if (!Number.isInteger(offset) || offset < 0) throw new RepoError(`invalid offset: ${offset}`);
  const limit = Math.max(1, Math.min(Math.floor(maxBytes), DIFF_MAX_BYTES));

  const res = await gh(env, repoPath(env, `/pulls/${number}`), {
    headers: { accept: "application/vnd.github.diff" },
  });
  if (res.status === 404) throw new RepoError(`no pull request #${number}`, 404);
  if (res.status === 406) {
    throw new RepoError(
      `pull request #${number} is too large for GitHub's diff endpoint; use get_pull_request (per-file patches) or compare(base, head) instead`,
      406,
    );
  }
  if (!res.ok) throw await ghError(`diff of pull request #${number}`, res);

  const bytes = new Uint8Array(await res.arrayBuffer());
  const total = bytes.byteLength;
  const start = Math.min(offset, total);
  const end = Math.min(start + limit, total);
  const diff = new TextDecoder().decode(bytes.subarray(start, end));
  return {
    number,
    offset: start,
    bytes_returned: end - start,
    total_bytes: total,
    next_offset: end < total ? end : null,
    diff,
  };
}

export interface CompareResult {
  base: string;
  head: string;
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  html_url: string;
  files: ChangedFile[];
  files_truncated: boolean;
}

/** Two-dot-free compare (base...head): files changed on head since it diverged from base, with a capped patch per file. */
export async function compare(env: RepoEnv, rawBase: string, rawHead: string): Promise<CompareResult> {
  const base = normalizeRef(rawBase, env.REPO_BRANCH);
  const head = normalizeRef(rawHead, "");
  if (!head) throw new RepoError("head is required");

  const files: ChangedFile[] = [];
  let meta: { status: string; ahead_by: number; behind_by: number; total_commits: number; html_url: string } | null =
    null;
  let truncated = false;
  for (let page = 1; page <= FILES_MAX_PAGES; page++) {
    const res = await gh(
      env,
      repoPath(env, `/compare/${encodeRef(base)}...${encodeRef(head)}?per_page=${FILES_PAGE}&page=${page}`),
    );
    if (res.status === 404) throw new RepoError(`compare ${base}...${head}: one of the refs does not exist`, 404);
    if (!res.ok) throw await ghError(`compare ${base}...${head}`, res);
    const body = (await res.json()) as {
      status: string;
      ahead_by: number;
      behind_by: number;
      total_commits: number;
      html_url: string;
      files?: RawFile[];
    };
    meta ??= body;
    const batch = body.files ?? [];
    files.push(...batch.map(capPatch));
    if (batch.length < FILES_PAGE) break;
    if (page === FILES_MAX_PAGES) truncated = true;
  }

  return {
    base,
    head,
    status: meta!.status,
    ahead_by: meta!.ahead_by,
    behind_by: meta!.behind_by,
    total_commits: meta!.total_commits,
    html_url: meta!.html_url,
    files,
    files_truncated: truncated,
  };
}

export interface CommentResult {
  number: number;
  id: number;
  html_url: string;
  created_at: string;
}

/** Post one conversation-level comment on a PR (not a review, not inline). */
export async function addPullRequestComment(env: RepoEnv, rawNumber: number, body: string): Promise<CommentResult> {
  const number = checkNumber(rawNumber);
  if (!body.trim()) throw new RepoError("comment body is required");
  const res = await gh(env, repoPath(env, `/issues/${number}/comments`), {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  if (res.status === 404) throw new RepoError(`no pull request #${number}`, 404);
  if (!res.ok) throw await ghError(`comment on pull request #${number}`, res);
  const out = (await res.json()) as { id: number; html_url: string; created_at: string };
  return { number, id: out.id, html_url: out.html_url, created_at: out.created_at };
}

// ---- open / merge ------------------------------------------------------

/** Open a PR from head into base (default main). Same-repo branches only. */
export async function createPullRequest(
  env: RepoEnv,
  rawHead: string,
  rawBase: string | undefined,
  title: string,
  body?: string,
  draft = false,
): Promise<PullSummary> {
  const head = normalizeRef(rawHead, "");
  if (!head) throw new RepoError("head is required");
  const base = normalizeRef(rawBase ?? "", env.REPO_BRANCH);
  if (head === base) throw new RepoError(`head and base are both ${head}`);
  if (!title.trim()) throw new RepoError("title is required");

  const res = await gh(env, repoPath(env, "/pulls"), {
    method: "POST",
    body: JSON.stringify({ title: title.trim(), head, base, body: body ?? "", draft }),
  });
  if (res.status === 422) {
    // No commits between the refs, a PR for this head already open, or a missing branch.
    const detail = await res.text();
    throw new RepoError(`open PR ${head} -> ${base} rejected (422): ${detail.slice(0, 600)}`, 422);
  }
  if (!res.ok) throw await ghError(`open pull request ${head} -> ${base}`, res);
  return summarize((await res.json()) as RawPull);
}

export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export interface MergeResult {
  number: number;
  merged: boolean;
  sha: string;
  message: string;
  method: MergeMethod;
  head: string;
  base: string;
  html_url: string;
}

/**
 * Merge an open, non-draft PR. expectedHeadSha is required and is passed to
 * GitHub as `sha`, so if anything was pushed to the branch after review the
 * merge is refused (409) instead of shipping unreviewed commits.
 */
export async function mergePullRequest(
  env: RepoEnv,
  rawNumber: number,
  expectedHeadSha: string,
  method: MergeMethod = "merge",
  commitTitle?: string,
): Promise<MergeResult> {
  const number = checkNumber(rawNumber);
  if (!/^[0-9a-f]{40}$/i.test(expectedHeadSha)) {
    throw new RepoError("expected_head_sha must be the full 40-char head_sha from get_pull_request or list_pull_requests");
  }
  const pull = await fetchPull(env, number);
  if (pull.state !== "open") throw new RepoError(`pull request #${number} is ${pull.state}, not open`);
  if (pull.draft) throw new RepoError(`pull request #${number} is a draft`);
  if (pull.head.sha.toLowerCase() !== expectedHeadSha.toLowerCase()) {
    throw new RepoError(
      `head moved: #${number} is at ${pull.head.sha}, not ${expectedHeadSha}. Re-review before merging.`,
      409,
    );
  }

  const payload: Record<string, string> = { merge_method: method, sha: pull.head.sha };
  if (commitTitle?.trim()) payload.commit_title = commitTitle.trim();
  const res = await gh(env, repoPath(env, `/pulls/${number}/merge`), {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (res.status === 405 || res.status === 409 || res.status === 422) {
    const detail = await res.text();
    throw new RepoError(`merge of #${number} refused (${res.status}): ${detail.slice(0, 600)}`, res.status);
  }
  if (!res.ok) throw await ghError(`merge pull request #${number}`, res);
  const out = (await res.json()) as { sha: string; merged: boolean; message: string };
  return {
    number,
    merged: out.merged,
    sha: out.sha,
    message: out.message,
    method,
    head: pull.head.ref,
    base: pull.base.ref,
    html_url: pull.html_url,
  };
}
