// URL templates for fetching guest photos from Supabase Storage.
// Bucket is public — the 8-char unguessable code is the gate.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET ?? 'event'
const ORG = import.meta.env.VITE_ORG ?? 'rotary'

export const PHOTO_COUNT = 5

export function photoUrl(code: string, index: number): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${ORG}/${code}/${index}.jpg`
}

export function allPhotoUrls(code: string): string[] {
  return Array.from({ length: PHOTO_COUNT }, (_, i) => photoUrl(code, i + 1))
}
