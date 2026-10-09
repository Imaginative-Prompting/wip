# WIP agent instructions

WIP is a generic review app. Keep project data and media outside the app source.

- Preserve the single persistent player. There is one transport and one audible
  source; paired audio is the master clock, video is its optional muted picture.
- Keep the list simple, keyboard-accessible, searchable and filterable.
- Never treat a render, a tag, or passing checks as human approval.
- Entries are independent files. Use `wip get`, then `wip put --expected N` for
  updates. Do not edit a shared HTML page or catalog. Never bypass a revision
  conflict; read the current entry and reconcile it.
- Use stable IDs, descriptive titles, accurate tags, and honest review notes.
  Preserve prior attempts when adding a meaningful revision.
- Use explicit media references. Never copy a project's large media into this
  app's repository. Never expose raw session logs or private captures in exports.
- Before changing the player, run `npm test` and verify real playback, seeking,
  repeat, preview toggling, navigation, full-screen exit, and a narrow viewport.
- Static exports MUST specify an explicit allowlist of projects.
- This repository belongs to Imaginative-Prompting. All commits must have both
  author and committer `Imaginative-Prompting` with
  `337144060+Imaginative-Prompting@users.noreply.github.com`. No coauthor trailers,
  bots, alternate accounts, or other contributors. Verify identity before pushing.
- Never publish the repository publicly or change its visibility without an
  explicit owner request. Keep the default example independent of other repos.
