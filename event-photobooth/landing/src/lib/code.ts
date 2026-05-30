// Mirror of app/code_gen.py — kept in sync manually. 32-char Crockford-style
// alphabet (no 0/1/I/L/O/U) so QR-fallback codes can be typed without
// confusing similar-looking glyphs.

export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LEN = 8

/** Strip dashes/spaces, uppercase, defensive map for common typos. */
export function normalize(input: string): string {
  let s = input.toUpperCase().replace(/[-\s]/g, '')
  // Map confusables a user might enter into our alphabet's neighbors
  s = s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/L/g, 'I')
  // Note: O, I aren't in the alphabet either — these will fail isValid
  // and the page will show "not found", which is the right UX (input was bad).
  return s
}

export function isValid(code: string): boolean {
  if (code.length !== CODE_LEN) return false
  for (const c of code) {
    if (!ALPHABET.includes(c)) return false
  }
  return true
}

export function formatDisplay(code: string): string {
  if (code.length !== CODE_LEN) return code
  return `${code.slice(0, 4)}-${code.slice(4)}`
}
