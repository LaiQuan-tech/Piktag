import { supabase } from './supabase';
import type { Biolink, BiolinkVisibility } from '../types';

type ViewerRelation = 'self' | 'close_friend' | 'friend' | 'stranger';

/**
 * Determine the relationship between viewer and profile owner.
 * Returns: 'self' | 'close_friend' | 'friend' | 'stranger'
 */
export async function getViewerRelation(
  viewerId: string | undefined,
  profileOwnerId: string
): Promise<ViewerRelation> {
  if (!viewerId) return 'stranger';
  if (viewerId === profileOwnerId) return 'self';

  // Check close friend first (more specific)
  const { data: closeFriend } = await supabase
    .from('piktag_close_friends')
    .select('id')
    .eq('user_id', profileOwnerId)
    .eq('close_friend_id', viewerId)
    .maybeSingle();

  if (closeFriend) return 'close_friend';

  // Check mutual follow (both directions)
  const [{ data: iFollow }, { data: theyFollow }] = await Promise.all([
    supabase.from('piktag_connections')
      .select('id')
      .eq('user_id', viewerId)
      .eq('connected_user_id', profileOwnerId)
      .maybeSingle(),
    supabase.from('piktag_connections')
      .select('id')
      .eq('user_id', profileOwnerId)
      .eq('connected_user_id', viewerId)
      .maybeSingle(),
  ]);

  if (iFollow && theyFollow) return 'friend';

  return 'stranger';
}

/**
 * Filter biolinks based on viewer's relationship to the profile owner.
 * - self: sees everything
 * - close_friend: sees public + friends + close_friends
 * - friend: sees public + friends
 * - stranger: sees public only
 */
export function filterBiolinksByVisibility(
  biolinks: Biolink[],
  relation: ViewerRelation
): Biolink[] {
  if (relation === 'self') return biolinks;

  const allowedLevels: Record<ViewerRelation, BiolinkVisibility[]> = {
    self: ['public', 'friends', 'close_friends', 'private'],
    close_friend: ['public', 'friends', 'close_friends'],
    friend: ['public', 'friends'],
    stranger: ['public'],
  };

  const allowed = new Set(allowedLevels[relation]);
  return biolinks.filter(bl => allowed.has(bl.visibility || 'public'));
}
