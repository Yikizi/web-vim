import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateCommit(message) {
  const title = message.split(/\r?\n/, 1)[0];
  if (title.length > 72) return "Keep the commit/PR title at most 72 characters.";
  if (
    !/^(feat|fix|docs|test|refactor|perf|build|ci|chore|style|revert)(\([a-z0-9-]+\))?!?: \S.*$/.test(
      title,
    )
  ) {
    return "Use type(scope): description, for example fix(duckduckgo): preserve native shortcuts.";
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const message = process.argv[2]
    ? await readFile(process.argv[2], "utf8")
    : process.env.PR_TITLE || "";
  const error = validateCommit(message);
  if (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
