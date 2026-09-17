---
'buzzkit': minor
---

`CAMPAIGN_STATUSES` names the states a broadcast campaign moves through: `draft`, `scheduled`, `sending`, `completed` and `canceled`. A message now carries `throttlePerMinute`, the rate its fan-out is paced to, or null when it sends as fast as the queue allows.
