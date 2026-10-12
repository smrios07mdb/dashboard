/**
 * edit_file: replace one piece of text in a file without the caller resending
 * the whole file. The Worker reads the file, applies the replacement and
 * commits through writeFile, so path and branch rules and the sha lock are the
 * same as write_file's.
 */

import { readFile, writeFile, normalizeRef, RepoError, type RepoEnv, type WriteResult } from "./github-repo";

export interface EditOutcome {
  content: string;
  replacements: number;
}

/**
 * Replace oldText with newText. oldText must match exactly (whitespace and
 * newlines included) and exactly once, unless replaceAll is set. Uses
 * split/join so "$&" and friends in newText are plain text.
 */
export function applyEdit(content: string, oldText: string, newText: string, replaceAll = false): EditOutcome {
  if (!oldText) throw new RepoError("old_text is required");
  if (oldText === newText) throw new RepoError("old_text and new_text are identical");
  const parts = content.split(oldText);
  const count = parts.length - 1;
  if (count === 0) throw new RepoError("old_text not found in the file (it must match exactly, whitespace included)");
  if (count > 1 && !replaceAll) {
    throw new RepoError(
      `old_text matches ${count} places; add surrounding text until it matches once, or pass replace_all: true`,
    );
  }
  return { content: parts.join(newText), replacements: count };
}

export interface EditResult extends WriteResult {
  replacements: number;
  size: number;
}

/**
 * Read `path` at `branch`, replace text, commit to `branch`. If the branch
 * does not exist yet the file is read from REPO_BRANCH and writeFile creates
 * the branch from it. expectedSha is optional: the Worker always locks on the
 * sha it read, and also checks the caller's sha when one is passed.
 */
export async function editFile(
  env: RepoEnv,
  rawPath: string,
  oldText: string,
  newText: string,
  message: string,
  replaceAll = false,
  rawBranch?: string,
  expectedSha?: string,
): Promise<EditResult> {
  const branch = normalizeRef(rawBranch, env.REPO_BRANCH);
  let current = await readFile(env, rawPath, branch);
  if (!current && branch !== env.REPO_BRANCH) current = await readFile(env, rawPath, env.REPO_BRANCH);
  if (!current) throw new RepoError(`${rawPath} does not exist on ${branch}; use write_file to create it`, 404);
  if (expectedSha && expectedSha !== current.sha) {
    throw new RepoError(
      `sha mismatch for ${current.path}@${branch}: file is now ${current.sha}, you passed ${expectedSha}. Re-read the file and reapply your change.`,
    );
  }

  const edited = applyEdit(current.content, oldText, newText, replaceAll);
  const written = await writeFile(env, current.path, edited.content, message, current.sha, branch);
  return { ...written, replacements: edited.replacements, size: new TextEncoder().encode(edited.content).length };
}
