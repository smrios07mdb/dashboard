/**
 * GitHub Actions tools, pinned to the same one repo as github-repo.ts.
 *
 * PAT needs Actions: read (list_runs, get_run_log) and Actions: read & write
 * (run_workflow). Nothing here can touch another repository, secrets, or
 * workflow files; run_workflow only dispatches workflows that already exist.
 */

import { gh, ghError, normalizeRef, repoPath, RepoError, type RepoEnv } from "./github-repo";

export const LOG_DEFAULT_BYTES = 40_000;
export const LOG_MAX_BYTES = 200_000;

/** Workflow file name (deploy.yml) or numeric workflow id. */
export function normalizeWorkflow(raw: string): string {
  const w = raw.trim().replace(/^\.github\/workflows\//, "");
  if (/^\d+$/.test(w) || /^[A-Za-z0-9._-]+\.ya?ml$/.test(w)) return w;
  throw new RepoError(`invalid workflow: ${raw} (use a file name like deploy.yml or a numeric id)`);
}

interface RawRun {
  id: number;
  name: string;
  path: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_branch: string;
  head_sha: string;
  run_attempt: number;
  created_at: string;
  run_started_at?: string;
  updated_at: string;
  html_url: string;
}

export interface RunRow {
  id: number;
  workflow: string;
  name: string;
  event: string;
  status: string;
  conclusion: string | null;
  branch: string;
  sha: string;
  attempt: number;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  url: string;
}

function row(r: RawRun): RunRow {
  return {
    id: r.id,
    workflow: r.path.replace(/^\.github\/workflows\//, "").replace(/@.*$/, ""),
    name: r.name,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion,
    branch: r.head_branch,
    sha: r.head_sha.slice(0, 7),
    attempt: r.run_attempt,
    created_at: r.created_at,
    started_at: r.run_started_at ?? null,
    updated_at: r.updated_at,
    url: r.html_url,
  };
}

const STATUSES = ["queued", "in_progress", "completed", "success", "failure", "cancelled"] as const;
export type RunStatus = (typeof STATUSES)[number];
export const RUN_STATUSES = STATUSES;

/** Most recent runs, newest first, optionally for one workflow and/or status. */
export async function listRuns(
  env: RepoEnv,
  opts: { workflow?: string; status?: RunStatus; branch?: string; event?: string; limit?: number } = {},
): Promise<RunRow[]> {
  const q = new URLSearchParams({ per_page: String(Math.min(Math.max(opts.limit ?? 10, 1), 50)) });
  if (opts.status) q.set("status", opts.status);
  if (opts.branch) q.set("branch", normalizeRef(opts.branch, ""));
  if (opts.event) q.set("event", opts.event);
  const base = opts.workflow
    ? `/actions/workflows/${encodeURIComponent(normalizeWorkflow(opts.workflow))}/runs`
    : "/actions/runs";
  const res = await gh(env, repoPath(env, `${base}?${q}`));
  if (!res.ok) throw await ghError("list runs", res);
  const body = (await res.json()) as { workflow_runs: RawRun[] };
  return body.workflow_runs.map(row);
}

interface RawStep {
  name: string;
  number: number;
  status: string;
  conclusion: string | null;
}
interface RawJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps?: RawStep[];
}

const TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z /;

/** Fetch one job's plain-text log. GitHub answers with a redirect to a signed URL; follow it without the PAT. */
async function jobLog(env: RepoEnv, jobId: number): Promise<string> {
  const res = await gh(env, repoPath(env, `/actions/jobs/${jobId}/logs`), { redirect: "manual" });
  if (res.status === 302 || res.status === 301) {
    const loc = res.headers.get("location");
    if (!loc) throw new RepoError(`job ${jobId} log: redirect without location`);
    const blob = await fetch(loc);
    if (!blob.ok) throw new RepoError(`job ${jobId} log download failed: ${blob.status}`);
    return blob.text();
  }
  if (res.ok) return res.text();
  if (res.status === 410) return "(log expired or deleted)";
  throw await ghError(`job ${jobId} log`, res);
}

export interface RunLog {
  run: RunRow;
  jobs: {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    failed_steps: string[];
    steps: string[];
    log: string;
    log_bytes: number;
    truncated: boolean;
  }[];
}

/**
 * Run summary plus each job's log. Logs are tailed (errors land at the end),
 * timestamps stripped. By default only jobs that did not succeed get a log;
 * all_jobs=true includes successful ones too.
 */
export async function getRunLog(env: RepoEnv, runId: number, maxBytes = LOG_DEFAULT_BYTES, allJobs = false): Promise<RunLog> {
  const runRes = await gh(env, repoPath(env, `/actions/runs/${runId}`));
  if (runRes.status === 404) throw new RepoError(`no run ${runId} in this repo`, 404);
  if (!runRes.ok) throw await ghError(`run ${runId}`, runRes);
  const run = row((await runRes.json()) as RawRun);

  const jobsRes = await gh(env, repoPath(env, `/actions/runs/${runId}/jobs?per_page=50`));
  if (!jobsRes.ok) throw await ghError(`run ${runId} jobs`, jobsRes);
  const { jobs } = (await jobsRes.json()) as { jobs: RawJob[] };

  const wanted = jobs.filter((j) => allJobs || (j.conclusion !== "success" && j.conclusion !== "skipped"));
  const budget = Math.max(2_000, Math.floor(Math.min(maxBytes, LOG_MAX_BYTES) / Math.max(wanted.length, 1)));

  const out: RunLog["jobs"] = [];
  for (const j of jobs) {
    const steps = (j.steps ?? []).map((s) => `${s.number}. ${s.name}: ${s.conclusion ?? s.status}`);
    const failed = (j.steps ?? []).filter((s) => s.conclusion === "failure").map((s) => s.name);
    let log = "";
    let bytes = 0;
    let truncated = false;
    if (wanted.includes(j)) {
      if (j.status !== "completed") {
        log = "(job still running; logs are available once it completes)";
      } else {
        const text = (await jobLog(env, j.id))
          .split("\n")
          .map((l) => l.replace(TS, ""))
          .join("\n");
        bytes = text.length;
        truncated = text.length > budget;
        log = truncated ? "…[head truncated]\n" + text.slice(-budget) : text;
      }
    }
    out.push({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, failed_steps: failed, steps, log, log_bytes: bytes, truncated });
  }
  return { run, jobs: out };
}

export interface DispatchResult {
  workflow: string;
  ref: string;
  inputs: Record<string, string>;
  dispatched_at: string;
  run: RunRow | null;
  note: string;
}

/**
 * Dispatch an existing workflow_dispatch workflow, then look briefly for the
 * run it created so the caller gets a run id to poll with list_runs / get_run_log.
 */
export async function runWorkflow(
  env: RepoEnv,
  rawWorkflow: string,
  rawRef?: string,
  inputs: Record<string, string> = {},
): Promise<DispatchResult> {
  const workflow = normalizeWorkflow(rawWorkflow);
  const ref = normalizeRef(rawRef, env.REPO_BRANCH);
  const since = new Date(Date.now() - 5_000).toISOString();

  const res = await gh(env, repoPath(env, `/actions/workflows/${encodeURIComponent(workflow)}/dispatches`), {
    method: "POST",
    body: JSON.stringify({ ref, inputs }),
  });
  if (res.status === 404) throw new RepoError(`workflow ${workflow} not found (or the PAT lacks Actions access)`, 404);
  if (res.status === 422) throw new RepoError(`dispatch ${workflow}@${ref} rejected: ${await res.text()} (does it declare workflow_dispatch, and are the inputs valid?)`, 422);
  if (!res.ok) throw await ghError(`dispatch ${workflow}@${ref}`, res);

  let run: RunRow | null = null;
  for (let i = 0; i < 4 && !run; i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    const runs = await listRuns(env, { workflow, event: "workflow_dispatch", limit: 5 });
    run = runs.find((r) => r.created_at >= since && r.branch === ref) ?? null;
  }
  return {
    workflow,
    ref,
    inputs,
    dispatched_at: new Date().toISOString(),
    run,
    note: run
      ? `Run ${run.id} is ${run.status}. Poll list_runs or get_run_log with this id.`
      : "Dispatched, but the run has not shown up yet. Call list_runs for this workflow in a few seconds.",
  };
}
