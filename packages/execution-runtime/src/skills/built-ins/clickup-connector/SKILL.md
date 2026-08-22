---
name: clickup-connector
description: Use the granted ClickUp API connector for ClickUp tasks.
---

# ClickUp connector

Use the ClickUp API at `https://api.clickup.com/api/v2` with shell HTTP requests. The
execution-scoped credential placeholder is `$SLOPIFY_CLICKUP`. Send it only in the
`Authorization` request header. Never print, echo, log, or put it in a URL or request
body.

Read a task by its normal task ID:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: $SLOPIFY_CLICKUP" \
  "https://api.clickup.com/api/v2/task/<task-id>"
```

For a custom task ID such as `RVMP-90`, include its workspace/team ID:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: $SLOPIFY_CLICKUP" \
  "https://api.clickup.com/api/v2/task/<custom-task-id>?custom_task_ids=true&team_id=<team-id>"
```

If a ClickUp browser URL contains both a workspace/team ID and a custom task ID, extract
those values and use the custom-ID request above. Report HTTP failures safely without
exposing request headers.
