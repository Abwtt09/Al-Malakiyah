// Supabase Edge Function: send-whatsapp
// Port of the Firebase Cloud Function sendWhatsAppMessage.
// Deploy: supabase functions deploy send-whatsapp
// Set secrets: supabase secrets set WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// In-memory rate limiter (per Deno isolate — resets on cold start)
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 15;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(ip) ?? { count: 0, windowStart: now };
  if (now - record.windowStart > RATE_WINDOW_MS) {
    record.count = 1;
    record.windowStart = now;
  } else {
    record.count += 1;
  }
  rateLimitStore.set(ip, record);
  if (rateLimitStore.size > 5000) {
    for (const [key, val] of rateLimitStore) {
      if (now - val.windowStart > RATE_WINDOW_MS * 2) rateLimitStore.delete(key);
    }
  }
  return record.count > RATE_MAX_REQUESTS;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (isRateLimited(clientIp)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Too many requests. Try again later.' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let phone: string, message: string;
  try {
    ({ phone, message } = await req.json());
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON body.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (!phone?.trim()) {
    return new Response(
      JSON.stringify({ success: false, error: 'phone is required and must be a non-empty string.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  if (!message?.trim()) {
    return new Response(
      JSON.stringify({ success: false, error: 'message is required and must be a non-empty string.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

  if (!token || !phoneId) {
    console.error('WhatsApp credentials not configured.');
    return new Response(
      JSON.stringify({ success: false, error: 'Server configuration error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const normalizedPhone = phone.trim().replace(/\s+/g, '');

  try {
    const apiRes = await fetch(
      `https://graph.facebook.com/v25.0/${phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalizedPhone,
          type: 'text',
          text: { body: message.trim() },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    const data = await apiRes.json();
    if (!apiRes.ok) {
      const apiError = data?.error?.message ?? `HTTP ${apiRes.status}`;
      return new Response(
        JSON.stringify({ success: false, error: apiError }),
        { status: apiRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const messageId = data?.messages?.[0]?.id ?? data?.messages?.[0]?.wamid;
    console.info('WhatsApp message sent', { to: normalizedPhone, messageId });
    return new Response(
      JSON.stringify({ success: true, messageId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('WhatsApp API error', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message ?? 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
