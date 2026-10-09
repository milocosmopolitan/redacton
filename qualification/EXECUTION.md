# Alpha 1 execution gates

This plan follows epic #1. A phase is complete only when its acceptance evidence exists, not when its implementation compiles.

## Dependency order and PR budget

1. **Host gate, #2:** inspect the installed SDK and test synthetic payloads, aliases, failure paths, command/UI surfaces, and operation association. Merge the evidence and go/no-go decision first. A no-go stops dependent implementation.
2. **Integration, #3–#11:** after a go decision, scaffold #3; implement state #4 and helper #5 independently; then prompt #6, tool results #7, and UI #8 independently. Engine quality #10 follows #5; trust setup #11 follows #3 and proceeds alongside integration. Finish failure/resource qualification #9 after #4–#8. Combine these changes in one PR after local checks and actual host evidence pass.
3. **Release, #12:** after #9–#11 are complete, validate clean installation and publish the exact artifact and compatibility evidence in a release preparation PR. No license, private reporting, or compatibility evidence means no release.
4. **Pilots, #13:** after #12, record three independent installations and consented feedback, then seven-day repeat use and the MCP decision. Maintainer demonstrations and automated agents do not count as independent users.

Target: one gate PR plus one integration PR and one release/evidence PR, rather than one PR per issue. A blocked gate needs only the evidence PR. Pilot evidence may need a later update after the observation period.

## Coordination and disk usage

The host, engine, and trust investigations run in parallel with separate file ownership. Implementation waits for the host gate. Use the existing checkout and a single active branch while work can be safely partitioned; create worktrees only if branch isolation becomes necessary. Never delete user-owned changes or unrelated worktrees.

Run relevant checks locally before pushing. Do not add CI matrices just to repeat unqualified claims. After merge, return to the updated default branch, delete the merged task branch, and remove task-owned temporary files/processes and any task worktrees. Keep reproducible qualification source and safe evidence, not installed dependencies or transient transcripts.

## Completion accounting

Use `Closes` only for fully met acceptance criteria. Use `Refs` for partial work and recorded blockers. Keep the epic checklist and child status consistent with actual evidence. A no-go report is a completed investigation, not a completed protection feature. Release and pilot gates remain open until their external prerequisites are met.
