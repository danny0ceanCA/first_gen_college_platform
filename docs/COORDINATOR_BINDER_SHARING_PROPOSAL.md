# Coordinator access and student binder sharing

Recorded: October 11, 2026

**Status: Deferred proposal.** The user asked to table this idea and return to it later. This document preserves the discussion; it does not authorize implementation. The phases below are recommendations, not completed features or approved requirements.

## The idea

Students use their Origen binder to review college information, keep notes, and collect questions. They could invite a coordinator to view selected parts of that binder so the coordinator can understand their goals and identify where help would be useful.

The experience should remain simple: **open your binder, choose what to share, invite a coordinator, and get help with your next step.**

The sidebar stays in the app for forums and community navigation. The binder is the home for college topics, notes, and guides.

## Recommended first version

Begin with read-only access to content the student explicitly selects, accompanied by an optional “I’d like help with…” message. Let the student preview exactly what the recipient will see and revoke access later.

Use verified coordinator membership in a school or organization. Coordinator access should be distinct from administrator access. An invitation should not grant broad access to the student's account.

## Proposed phases

### Phase 1 — Define coordinator access

- Define the coordinator role, organization membership, and verification process.
- Provide a coordinator workspace separate from the personal and administrator experiences.
- Specify who can invite coordinators, accept invitations, and manage organization membership.
- Review existing institutional roles and access controls before deciding whether a new role is necessary.

### Phase 2 — Student-controlled sharing

- Add “Share my binder” inside the binder.
- Let students choose topics and individual notes, goals, or questions.
- Identify the recipient clearly and show a preview before confirming access.
- Keep conversation transcripts and full summaries private unless explicitly selected.
- Let students review recipients and stop sharing at any time.
- Establish whether sharing includes a fixed snapshot or ongoing updates; explain the chosen behavior before consent.

### Phase 3 — Coordinator student list

- Show students who have accepted or initiated a valid sharing relationship.
- Surface student-stated goals, shared updates, and questions awaiting help.
- Use clear indicators such as “Asked for help” and “New shared notes.”
- Avoid treating low engagement as evidence that a student is struggling or has abandoned their goals.

### Phase 4 — Contributions inside the binder

- Allow clearly labeled coordinator comments, resources, and suggested next steps.
- Let students respond and accept suggestions.
- Preserve student authorship: coordinators should not overwrite a student's notes.
- Distinguish suggestions from steps the student has agreed to take.

### Phase 5 — Conversation follow-through

- During a conversation, Origen could ask: “Would you like to share that question with your coordinator?”
- Preview the specific content and confirm the recipient before sending.
- Support agreed next steps after a meeting, visible to the people authorized to see them.
- Make any voice claim that something was shared depend on a successful tool result.

### Phase 6 — Pilot and operational readiness

- Pilot with one organization before broader release.
- Test whether students understand invitations, shared content, updates, and revocation.
- Assess coordinator workload and whether students receive useful help.
- Add access history, expiration rules, and organization offboarding before expanding.
- Validate account isolation, organization boundaries, and revocation across all retrieval paths.

## Privacy boundaries to preserve

- A parent's private notes must never be automatically included when a student shares a binder.
- Each person controls the information they own; linked family accounts do not imply consent to coordinator sharing.
- Sharing one topic must not expose other topics, hidden summaries, transcripts, or voice context.
- Revocation must stop future access; clarify that previously downloaded copies cannot be recalled.
- Verify permission on the server for every read and write, rather than relying on hidden UI controls.

## Questions to resolve when this resumes

1. Who are the first coordinators: school counselors, college-access program staff, or another group?
2. How will organizations verify and remove coordinator membership?
3. Will the first version share snapshots or automatically include future updates?
4. How should permissions work for minors and parent-owned student profiles?
5. Can a student work with multiple coordinators or organizations?
6. Which notifications are useful, and what information can appear in them?

## Suggested starting point when resumed

Review the existing institutional membership and privacy architecture, then define the sharing contract and consent preview. Implement the read-only first version before coordinator comments or voice-triggered sharing.
