/**
 * Minimal GitHub Contents API client, pinned to one repo.
 *
 * The fine-grained PAT lives only in Worker secrets. Every call here is
 * hard-scoped to env.REPO_OWNER/env.REPO_NAME so a tool argument can never
 * redirect a write at another repository.
 */

const API = "https://api.github.com";
const UA = "dashboard-mcp";

export interface RepoEnv {
  REPO_OWNER: string;
  REPO_NAME: string;
  REPO_BRANCH: string;
  GITHUB_REPO_PAT: string;
}

export class RepoError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** Reject traversal, absolute paths, and .git/ so a path argument stays inside the repo. */
export function normalizePath(raw: string): string {
  const path = raw.trim().replace(/^\/+/, "");
  if (!path) throw new RepoError("path is required");
  if (path.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new RepoError(`invalid path: ${raw}`);
  }
  if (path === ".git" || path.startsWith(".git/")) {
    throw new RepoError("path .git is not writable");
  }
  return path;
}

/**
 * A git ref used as a tool argument: branch name, tag name, or commit sha.
 * Same character rules git itself enforces, plus no leading "-" so a ref can
 * never be read as a flag by anything downstream.
 */
export function normalizeRef(raw: string | undefined, fallback: string): string {
  const ref = (raw ?? "").trim();
  if (!ref) return fallback;
  if (
    ref.length > 200 ||
    ref.startsWith("-") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".lock") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    !/^[A-Za-z0-9._\/-]+$/.test(ref)
  ) {
    throw new RepoError(`invalid ref: ${raw}`);
  }
  return ref;
}

/** Percent-encode a ref for a URL path segment, keeping "/" so branch names like feat/x survive. */
export function encodeRef(ref: string): string {
  return encodeURIComponent(ref).replace(/%2F/g, "/");
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function gh(env: RepoEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_REPO_PAT}`,
      "user-agent": UA,
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export function repoPath(env: RepoEnv, suffix: string): string {
  return `/repos/${env.REPO_OWNER}/${env.REPO_NAME}${suffix}`;
}

/** Turn a non-2xx GitHub response into a RepoError whose text says which permission was missing, when GitHub tells us. */
export async function ghError(what: string, res: Response): Promise<RepoError> {
  const body = await res.text();
  const needs = res.headers.get("x-accepted-github-permissions");
  const hint =
    res.status === 403 || res.status === 404
      ? needs
        ? ` (the PAT needs: ${needs})`
        : " (check the PAT's repository permissions)"
      : "";
  return new RepoError(`${what} failed: ${res.status} ${body}${hint}`, res.status);
}

export interface FileContents {
  path: string;
  ref: string;
  sha: string;
  size: number;
  content: string;
}

/** Read one file at `ref` (default REPO_BRANCH). Returns null when the file does not exist. */
export async function readFile(env: RepoEnv, rawPath: string, rawRef?: string): Promise<FileContents | null> {
  const path = normalizePath(rawPath);
  const ref = normalizeRef(rawRef, env.REPO_BRANCH);
  const res = await gh(env, repoPath(env, `/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`));
  if (res.status === 404) return null;
  if (!res.ok) throw await ghError(`read ${path}@${ref}`, res);

  const body = (await res.json()) as { type: string; sha: string; size: number; content?: string };
  if (body.type !== "file") throw new RepoError(`${path} is a ${body.type}, not a file`);
  return { path, ref, sha: body.sha, size: body.size, content: b64decode(body.content ?? "") };
}

export interface BranchInfo {
  branch: string;
  sha: string;
  created: boolean;
}

async function branchHead(env: RepoEnv, branch: string): Promise<string | null> {
  const res = await gh(env, repoPath(env, `/git/ref/heads/${encodeRef(branch)}`));
  if (res.status === 404) return null;
  if (!res.ok) throw await ghError(`lookup branch ${branch}`, res);
  const body = (await res.json()) as { object: { sha: string } };
  return body.object.sha;
}

/** Make sure `branch` exists, creating it from REPO_BRANCH's current head if it does not. */
export async function ensureBranch(env: RepoEnv, rawBranch: string): Promise<BranchInfo> {
  const branch = normalizeRef(rawBranch, env.REPO_BRANCH);
  const existing = await branchHead(env, branch);
  if (existing) return { branch, sha: existing, created: false };

  const base = await branchHead(env, env.REPO_BRANCH);
  if (!base) throw new RepoError(`base branch ${env.REPO_BRANCH} does not exist`, 404);

  const res = await gh(env, repoPath(env, "/git/refs"), {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base }),
  });
  if (!res.ok) throw await ghError(`create branch ${branch} from ${env.REPO_BRANCH}`, res);
  return { branch, sha: base, created: true };
}

export interface WriteResult {
  path: string;
  branch: string;
  branch_created: boolean;
  sha: string;
  commit: string;
  url: string;
  created: boolean;
}

/**
 * Create or replace one file on `branch` (default REPO_BRANCH). A branch that
 * does not exist yet is created from REPO_BRANCH first.
 *
 * expectedSha is an optimistic lock: pass the sha from read_file and the write
 * is rejected if anything changed in between, so two writers cannot silently
 * clobber each other's handoff.md edits.
 */
export async function writeFile(
  env: RepoEnv,
  rawPath: string,
  content: string,
  message: string,
  expectedSha?: string,
  rawBranch?: string,
): Promise<WriteResult> {
  const path = normalizePath(rawPath);
  const branch = normalizeRef(rawBranch, env.REPO_BRANCH);
  const branchInfo = branch === env.REPO_BRANCH ? null : await ensureBranch(env, branch);
  const current = await readFile(env, path, branch);

  if (current && !expectedSha) {
    throw new RepoError(`${path}@${branch} exists; read_file it and pass its sha as expected_sha.`);
  }
  if (expectedSha && current?.sha !== expectedSha) {
    throw new RepoError(
      current
        ? `sha mismatch for ${path}@${branch}: file is now ${current.sha}, you passed ${expectedSha}. Re-read the file and reapply your change.`
        : `sha mismatch for ${path}@${branch}: file does not exist, you passed ${expectedSha}.`,
    );
  }

  const res = await gh(env, repoPath(env, `/contents/${encodeURI(path)}`), {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: b64encode(content),
      branch,
      ...(current ? { sha: current.sha } : {}),
    }),
  });
  if (!res.ok) throw await ghError(`write ${path}@${branch}`, res);

  const body = (await res.json()) as {
    content: { sha: string };
    commit: { sha: string; html_url: string };
  };
  return {
    path,
    branch,
    branch_created: branchInfo?.created ?? false,
    sha: body.content.sha,
    commit: body.commit.sha,
    url: body.commit.html_url,
    created: current === null,
  };
}

export interface Entry {
  path: string;
  type: string;
  size: number;
}

/** List one directory (non-recursive) at `ref` (default REPO_BRANCH). "" or "/" lists the repo root. */
export async function listFiles(env: RepoEnv, rawPath: string, rawRef?: string): Promise<Entry[]> {
  const dir = rawPath.trim().replace(/^\/+|\/+$/g, "");
  const ref = normalizeRef(rawRef, env.REPO_BRANCH);
  const suffix = dir ? `/contents/${encodeURI(normalizePath(dir))}` : "/contents";
  const res = await gh(env, repoPath(env, `${suffix}?ref=${encodeURIComponent(ref)}`));
  if (res.status === 404) throw new RepoError(`no such directory: ${rawPath} at ${ref}`, 404);
  if (!res.ok) throw await ghError(`list ${rawPath}@${ref}`, res);

  const body = await res.json();
  if (!Array.isArray(body)) throw new RepoError(`${rawPath} is a file, not a directory`);
  return (body as Entry[]).map(({ path, type, size }) => ({ path, type, size }));
}
