// Auth helpers — Supabase Auth replacement for Firebase Auth.
// Preserves the same exported API so all callers work unchanged.
import { supabase, AUTH_DOMAIN_SUFFIX, EDGE_BASE_URL } from './supabase-config.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Convert a plain username to the internal email used by Supabase Auth. */
function toEmail(username) {
  const u = String(username || '').trim().toLowerCase();
  return u.includes('@') ? u : u + AUTH_DOMAIN_SUFFIX;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sign in by username + password.
 * Mirrors: signInWithEmailAndPassword(auth, email, password)
 */
export async function signIn(username, password) {
  let email;
  const u = String(username || '').trim().toLowerCase();
  if (u.includes('@')) {
    email = u;
  } else {
    try {
      const { data: dbEmail, error: rpcError } = await supabase.rpc('get_email_by_username', { p_username: u });
      if (!rpcError && dbEmail) {
        email = dbEmail;
      } else {
        email = u + AUTH_DOMAIN_SUFFIX;
      }
    } catch (e) {
      console.warn('[signIn] RPC lookup failed, falling back to default suffix', e);
      email = u + AUTH_DOMAIN_SUFFIX;
    }
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/**
 * Sign out the current user.
 * Mirrors: signOut(auth)
 */
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

/**
 * Subscribe to auth state changes. Returns an unsubscribe function.
 * Mirrors: onAuthStateChanged(auth, cb) — returns an unsubscribe function.
 * The callback receives the Supabase User object (or null) directly.
 *
 * IMPORTANT: Supabase fires the callback asynchronously on init, just like
 * onAuthStateChanged. The initial event is emitted on the next tick.
 */
export function subscribeAuth(cb) {
  // Immediately check the existing session so callers that redirect on login
  // (e.g. login.html) work without waiting for the async event.
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      session.user.uid = session.user.id; // compat alias
    }
    cb(session?.user ?? null);
  });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      session.user.uid = session.user.id; // compat alias
    }
    cb(session?.user ?? null);
  });
  return () => subscription.unsubscribe();
}

/**
 * Re-authenticate (verify current password) then update to new password.
 * Mirrors: reauthenticateWithCredential + updatePassword
 */
export async function changePassword(currentPassword, newPassword) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not signed in');

  // Re-authenticate to verify the current password is correct.
  const { error: reAuthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reAuthError) throw new Error('كلمة المرور الحالية غير صحيحة / Incorrect current password');

  // Now change the password.
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Strip the internal suffix to display a clean username. */
export function displayUsername(idOrEmail) {
  const s = String(idOrEmail || '');
  return s.endsWith(AUTH_DOMAIN_SUFFIX) ? s.slice(0, -AUTH_DOMAIN_SUFFIX.length) : s;
}

/**
 * Redirect-guard for dashboard pages.
 * Returns a Promise that resolves with the signed-in user, or navigates to
 * the login page.
 * Mirrors: the Firebase requireAuth() pattern.
 *
 * Supabase sessions are stored locally and accessible synchronously, so this
 * resolves near-instantly (no 20 s timeout needed).
 */
export async function requireAuth({ redirectTo = '/admin/login.html' } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    session.user.uid = session.user.id; // compat alias
    return session.user;
  }
  window.location.replace(redirectTo);
  throw new Error('not signed in');
}
