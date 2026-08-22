---
name: gitlab-connector
description: Use the granted GitLab connector through the official glab CLI.
version: 1.12.0
category: Development Workflow
license: MIT
metadata:
  audience: developers
  author: dgruzd
  workflow: gitlab
---

# GitLab Workflow Skill

GitLab workflow management using `glab` CLI for merge requests, issues, and Git best practices.

## Slopify authentication

Slopify installs `glab` in the agent VM and authenticates it through the execution-scoped
`GITLAB_TOKEN` placeholder when this connector is granted. Use `glab` directly; do not run
`glab auth login`, request a token, print the environment, or pass the token as an argument.
The VM never contains the real personal access token: Gondolin replaces the placeholder only
in outbound HTTPS requests to the granted GitLab host.

## Multiple GitLab Instances

glab auto-detects the GitLab host from your git remote. No `GITLAB_HOST` is needed when
working inside a repository. For non-`origin` remotes (e.g. a local GDK instance added
as a secondary remote), use `glab config set remote_alias <remote>`. Set `GITLAB_HOST`
only when running outside a git repository or for a one-off command targeting a specific
instance. See [references/multi-host.md](references/multi-host.md) for non-origin remote
setup and hostname derivation from remote URLs.

## Message Escaping — Common Trap

If your message contains backticks (`), `$`, or other shell special characters, never
inline them directly in `-m "..."`. The shell interprets backticks as command substitution,
silently mangling your message.

### Don't inline backticks in double-quoted messages

```bash
# BROKEN: shell tries to execute `client_name` as a command
glab mr note 100 -m "Use `client_name` and `wor/` here." -R org/repo
```

### Write to a file first

Pick a unique path appropriate for the invocation:

```bash
MSG=<agent picks>

cat > "$MSG" << 'EOF'
Use `client_name` and `wor/` here. The `glab` tool handles this.
EOF
glab mr note 100 -m "$(cat "$MSG")" -R org/repo
```

The single-quoted `EOF` delimiter prevents variable and backtick expansion. If the
content itself contains heredoc syntax, use a unique outer delimiter.

## Creating Merge Requests

Always pass `--push` and `-H <owner/repo>`. Without `--push`, the branch may not exist on
any remote yet. Without `-H`, glab may pick the wrong remote as the source project.

```bash
glab mr create --push -H <owner/repo> --title "Add feature" --description "Brief description" --assignee <username>
glab mr create --push -H <owner/repo> --title "Add feature" --description "$(cat "$DESC")" --assignee <username>
```

Check `.gitlab/merge_request_templates/` for project-specific templates. Run
`glab mr create --help` for the current flag list.

## Updating Merge Requests

```bash
glab mr update <number> --description "$(cat "$DESC")"
glab mr view <number> -R <owner>/<repo>
```

## Issue Management

Run `glab issue --help` for the current flag list. Non-obvious behavior:

```bash
glab issue list --closed -R <owner>/<repo>
glab issue list --all -R <owner>/<repo>
glab issue update 123 --label "new-label"
glab issue update 123 --unlabel "old-label"
glab issue update 123 --label "status::doing"
glab issue note <number> -m "$(cat "$MSG")" -R <owner>/<repo>
```

For issue state transitions and posting notes via `glab api`, read
[references/issue-api.md](references/issue-api.md).

## Work Items

GitLab is migrating issues to work items. The URL shows `/work_items/<iid>` but the REST
API is the same issues API.

```bash
glab api "projects/org%2Fproject/issues/<iid>"
```

Read [references/work-items.md](references/work-items.md) for URL parsing, GraphQL, and
group-level work items.

## MR Review

Since `glab` v1.94.0, `glab mr note` handles common MR-comment workflows:

```bash
glab mr note list 123 -F json
glab mr note create 123 -m "comment"
glab mr note create 123 --file main.go --line 42 -m "..."
glab mr note create 123 --reply abc12345 -m "..."
glab mr note resolve 123 abc12345
```

Use raw `glab api .../draft_notes` only for batched draft reviews. Read
[references/mr-review.md](references/mr-review.md) for flags, suggestions, drafts, and
position objects.

## Issue Links, Epics, and Nested Groups

- Issue links: [references/issue-links.md](references/issue-links.md)
- Epics CRUD: [references/epics.md](references/epics.md)
- Epic comments: [references/epic-comments.md](references/epic-comments.md)
- Nested groups: [references/nested-groups.md](references/nested-groups.md)

## MR Listing and Filtering

Run `glab mr list --help` for the current flag list. `glab mr list` lists open MRs by
default and has no `--state` or `--status` flag; use `--all`, `--merged`, or `--closed`.

## Search

For full examples, read [references/search.md](references/search.md).

```bash
glab api "search?scope=issues&search=<query>" | jq '.[] | {iid, title}'
glab api "groups/<group>/search?scope=merge_requests&search=<query>" | jq '.[]'
glab api "projects/<org>%2F<repo>/search?scope=issues&search=<query>" | jq '.[]'
```

## Git and Commit Conventions

Follow the repository's conventions when present. GitLab defaults:

```bash
git checkout -b feature/description
git checkout -b fix/description
```

- Capitalized, imperative commit subjects.
- Reference issues and MRs with full URLs.
- Single-quote commit messages containing special characters.

## Agent Guidelines

1. Read context first with `glab issue view` or `glab mr view`; check project templates.
2. `--jq` works on subcommands, not `glab api`; pipe API output through `jq`.
3. glab uses `--description`, not `--body`.
4. Work item URLs use the issues API.
5. Epic comments need GraphQL; pass variables rather than interpolating them.
6. Group-level API calls do not accept `-R`.
7. Encode nested group slashes as `%2F`.
8. GraphQL `iid` is a String.
9. `groups/<id>/work_items` is 404; use epics REST or GraphQL.
10. Under `project`, use `workItems` rather than `workItem`.
11. Close or reopen epics with REST `state_event`.
12. Scoped labels replace the existing label in the same scope.
13. Use `--unique` for idempotent comments.
14. Configure `remote_alias` for non-origin remotes.
15. Write messages containing backticks or `$` to a literal heredoc first.
16. For a second same-family remote, configure `remote.origin.glab-resolved-head` or pass `-H`.
17. For `glab api` note bodies, use `-F "body=@file"`; verify what landed.

## Contributing Improvements

This skill is maintained in the GitLab monolith under `.claude/skills/glab/` and synced
to `gitlab-org/ai/skills`. The monolith copy is the source of truth. Confirm inaccuracies
before opening a focused correction there.
