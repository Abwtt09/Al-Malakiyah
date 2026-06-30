// Supabase client initialization — Almalakiyah Real Estate
// Loaded from CDN as an ES module — no build step required.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Supabase project credentials ──────────────────────────────────────────────
export const SUPABASE_URL = 'https://gokrsumtnanolibmqibw.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdva3JzdW10bmFub2xpYm1xaWJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NzI4MjUsImV4cCI6MjA5ODE0ODgyNX0.hv8LIMJwcWGEkRRj75IVPzFQxkbgS6wzv0i9sHy1TZ8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persist session across page loads via localStorage (same behaviour as Firebase)
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// ── Auth helper ───────────────────────────────────────────────────────────────
// Users log in with a plain username. Internally we attach a fixed domain suffix
// so Supabase Auth sees a valid email-format identifier while the UI never shows
// the suffix.
export const AUTH_DOMAIN_SUFFIX = '@almalakiyah.local';

// ── Edge Function base URL ────────────────────────────────────────────────────
export const EDGE_BASE_URL = `${SUPABASE_URL}/functions/v1`;
