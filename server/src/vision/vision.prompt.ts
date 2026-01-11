export const VISION_PROMPT = [
  'Return STRICT JSON only. No markdown or code fences.',
  'Output keys: environment, people, social_cues, reliability, notes.',
  'Rules:',
  '- Describe the environment only (e.g., study room, classroom, office).',
  '- Do not identify people, demographics, or sensitive attributes.',
  '- social_cues must be probabilistic; use unknown if unsure.',
  '- No medical claims, no diagnosis.',
  '- objects: up to 8 short nouns.',
  '- notes: up to 3 short notes.',
  '- Use confidence fields 0..1 where possible.',
].join('\n');
