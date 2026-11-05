# Contributing

Use Node.js 22+ and npm. Install dependencies with `npm ci`; the lockfile is committed. Run `npm run hooks:install` once to enable the repository's commit-message hook.

## Make a focused change

1. Update local main with `git pull --ff-only`.
2. Create a branch such as `fix/duckduckgo-native-keys` or `feat/new-site-adapter`.
3. Keep each commit about one user-visible change or one coherent maintenance task. Include its meaningful tests and documentation. Separate unrelated cleanup.
4. Run `npm run format`, then `npm run check` before pushing.
5. Open a PR explaining the problem, resulting behavior, validation and remaining limits. Merge with **squash** after CI passes; the PR title becomes the main-branch commit title.

On Mattias's Omarchy machine, browser work stays inside agent-desktop:

```sh
agent-desktop browser about:blank
CDP_URL=http://127.0.0.1:9223 npm run check
```

Elsewhere, tests launch a fresh headless Chrome/Chromium. Set `CHROME_PATH` if it is not installed at a common path. Never use a personal CDP endpoint for tests: connected-browser tests create a temporary context but still share that browser process.

## Commit and PR titles

Use `type(scope): short imperative description`; scope is optional, title length is at most 72 characters.

```text
feat(duckduckgo): add search view shortcuts
fix(core): preserve the browser bookmark shortcut
test(youtube): cover replaced comment nodes
docs: explain native keyboard ownership
ci: run browser checks on pull requests
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `style`, `revert`. Use `!` for an incompatible contract/keybinding change and explain the migration in the body. Explain _why_ in the body when it is not obvious. Avoid "WIP", "misc fixes", or claims of checks that were not run.

The local commit hook checks titles. CI checks PR titles; squash merging keeps the resulting main-branch history consistent. Do not amend or force-push shared main history. Keep source, tests and lockfiles in Git; build artifacts, credentials, profiles and deployment receipts stay out.

## Architectural rules

- Core owns input, modes, selection, movement, restoration and action lifecycle.
- Adapters describe their pages and execute declared capabilities. They do not register keyboard listeners or keep an independent selection.
- Preserve useful native site shortcuts and browser shortcuts. Native sites get explicit additions, not an automatic takeover.
- Adapter reads are pure. Guard delayed targets before input. An executed click is not a confirmed outcome.
- Add a keyboard-to-outcome browser scenario for new adapter behavior. Snapshot validation alone does not establish semantic correctness.

## Checks

- `npm run format:check`: consistent source and documentation formatting.
- `npm test`: core invariants and workflow tests.
- `npm run test:browser`: build plus deterministic Chromium fixtures; no account mutations or external-site requests.
- `npm run check`: all of the above.

A real-site spot check is useful after selector changes, but does not replace deterministic tests. State clearly when logged-in behavior was not verified.

## Versions and distribution

`package.json` is the version source for the generated manifest. A successful CI run uploads the unpacked extension as an artifact. Release tags and browser-store publication are deliberate maintainer actions, not automatic side effects of pushing a commit. Updating this repository does not overwrite anyone's installed extension.
