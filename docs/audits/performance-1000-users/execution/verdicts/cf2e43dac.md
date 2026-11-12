VERDICT: FAIL

| id | severity (blocker/major/minor/nit) | file:line | finding | evidence |
|---|---|---|---|---|
| 1 | major | `benchmark/src/runner.ts:62` | Early disconnects silently miss sessions that have not started when the disconnect timer fires. | `session.leave()` is a no-op for `idle` sessions, and the runner does not reschedule those leavers. With a ramp longer than `disconnect-at-seconds`, configured early leavers can start later and remain connected, so the generated traffic does not match the requested scenario. The accepted-session test would catch a mutant that stops accepting joins; the rejected-session test would catch a mutant that treats rejection as acceptance; the ramp-abort test would catch a mutant that leaves pending starts active. None exercises this early-disconnect case. |

I could not verify runtime behavior because I did not run tests or connect to a pusher; this review is based on static inspection of the commit diff and related source.
