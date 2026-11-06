import { validateSource } from './contracts.mjs';

// Hand-authored fictional cases and reference extractions. These are test labels,
// not outputs from a paid model or evidence about real students.
const records = [];

function add(id, options, entries) {
  const source = {
    id, version: 1, accountId: 'demo-rivera-family', studentId: 'maya',
    reporter: 'student', language: 'en', kind: 'summary',
    recordedAt: '2026-11-01T10:00:00.000Z', synthetic: true,
    ...options,
  };
  const items = entries.map((entry, index) => ({
    key: `item-${index + 1}`, episodeKey: id, topic: 'college_basics', barrier: null,
    kind: 'question', status: 'open', statement: entry.quote, quote: entry.quote,
    reportedBy: source.reporter, language: source.language, occurredAt: null,
    linksTo: null, corrects: null, ...entry,
  }));
  source.text = options.text ?? entries.map(entry => entry.quote).join('\n');
  records.push({ source: validateSource(source), extraction: { schemaVersion: 1, items } });
}

add('demo-college-start', {}, [
  { episodeKey: 'getting-started', quote: 'I want to go to college, but I do not know where to start.', barrier: 'Unsure where to begin' },
  { episodeKey: 'getting-started', kind: 'guidance', status: 'offered', quote: 'Origen explained that exploring interests and comparing college paths can be a first step.', linksTo: 'item-1' },
]);

add('demo-parent-costs', { reporter: 'parent', language: 'es' }, [
  { episodeKey: 'parent-understands-cost', topic: 'costs', quote: 'No entiendo si el precio publicado es lo que tendremos que pagar.', barrier: 'No distingue el precio publicado del costo para su familia' },
  { episodeKey: 'parent-understands-cost', topic: 'costs', kind: 'guidance', status: 'offered', quote: 'Origen explicó con un ejemplo la diferencia entre el precio publicado y el costo después de recibir ayuda.', linksTo: 'item-1' },
]);

add('demo-parent-costs-progress', { reporter: 'parent', language: 'es', recordedAt: '2026-11-02T10:00:00.000Z' }, [
  { episodeKey: 'parent-understands-cost', topic: 'costs', kind: 'understanding', status: 'reported', quote: 'Ahora entiendo que el precio publicado puede ser diferente de lo que paguemos.', linksTo: 'demo-parent-costs@1#item-2' },
  { episodeKey: 'parent-understands-cost', topic: 'costs', status: 'partial', quote: 'Todavía necesito entender qué parte de la oferta es préstamo.', barrier: 'Necesita distinguir los préstamos en una oferta de ayuda' },
]);

add('demo-student-costs', { recordedAt: '2026-11-02T11:00:00.000Z' }, [
  { episodeKey: 'student-understands-cost', topic: 'costs', quote: 'My mom understands the offer now, but I still do not know what a loan means.', barrier: 'Student still needs a loan explanation' },
  { episodeKey: 'student-understands-cost', topic: 'costs', kind: 'preference', status: 'exploring', quote: 'I might work part time, but I have not decided.' },
]);

add('demo-application-pending', { language: 'mixed', kind: 'transcript', recordedAt: '2026-11-02T12:00:00.000Z' }, [
  { episodeKey: 'application-submission', topic: 'applications', kind: 'action', status: 'completed', quote: 'Ya envié mi application yesterday.' },
  { episodeKey: 'application-submission', topic: 'applications', kind: 'outcome', status: 'pending', quote: 'I am still waiting for the confirmation email.', linksTo: 'item-1' },
]);

add('demo-enrollment-question', { recordedAt: '2026-11-02T13:00:00.000Z' }, [
  { episodeKey: 'admitted-versus-enrolled', topic: 'enrollment', quote: 'I got admitted. Does that mean I already have classes?', barrier: 'Unsure how admission differs from enrollment' },
  { episodeKey: 'admitted-versus-enrolled', topic: 'enrollment', kind: 'guidance', status: 'offered', quote: 'Origen explained that admission and registering for classes are separate steps.', linksTo: 'item-1' },
]);

add('demo-enrollment-understood', { recordedAt: '2026-11-03T10:00:00.000Z' }, [
  { episodeKey: 'admitted-versus-enrolled', topic: 'enrollment', status: 'resolved', quote: 'Now I understand that being admitted does not mean I have registered for classes.', linksTo: 'demo-enrollment-question@1#item-1' },
  { episodeKey: 'admitted-versus-enrolled', topic: 'enrollment', kind: 'action', status: 'intended', quote: 'I plan to open the enrollment checklist this weekend.' },
]);

add('demo-finding-help', { studentId: 'leo', language: 'es', kind: 'note' }, [
  { episodeKey: 'asking-for-help', topic: 'finding_help', quote: 'No sé qué escribir para pedir ayuda con la solicitud.', barrier: 'Necesita palabras para pedir ayuda' },
  { episodeKey: 'asking-for-help', topic: 'finding_help', kind: 'guidance', status: 'offered', quote: 'Origen ofreció un ejemplo de correo con una sola pregunta sobre la solicitud.', linksTo: 'item-1' },
]);

add('demo-help-attempt', { studentId: 'leo', language: 'es', recordedAt: '2026-11-03T11:00:00.000Z' }, [
  { episodeKey: 'asking-for-help', topic: 'finding_help', kind: 'action', status: 'completed', quote: 'Envié el correo a la oficina.', linksTo: 'demo-finding-help@1#item-2' },
  { episodeKey: 'asking-for-help', topic: 'finding_help', kind: 'outcome', status: 'unsuccessful', quote: 'El mensaje regresó porque la dirección no existe.', linksTo: 'item-1' },
]);

add('demo-help-positive', { studentId: 'leo', language: 'es', recordedAt: '2026-11-04T11:00:00.000Z' }, [
  { episodeKey: 'asking-for-help', topic: 'finding_help', kind: 'outcome', status: 'positive', quote: 'Me confirmaron una cita para recibir ayuda.', linksTo: 'demo-help-attempt@1#item-1' },
]);

add('demo-help-correction', { studentId: 'leo', language: 'es', recordedAt: '2026-11-05T11:00:00.000Z' }, [
  { episodeKey: 'asking-for-help', topic: 'finding_help', kind: 'outcome', status: 'pending', quote: 'Me equivoqué: solo recibieron mi solicitud de cita y todavía no la confirman.', corrects: 'demo-help-positive@1#item-1', linksTo: 'demo-help-attempt@1#item-1' },
]);

add('demo-family-concern', { studentId: null, reporter: 'family', language: 'es' }, [
  { episodeKey: 'family-distance', topic: 'family_support', quote: 'Nos preocupa cómo mantenernos en contacto si nuestro hijo se va lejos.', barrier: 'Familia quiere entender cómo mantenerse conectada' },
  { episodeKey: 'family-distance', topic: 'family_support', kind: 'preference', status: 'stated', quote: 'Como familia preferimos hablar por teléfono los domingos.' },
]);

add('demo-practical-needs', { accountId: 'demo-chen-family', studentId: 'sam', language: 'en' }, [
  { episodeKey: 'college-and-work', topic: 'practical_needs', quote: 'I work evenings and do not know how I would get to college.', barrier: 'Work schedule and transportation are unresolved' },
  { episodeKey: 'college-and-work', topic: 'practical_needs', kind: 'action', status: 'postponed', quote: 'I will wait to compare schedules until I know my work hours.' },
]);

add('demo-paths-exploring', { accountId: 'demo-chen-family', studentId: 'sam', recordedAt: '2026-11-03T09:00:00.000Z' }, [
  { episodeKey: 'choosing-a-path', topic: 'paths', kind: 'preference', status: 'exploring', quote: 'Maybe a community college would work, but I want to understand the options first.' },
  { episodeKey: 'choosing-a-path', topic: 'paths', quote: 'What is the difference between a certificate and a degree?', barrier: 'Needs an explanation of college pathways' },
]);

add('demo-unknown-speaker', { accountId: 'demo-patel-family', studentId: null, reporter: 'unknown', language: 'und' }, [
  { episodeKey: 'unclear-progress', topic: 'other', kind: 'outcome', status: 'unknown', quote: 'We did it.', statement: 'Someone reported unspecified progress; the person, task, and result are unknown.' },
]);

export function demoSources() {
  return records.map(record => structuredClone(record.source));
}

export function demoExtraction(source) {
  validateSource(source);
  const record = records.find(candidate => candidate.source.id === source.id);
  if (!record || Object.keys(record.source).some(key => source[key] !== record.source[key])) {
    throw Object.assign(new Error('unsupported_demo_source'), { code: 'unsupported_demo_source' });
  }
  return structuredClone(record.extraction);
}

export const demoDescription = 'Fictional family cases with hand-authored expected extractions. No real account data or model-generated extraction results.';
