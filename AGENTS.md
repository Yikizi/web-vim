# Web Vim

- Keep site names, selectors and domain-specific behavior out of src/core.
- Adapters implement src/core/contract.d.ts; core owns selection, input, modes, scrolling policy and action lifecycle.
- Never register keyboard listeners or own navigation state inside an adapter.
- Keep adapter reads free of DOM mutations. After an await, guard the target before performing input.
- Executed is not confirmed. A confirmed action result needs observed outcome evidence.
- Every adapter needs a keyboard-to-outcome browser scenario, not just schema validation.
- Run npm test and npm run test:browser after behavior changes. Browser checks use the agent-desktop private browser and their own disposable browser context.
- Do not replace Mattias's installed extensions until migration gaps in README have been addressed or he explicitly chooses to try the experimental build.

## Git and collaboration

- Follow CONTRIBUTING.md. Use focused Conventional Commits and matching PR titles.
- Use a feature/fix branch for subsequent changes; no direct main pushes or rewritten shared history.
- Run npm run check before publishing a change. On Mattias's machine use CDP_URL=http://127.0.0.1:9223 with agent-desktop.
- Keep native/browser shortcut compatibility explicit in PR descriptions.
- Do not publish releases, merge PRs or update installed extensions unless the user authorized that action.
