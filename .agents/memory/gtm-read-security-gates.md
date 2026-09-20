---
name: GTM read security gates
description: Non-obvious validation rules required for safe GTM reads under concurrent connection changes.
---

Every GTM read must make the final connection-eligibility check authoritative on every exit path, including refresh, transport, HTTP, parsing, and schema failures. Returned resources must also have exact canonical ancestry and matching terminal ID fields.

**Why:** Error paths and superficially valid Google resources can otherwise bypass stale-generation precedence or return internally contradictory objects. Official collection names and endpoint paths must be checked against the installed Google API types rather than inferred from nearby APIs.

**How to apply:** When adding a GTM operation, add adversarial tests for disconnect during failures, parent-prefix collisions, canonical-name/ID mismatches, the exact endpoint, and the exact official response collection key.