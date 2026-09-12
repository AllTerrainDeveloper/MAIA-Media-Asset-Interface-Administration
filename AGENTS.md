# MAIA development guidance

This repository is the standalone MAIA / AllTerrain Media Explorer plugin.

## User interface

- Never use browser-native `prompt()`, `confirm()`, or `alert()` dialogs, including as fallbacks.
- Use OpenStation components through `src/os-ui.ts` for inputs and buttons. Naming flows use inline forms with an explicit destination, validation, pending state, and retryable errors.
- Destructive confirmations use OpenStation's confirmation API. If it is unavailable, do not perform the destructive action automatically.
- Preserve drafts and pending feedback across sidebar repaints. Ignore asynchronous UI updates after window teardown.
- Folder deletion removes only the taxonomy term, preserving media and promoting child folders through WordPress's existing API.

## Verification

Run `npm run typecheck`, `npm test`, and relevant PHP integration tests. Rebuild the explorer bundles after TypeScript changes and deploy to the authorized local Docker instance for browser QA. Keep user-facing and developer documentation consistent with the final behavior.
