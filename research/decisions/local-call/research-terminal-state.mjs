// Isolated trial only. Clarify an already-authorized quiet state packet; never
// create an append, a research job, a spoken announcement, or a waiting period.
const LIMIT = 480;
const terminal = new Set(['completed', 'failed']);
const bytes = value => Buffer.byteLength(value, 'utf8');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const completedMeaning = 'This check ended; partial evidence is not pending work. Unaddressed scope remains unknown. Unconfirmed facts: unverified, not unpublished. Use verified findings with their qualifications.';
const failedMeaning = 'This check failed; partial evidence is not pending work. Retain verified findings and their qualifications. Missing facts remain unverified.';

export function createTerminalResearchStateGuard({ diagnostic = () => {} } = {}) {
  let closed = false;
  const reported = new Set();
  function log(packet, state, action, reason, before, after = before) {
    const row = { type: 'local_research_terminal_state', action, reason,
      packetKind: packet.kind, packetUnit: packet.unit ?? null,
      resultId: typeof packet.resultId === 'string' ? packet.resultId.slice(0, 128) : null,
      jobId: typeof state?.jobId === 'string' ? state.jobId.slice(0, 128) : null,
      revision: Number.isSafeInteger(state?.revision) ? state.revision : null,
      evidenceVersion: Number.isSafeInteger(state?.evidenceVersion) ? state.evidenceVersion : null,
      taskState: state?.state ?? state?.taskState ?? null, bytesBefore: before, bytesAfter: after };
    const key = JSON.stringify(row);
    if (reported.has(key)) return;
    reported.add(key);
    if (reported.size > 128) reported.delete(reported.values().next().value);
    // Optional diagnostics must not break the original voice command.
    try { diagnostic(row); } catch {}
  }
  return {
    transform(event) {
      if (closed || event?.type !== 'session.thinking.append' || typeof event.content !== 'string') return event;
      let packet;
      try { packet = JSON.parse(event.content); } catch { return event; }
      if (!object(packet)) return event;
      const taskPacket = packet.kind === 'research-state';
      const evidenceState = packet.kind === 'untrusted-research-evidence' && packet.unit === 'state';
      if (!taskPacket && !evidenceState) return event;
      const before = bytes(event.content);
      // Preserve atomic reassembly and its existing IDs/counts. Never patch one
      // fragment of JSON, strip a qualification, or increase the packet count.
      if (packet.total != null && packet.total !== 1 || packet.part != null && packet.part !== 1) {
        log(packet, null, 'skipped', 'fragmented_state', before); return event;
      }
      let state = packet;
      if (taskPacket) {
        if (typeof packet.text !== 'string') { log(packet, null, 'skipped', 'invalid_state', before); return event; }
        try { state = JSON.parse(packet.text); } catch { log(packet, null, 'skipped', 'invalid_state', before); return event; }
      }
      if (!object(state)) { log(packet, null, 'skipped', 'invalid_state', before); return event; }
      const status = taskPacket ? state.state : state.taskState;
      if (!terminal.has(status)) return event;
      if (state.researchPending !== false || taskPacket && state.acceptedActiveJob !== false) {
        log(packet, state, 'skipped', 'inconsistent_terminal_state', before); return event;
      }
      let replacement;
      if (taskPacket) {
        // The job-state packet is application-authored. Only its interpretation
        // changes; identity, revision, status, and evidence stay exactly intact.
        replacement = { ...packet, text: JSON.stringify({ ...state,
          meaning: status === 'completed' ? completedMeaning : failedMeaning }) };
      } else {
        replacement = { ...packet, taskMeaning: status === 'completed'
          ? 'Check ended; partial evidence is not pending work.'
          : 'Check failed; partial evidence is not pending work.' };
      }
      const content = JSON.stringify(replacement), after = bytes(content);
      if (after > LIMIT) { log(packet, state, 'skipped', 'packet_budget', before, after); return event; }
      if (content === event.content) return event;
      log(packet, state, 'clarified', 'terminal_not_pending', before, after);
      return { ...event, content };
    },
    reset() { reported.clear(); },
    close() { closed = true; reported.clear(); },
  };
}
