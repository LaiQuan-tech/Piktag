import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/require-admin';
import { createAdminClient } from '@/lib/supabase-admin';
import { syncSocialPlatform } from '@/lib/social-platform-sync';
import type { SocialPlatform } from '@/lib/admin-types';

const VALID_PLATFORMS: ReadonlyArray<SocialPlatform | 'all'> = ['all', 'threads', 'instagram'];

function parsePlatform(value: unknown): SocialPlatform | 'all' {
  return typeof value === 'string' && VALID_PLATFORMS.includes(value as SocialPlatform | 'all')
    ? (value as SocialPlatform | 'all')
    : 'all';
}

export async function POST(req: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const platform = parsePlatform(body.platform);
  const supabase = createAdminClient();

  try {
    const results = await syncSocialPlatform(supabase, platform);
    const status = results.some((result) => result.status === 'error') ? 502 : 200;
    return NextResponse.json({ results }, { status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'sync failed' },
      { status: 500 },
    );
  }
}
