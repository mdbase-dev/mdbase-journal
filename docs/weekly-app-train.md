# Journal SDK repins and web delivery

The native owner-packet gate, `sdk-repin.yml`, native tag publisher and weekly
handoff are replaced by the same independent App CD line as Writer and Reader.
There is no production GO or UI approval step. See
[App CD](app-continuous-deployment.md) for exact-source custody, compatibility,
smoke, recovery, unchanged trust and live-proof limits.

Ops `config/weekly-apps.json` enrolls Journal in its single continuous SDK repinner.
It authenticates the published SDK provenance/integrity, preserves the original
archive, copies the exact bundled protocol and updates production pin metadata
and the npm lock through a normal PR. It cannot rotate trust, edit unrelated lock
entries, bypass exact-head Journal CI, deploy a server or authorize a reset.
`automation/sdk-repin` has one writer; the retired Journal-local writer and its
parallel weekly native publication path are deleted.

All ordinary green main changes, not just dependency merges, are eligible for
App CD. Staging and production use the same authenticated SDK producer, actual
live server ancestry gates and independent smokes. One app failure holds only
that app. Version labels, SDK pins, old native handoff records and a successful
dispatch are not proof of what is live.
