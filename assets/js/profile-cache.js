// Local cache of the signed-in user's profile.
//
// The dashboard renders the sidebar synchronously from this cache so the
// chrome appears instantly — even on a cold Firebase connection.
// We re-verify in the background and update the cache if anything changed.

const KEY = 'almalakiyah.profile.v1';

export function readCachedProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.uid) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeCachedProfile(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

export function clearCachedProfile() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
