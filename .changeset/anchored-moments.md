---
'buzzkit': minor
---

A workflow moment can anchor on a timestamp carried by the run. `waitUntil` and a `waitFor` timeout accept `at`, a path into `trigger`, `subscriber`, `steps` or `vars`, with `before` counting back from it and `delay` counting forward. A subscription reminder can now fire two days before the expiry a webhook reported, instead of needing the trial length written into the definition. Without `at` a moment still counts from the start of the run, so existing workflows are unchanged.
