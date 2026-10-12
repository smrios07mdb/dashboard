/**
 * Unit tests for the asks and checks fields of the pull-request tools.
 *
 * No network: global fetch is replaced with a route table keyed by the GitHub
 * API path, so each test states exactly what GitHub returns.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { asksIndex, asksPath, getAsks, getChecks, getPullRequest, listPullRequests } from "../src/github-pulls";
import type { RepoEnv } from "../src/github-repo";

const env: RepoEnv = {
  REPO_OWNER: "smrios07mdb",
  REPO_NAME: "big-ideas",
  REPO_BRANCH: "main",
  GITHUB_REPO_PAT: "pat",
};

const PREFIX = "https://api.github.com/repos/smrios07mdb/big-ideas";

type Route = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> };

/** Install a fetch that answers only the listed paths (path + query, minus the repo prefix). 404 for the rest. */
function routes(table: Record<string, Route>): string[] {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const key = String(url).slice(PREFIX.length);
    seen.push(key);
    const route = table[key];
    if (!route) return new Response("Not Found", { status: 404 });
    const status = route.status ?? 200;
    const body = route.text ?? JSON.stringify(route.body ?? {});
    return new Response(body, { status, headers: route.headers });
  });
  return seen;
}

/** A GitHub Contents response for a file whose text is `content`. */
function contentsFile(content: string): Route {
  return { body: { type: "file", sha: "blob1", size: content.length, content: btoa(content) } };
}

function pull(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      number: 42,
      title: "a pull request",
      state: "open",
      draft: false,
      body: "the PR body",
      user: { login: "smrios07mdb" },
      head: { ref: "ops/connector-asks", sha: "headsha" },
      base: { ref: "main" },
      mergeable: true,
      mergeable_state: "clean",
      changed_files: 1,
      additions: 2,
      deletions: 0,
      commits: 1,
      html_url: "https://github.com/smrios07mdb/big-ideas/pull/42",
      updated_at: "2026-09-19T00:00:00Z",
      ...overrides,
    },
  };
}

const NO_CHECKS: Record<string, Route> = {
  "/actions/runs?head_sha=headsha&per_page=100": { body: { total_count: 0, workflow_runs: [] } },
  "/commits/headsha/status?per_page=100": { body: { state: "pending", statuses: [] } },
};

afterEach(() => vi.unstubAllGlobals());

describe("asksPath", () => {
  it("replaces every / in a branch name with --", () => {
    expect(asksPath("fix/tto-budget-followups")).toBe("docs/ops/asks/fix--tto-budget-followups.md");
    expect(asksPath("a/b/c")).toBe("docs/ops/asks/a--b--c.md");
    expect(asksPath("nodashes")).toBe("docs/ops/asks/nodashes.md");
  });
});

describe("getAsks", () => {
  it("returns the file's full text when it exists on main", async () => {
    routes({
      "/contents/docs/ops/asks/fix--tto-budget-followups.md?ref=main": contentsFile("| A1 | do the thing |"),
    });
    const asks = await getAsks(env, "fix/tto-budget-followups");
    expect(asks.found).toBe(true);
    expect(asks).toMatchObject({
      path: "docs/ops/asks/fix--tto-budget-followups.md",
      content: "| A1 | do the thing |",
    });
  });

  it("warns, and does not clear the PR, when the file is missing", async () => {
    routes({});
    const asks = await getAsks(env, "ops/no-asks");
    expect(asks.found).toBe(false);
    expect(asks.path).toBe("docs/ops/asks/ops--no-asks.md");
    expect("warning" in asks && asks.warning).toContain("NO ASKS FILE FOR THIS BRANCH");
  });

  it("reads main, never the PR branch", async () => {
    const seen = routes({
      "/contents/docs/ops/asks/feat--x.md?ref=main": contentsFile("asks"),
    });
    await getAsks(env, "feat/x");
    expect(seen).toEqual(["/contents/docs/ops/asks/feat--x.md?ref=main"]);
  });
});

describe("getChecks", () => {
  it("merges Actions workflow runs and commit statuses and counts them", async () => {
    routes({
      "/actions/runs?head_sha=headsha&per_page=100": {
        body: {
          total_count: 3,
          workflow_runs: [
            { name: "tests", status: "completed", conclusion: "success" },
            { name: "lint", status: "completed", conclusion: "failure" },
            { name: "build", status: "in_progress", conclusion: null },
          ],
        },
      },
      "/commits/headsha/status?per_page=100": {
        body: { state: "success", statuses: [{ context: "ci/legacy", state: "success" }] },
      },
    });
    const checks = await getChecks(env, "headsha");
    expect(checks).toMatchObject({
      available: true,
      head_sha: "headsha",
      combined_status: "success",
      summary: "2 passed, 1 failed, 1 pending",
    });
    expect("runs" in checks && checks.runs).toEqual([
      { name: "tests", status: "completed", conclusion: "success" },
      { name: "lint", status: "completed", conclusion: "failure" },
      { name: "build", status: "in_progress", conclusion: null },
      { name: "ci/legacy", status: "completed", conclusion: "success" },
    ]);
  });

  it("never calls /commits/{sha}/check-runs: fine-grained tokens have no Checks permission", async () => {
    const seen = routes(NO_CHECKS);
    await getChecks(env, "headsha");
    expect(seen).toEqual(["/actions/runs?head_sha=headsha&per_page=100", "/commits/headsha/status?per_page=100"]);
  });

  it("says so when no workflow run or status reported on the sha", async () => {
    routes(NO_CHECKS);
    const checks = await getChecks(env, "headsha");
    expect(checks).toMatchObject({
      available: true,
      combined_status: "none",
      summary: "no checks reported for this sha",
    });
  });

  it("reports available:false with the missing permission, not an absent field", async () => {
    routes({
      "/actions/runs?head_sha=headsha&per_page=100": {
        status: 403,
        text: "Resource not accessible by personal access token",
        headers: { "x-accepted-github-permissions": "actions=read" },
      },
      "/commits/headsha/status?per_page=100": { body: { state: "pending", statuses: [] } },
    });
    const checks = await getChecks(env, "headsha");
    expect(checks.available).toBe(false);
    expect("reason" in checks && checks.reason).toContain("actions=read");
    expect("reason" in checks && checks.reason).toContain("workflow runs");
  });

  it("reports available:false when the commit status call is the one refused", async () => {
    routes({
      "/actions/runs?head_sha=headsha&per_page=100": { body: { total_count: 0, workflow_runs: [] } },
      "/commits/headsha/status?per_page=100": {
        status: 403,
        text: "Resource not accessible by personal access token",
        headers: { "x-accepted-github-permissions": "statuses=read" },
      },
    });
    const checks = await getChecks(env, "headsha");
    expect(checks.available).toBe(false);
    expect("reason" in checks && checks.reason).toContain("statuses=read");
  });
});

describe("getPullRequest", () => {
  it("puts asks first, then checks, then the PR itself", async () => {
    routes({
      "/pulls/42": pull(),
      "/pulls/42/files?per_page=100&page=1": { body: [] },
      "/contents/docs/ops/asks/ops--connector-asks.md?ref=main": contentsFile("| A1 | asks first |"),
      ...NO_CHECKS,
    });
    const detail = await getPullRequest(env, 42);
    expect(Object.keys(detail).slice(0, 2)).toEqual(["asks", "checks"]);
    expect(Object.keys(detail).indexOf("asks")).toBeLessThan(Object.keys(detail).indexOf("title"));
    expect(Object.keys(detail).indexOf("asks")).toBeLessThan(Object.keys(detail).indexOf("body"));
    expect(detail.asks).toMatchObject({ found: true, content: "| A1 | asks first |" });
    expect(detail.checks).toMatchObject({ available: true, summary: "no checks reported for this sha" });
  });

  it("carries the warning when the branch has no asks file", async () => {
    routes({ "/pulls/42": pull(), "/pulls/42/files?per_page=100&page=1": { body: [] }, ...NO_CHECKS });
    const detail = await getPullRequest(env, 42);
    expect(detail.asks.found).toBe(false);
    expect("warning" in detail.asks && detail.asks.warning).toContain("Do not clear this PR to merge");
  });

  it("looks the asks file up by the head branch, slashes replaced", async () => {
    const seen = routes({
      "/pulls/42": pull({ head: { ref: "fix/tto-budget-followups", sha: "headsha" } }),
      "/pulls/42/files?per_page=100&page=1": { body: [] },
      "/contents/docs/ops/asks/fix--tto-budget-followups.md?ref=main": contentsFile("asks for the slash branch"),
      ...NO_CHECKS,
    });
    const detail = await getPullRequest(env, 42);
    expect(detail.asks).toMatchObject({
      found: true,
      path: "docs/ops/asks/fix--tto-budget-followups.md",
      content: "asks for the slash branch",
    });
    expect(seen).toContain("/contents/docs/ops/asks/fix--tto-budget-followups.md?ref=main");
  });
});

describe("listPullRequests", () => {
  /** A directory listing of docs/ops/asks holding exactly these file names. */
  function asksDir(...names: string[]): Route {
    return { body: names.map((name) => ({ path: `docs/ops/asks/${name}`, type: "file", size: 10 })) };
  }

  it("reports asks_found per pull request", async () => {
    routes({
      "/pulls?state=open&sort=updated&direction=desc&per_page=30": {
        body: [{ number: 42 }, { number: 43 }],
      },
      "/pulls/42": pull({ head: { ref: "fix/tto-budget-followups", sha: "sha42" } }),
      "/pulls/43": pull({ number: 43, head: { ref: "ops/no-asks", sha: "sha43" } }),
      "/contents/docs/ops/asks?ref=main": asksDir("fix--tto-budget-followups.md"),
    });
    const list = await listPullRequests(env, "open");
    expect(list.map((p) => [p.number, p.asks_found])).toEqual([
      [42, true],
      [43, false],
    ]);
  });

  it("spends one call on asks for the whole list, not one per PR", async () => {
    // 30 PRs: 1 list + 30 pull fetches + 1 asks listing. A Worker invocation
    // gets 50 external subrequests, so a read per PR (61) would fail.
    const numbers = Array.from({ length: 30 }, (_, i) => i + 1);
    const table: Record<string, Route> = {
      "/pulls?state=all&sort=updated&direction=desc&per_page=30": {
        body: numbers.map((number) => ({ number })),
      },
      "/contents/docs/ops/asks?ref=main": asksDir("feat--one.md"),
    };
    for (const number of numbers) {
      table[`/pulls/${number}`] = pull({ number, head: { ref: `feat/${number}`, sha: `sha${number}` } });
    }
    const seen = routes(table);
    const list = await listPullRequests(env, "all");
    expect(list).toHaveLength(30);
    expect(seen.length).toBeLessThanOrEqual(32);
    expect(seen.filter((path) => path.startsWith("/contents/"))).toEqual(["/contents/docs/ops/asks?ref=main"]);
  });

  it("returns the list with every row false when the asks directory cannot be read", async () => {
    routes({
      "/pulls?state=open&sort=updated&direction=desc&per_page=30": { body: [{ number: 42 }] },
      "/pulls/42": pull({ head: { ref: "fix/tto-budget-followups", sha: "sha42" } }),
      // no /contents/docs/ops/asks route: the listing 404s
    });
    const list = await listPullRequests(env, "open");
    expect(list.map((p) => [p.number, p.asks_found])).toEqual([[42, false]]);
  });
});

describe("asksIndex", () => {
  it("is empty, and does not throw, when the directory listing fails", async () => {
    routes({ "/contents/docs/ops/asks?ref=main": { status: 403, text: "Resource not accessible" } });
    await expect(asksIndex(env)).resolves.toEqual(new Set());
  });

  it("keeps file paths only", async () => {
    routes({
      "/contents/docs/ops/asks?ref=main": {
        body: [
          { path: "docs/ops/asks/a--b.md", type: "file", size: 1 },
          { path: "docs/ops/asks/sub", type: "dir", size: 0 },
        ],
      },
    });
    await expect(asksIndex(env)).resolves.toEqual(new Set(["docs/ops/asks/a--b.md"]));
  });
});
