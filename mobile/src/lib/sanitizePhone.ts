// Lightweight phone-input防呆: keep only the characters a phone number
// can contain — digits, a leading +, and the usual separators ( ) - and
// space. Strips letters / emoji / stray symbols as the user types
// (paste & autofill can inject junk a phone-pad keyboard wouldn't).
//
// Deliberately does NOT enforce a length or a country format — phone
// conventions vary too much worldwide to do that without false positives
// (partial numbers, extensions, short codes). It just keeps the field
// clean; the canonical `tel:` URL is synthesised at save (buildPlatformUrl
// / the contact promote path).
export function sanitizePhone(raw: string): string {
  return (raw || '').replace(/[^\d+()\-\s]/g, '');
}
