// Supabase Edge Function: upscale-image
// Upscales an image using Replicate's Real-ESRGAN model (4x super resolution)
// Set REPLICATE_API_KEY in Supabase Dashboard → Edge Functions → Secrets

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const REPLICATE_MODEL_VERSION = '42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 40; // 80 seconds max

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { imageBase64, scale = 4 } = await req.json();

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid "imageBase64" field' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('REPLICATE_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'REPLICATE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clamp scale to supported values: 2 or 4
    const upscaleScale = [2, 4].includes(scale) ? scale : 4;

    // Start prediction
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: REPLICATE_MODEL_VERSION,
        input: {
          image: imageBase64,
          scale: upscaleScale,
          face_enhance: false,
        },
      }),
    });

    if (!startRes.ok) {
      const errorBody = await startRes.text();
      console.error('Replicate start error:', errorBody);
      return new Response(
        JSON.stringify({ error: 'Failed to start upscaling job', details: errorBody }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prediction = await startRes.json();
    const predictionId: string = prediction.id;

    if (!predictionId) {
      return new Response(
        JSON.stringify({ error: 'No prediction ID returned from Replicate' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Poll until complete
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { 'Authorization': `Token ${apiKey}` },
      });

      if (!pollRes.ok) {
        console.error('Replicate poll error:', await pollRes.text());
        continue;
      }

      const result = await pollRes.json();

      if (result.status === 'succeeded') {
        const outputUrl: string = Array.isArray(result.output) ? result.output[0] : result.output;
        return new Response(
          JSON.stringify({ outputUrl, scale: upscaleScale }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (result.status === 'failed' || result.status === 'canceled') {
        return new Response(
          JSON.stringify({ error: `Upscaling job ${result.status}`, details: result.error }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // status: 'starting' | 'processing' — keep polling
    }

    return new Response(
      JSON.stringify({ error: 'Upscaling timed out after 80 seconds' }),
      { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
