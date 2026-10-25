import { redactSecrets } from '../ingestion/repo/secret.scanner.js';

// The extraction prompt already says what not to remember; this is the check that doesn't
// depend on the model listening. A memory that trips it is dropped, not stored redacted:
// "the user's card is [REDACTED]" is no use to anyone.

const SENSITIVE: { rule: string; pattern: RegExp }[] = [
  // Card numbers: 13 to 19 digits, spaced or dashed in groups.
  { rule: 'card-number', pattern: /\b\d(?:[ -]?\d){12,18}\b/ },
  // US social security numbers and 12-digit national ids (spaced in fours).
  { rule: 'national-id', pattern: /\b\d{3}-\d{2}-\d{4}\b|\b\d{4} ?\d{4} ?\d{4}\b/ },
  { rule: 'iban', pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/ },
  { rule: 'phone', pattern: /\+\d[\d ().-]{7,}\d/ },
  { rule: 'email', pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/ },
  {
    rule: 'credential-words',
    pattern: /\b(?:passwords?|passcodes?|pin codes?|cvv|social security|api keys?|secret keys?)\b/i,
  },
];

/** Why `content` must not be remembered, or null when it may be. */
export function sensitiveReason(content: string): string | null {
  const secrets = redactSecrets(content).findings;
  if (secrets.length > 0) return secrets[0]!.rule;
  return SENSITIVE.find(({ pattern }) => pattern.test(content))?.rule ?? null;
}
