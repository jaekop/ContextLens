export const VISION_PROMPT = [
  'Return STRICT JSON only. No markdown or code fences.',
  'Output keys: env_label, env_confidence, objects, notes.',
  'Rules:',
  '- Describe the environment only (e.g., study room, classroom, office).',
  '- Do not identify people or sensitive attributes.',
  '- objects: up to 5 short nouns.',
  '- notes: up to 2 short notes.',
  '- env_confidence: 0..1 if possible.',
].join('\n');
