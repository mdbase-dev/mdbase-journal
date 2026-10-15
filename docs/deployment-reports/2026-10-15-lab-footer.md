# Journal LAB footer remediation

- Source `036073b`; SDK pin unchanged at `d3559aaa`; deployment `b26f3e30`.
- Viewed confirmed entries reacquire their original SDK record lease. Inactive clean drafts stay closed; history uses the same acquisition queue. No Saved claim based solely on local metadata.
- One actual mounted reload regression: RED before the fix, GREEN after; same original record/body and no new create/save. Full typecheck, 123 tests and local build passed.
- Upload succeeded; immediate alias smoke exited 1 on main propagation. Later immutable+alias main and SDK equality passed 4/4 without redeployment. Durable attempt and failure evidence retained.
- The old offline shell correctly pinned old assets until its last owned tab closed. No other same-origin pages were present. Normal close/reopen activated the installed update without cache deletion, forced activation or custody reset.
- **PASS, first corrected read:** exact new main, original edited body, Saved, exact collection Ready.
- **BLOCKED, ordinary reload:** exact new main, public SDK snapshot selected the original collection but phase was `problem`, code `rate_limited`; footer correctly withheld Saved. Original page retained. No new approval, setup apply or user note write.
- Full healthy reload acceptance remains unqualified pending rate-limit resolution. No production/staging, authority widening, Hosted fallback or unknown-write resubmission.
