/**
 * Calculate connection strength score (0-100) based on interaction signals.
 * Higher = stronger relationship.
 */

type StrengthInput = {
  mutualTagCount: number;    // shared tags
  daysSinceMet: number;      // how long you've known them
  hasBirthday: boolean;      // set birthday reminder
  hasAnniversary: boolean;   // set anniversary
  hasContractExpiry: boolean; // set contract expiry
  isCloseFriend: boolean;    // marked as close friend
  hiddenTagCount: number;    // private tags you added
  pickedTagCount: number;    // tags you picked for them
};

export function calculateStrength(input: StrengthInput): number {
  let score = 0;

  // Mutual tags (max 20 pts)
  score += Math.min(input.mutualTagCount * 5, 20);

  // Days since met — longer = stronger (max 15 pts, caps at 365 days)
  score += Math.min(Math.floor(input.daysSinceMet / 24), 15);

  // CRM engagement (max 15 pts)
  if (input.hasBirthday) score += 5;
  if (input.hasAnniversary) score += 5;
  if (input.hasContractExpiry) score += 5;

  // Close friend (20 pts)
  if (input.isCloseFriend) score += 20;

  // Hidden tags — you took time to label them (max 15 pts)
  score += Math.min(input.hiddenTagCount * 3, 15);

  // Picked tags — you engaged with their profile (max 15 pts)
  score += Math.min(input.pickedTagCount * 3, 15);

  return Math.min(score, 100);
}

/**
 * Get a human-readable strength label + color
 */
export function getStrengthLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: '密友', color: '#059669' };    // green
  if (score >= 60) return { label: '熟識', color: '#2563EB' };    // blue
  if (score >= 40) return { label: '認識', color: '#D97706' };    // amber
  if (score >= 20) return { label: '初識', color: '#9CA3AF' };    // gray
  return { label: '新朋友', color: '#D1D5DB' };                   // light gray
}
