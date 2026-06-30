// Admin user creation — delegates to a Supabase Edge Function.
//
// Firebase allowed a secondary app instance to create accounts without signing
// out the admin. Supabase has no equivalent browser API (signUp signs you in as
// the new user). Instead we call a server-side Edge Function that uses the
// service role key — the admin's JWT in the Authorization header proves identity.
import { supabase, AUTH_DOMAIN_SUFFIX } from './supabase-config.js';

/**
 * Create a brand-new account by username + password.
 * Returns the new user's UID string.
 * The currently signed-in admin's session is NOT affected.
 *
 * Mirrors: createUserAccount(username, password) from the old admin-auth.js
 */
export async function createUserAccount(username, password) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) throw new Error('Username required');

  const email = u.includes('@') ? u : u + AUTH_DOMAIN_SUFFIX;

  // Invoke the Edge Function using the official Supabase client method
  const { data, error } = await supabase.functions.invoke('create-user', {
    body: { email, password },
  });

  if (error) {
    let errMsg = error.message || String(error);
    try {
      // If the error response contains JSON with an error message, extract it
      if (error.context) {
        const body = await error.context.json();
        if (body.error) errMsg = body.error;
      }
    } catch {}

    if (errMsg.includes('already registered') || errMsg.includes('already exists')) {
      const err = new Error(errMsg);
      err.code = 'auth/email-already-in-use';
      throw err;
    }
    if (errMsg.includes('password')) {
      const err = new Error(errMsg);
      err.code = 'auth/weak-password';
      throw err;
    }
    throw new Error(errMsg);
  }

  if (!data || !data.uid) {
    throw new Error('Invalid response from server');
  }

  return data.uid;
}
