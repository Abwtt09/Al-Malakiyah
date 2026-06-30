// Rate limiting: in-memory per Worker isolate
const rateMap = new Map();
const WINDOW_MS = 60_000;
const MAX_REQ = 15;

function isRateLimited(ip) {
  const now = Date.now();
  const rec = rateMap.get(ip) || { count: 0, start: now };
  if (now - rec.start > WINDOW_MS) { rec.count = 1; rec.start = now; }
  else rec.count++;
  rateMap.set(ip, rec);
  if (rateMap.size > 2000) {
    for (const [k, v] of rateMap)
      if (now - v.start > WINDOW_MS * 2) rateMap.delete(k);
  }
  return rec.count > MAX_REQ;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json(null, 204);
    if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (isRateLimited(ip)) return json({ success: false, error: 'Too many requests. Try again later.' }, 429);

    let body;
    try { body = await request.json(); }
    catch { return json({ success: false, error: 'Invalid JSON body.' }, 400); }

    const { phone, message } = body ?? {};

    if (!phone || typeof phone !== 'string' || !phone.trim())
      return json({ success: false, error: 'phone is required.' }, 400);
    if (!message || typeof message !== 'string' || !message.trim())
      return json({ success: false, error: 'message is required.' }, 400);

    try {
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone.trim().replace(/\s+/g, ''),
            type: 'text',
            text: { body: message.trim() },
          }),
        }
      );

      const data = await res.json();

      if (!res.ok)
        return json({ success: false, error: data?.error?.message || 'WhatsApp API error.' }, res.status);

      const messageId = data?.messages?.[0]?.id;
      return json({ success: true, messageId });

    } catch (err) {
      return json({ success: false, error: err.message || 'Server error.' }, 500);
    }
  },
};
