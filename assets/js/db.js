// Supabase data layer — replaces firestore.js
// All Firestore operations are replaced with supabase.from() queries.
// Real-time watchXxx() functions use supabase.channel() (equivalent of onSnapshot).
import { supabase } from './supabase-config.js';

/* ─────────────────────── Row mappers ─────────────────────────────────────
   Firestore stored all fields flat in each document.  In Supabase we keep
   commonly-queried fields as proper columns (status, category, featured,
   boundary, coordinates) and store the rest of the dynamic payload in a
   JSONB `data` column.  These helpers translate between DB rows and the
   flat objects the UI already expects.
   ───────────────────────────────────────────────────────────────────────── */

/** Convert a properties DB row → flat UI object (mirrors Firestore shape). */
function propFromRow(row) {
  if (!row) return null;
  const { id, created_at, updated_at, created_by, status, category, featured,
          boundary, boundary_source, coordinates, approved, archived, data, ...rest } = row;
  return {
    id,
    createdAt: created_at,
    updatedAt: updated_at,
    createdBy: created_by,
    status,
    category,
    featured,
    boundary,
    boundarySource: boundary_source,
    coordinates,
    approved: approved !== false,
    archived: archived === true,
    ...(data || {}),  // spread all dynamic Firestore fields
    ...rest,
  };
}

/** Convert a flat UI object → properties DB row for insert/update. */
function propToRow(obj) {
  const { id, createdAt, updatedAt, createdBy, status, category, featured,
          boundary, boundarySource, coordinates, approved, archived, ...rest } = obj;
  return {
    status: status ?? null,
    category: category ?? null,
    featured: featured ?? false,
    boundary: boundary ?? null,
    boundary_source: boundarySource ?? null,
    coordinates: coordinates ?? null,
    approved: approved !== false,
    archived: archived === true,
    data: rest,  // everything else stored as JSONB
  };
}

/** Generic mapper for simple single-table rows (profiles, messages, etc.). */
function fromRow(row) {
  if (!row) return null;
  return { id: row.id, ...row };
}

/** Helper to resolve private Supabase Storage paths to signed URLs dynamically */
async function resolveFileUrl(url) {
  if (!url) return '';
  // Check if the URL is a relative path in private deed-images bucket
  if (url.startsWith('deed-images/')) {
    try {
      const path = url.replace('deed-images/', '');
      const { data, error } = await supabase.storage.from('deed-images').createSignedUrl(path, 3600);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch (e) {
      console.warn('resolveFileUrl failed:', e.message);
    }
  }
  return url;
}

/* ─────────────────────── Properties ─────────────────────────────────── */

export async function createProperty(data) {
  const row = { ...propToRow(data), created_at: Date.now() };
  const { data: result, error } = await supabase
    .from('properties')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;
  return result.id;
}

export async function updateProperty(id, data) {
  const row = { ...propToRow(data), updated_at: Date.now() };
  const { error } = await supabase.from('properties').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteProperty(id) {
  const { error } = await supabase.from('properties').update({ archived: true, updated_at: Date.now() }).eq('id', id);
  if (error) throw error;
}

export async function hardDeleteProperty(id) {
  const { error } = await supabase.from('properties').delete().eq('id', id);
  if (error) throw error;
}

export async function restoreProperty(id) {
  const { error } = await supabase.from('properties').update({ archived: false, updated_at: Date.now() }).eq('id', id);
  if (error) throw error;
}

export async function approveProperty(id) {
  const { error } = await supabase.from('properties').update({ approved: true, updated_at: Date.now() }).eq('id', id);
  if (error) throw error;
}

export async function getProperty(id) {
  const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return propFromRow(data);
}

export async function listProperties(opts = {}) {
  let q = supabase.from('properties').select('*').order('created_at', { ascending: false });
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.category) q = q.eq('category', opts.category);
  if (opts.featured !== undefined) q = q.eq('featured', opts.featured);
  if (opts.max) q = q.limit(opts.max);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(propFromRow);
}

/** Live subscription — calls cb(properties[]) every time data changes. */
export function watchProperties(cb, onErr) {
  const fetch = () => listProperties()
    .then(cb)
    .catch(onErr || ((e) => console.error('[watchProperties]', e.message)));

  fetch(); // initial load

  const channel = supabase.channel('watch-properties')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, fetch)
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/* ─────────────────────── Attachments ──────────────────────────────────── */

export async function listAttachments() {
  const { data, error } = await supabase
    .from('attachments')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  
  const mapped = (data || []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    createdBy: r.created_by,
    ...(r.data || {}),
  }));

  // Resolve private file URLs to signed URLs
  await Promise.all(mapped.map(async (item) => {
    if (item.fileUrl) {
      item.fileUrl = await resolveFileUrl(item.fileUrl);
    }
  }));

  return mapped;
}

export async function createAttachment(payload) {
  const { id: _id, createdAt, createdBy, ...rest } = payload;
  const { data, error } = await supabase
    .from('attachments')
    .insert({ created_at: Date.now(), data: rest })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function deleteAttachment(id) {
  const { error } = await supabase.from('attachments').delete().eq('id', id);
  if (error) throw error;
}

export function watchAttachments(cb, onErr) {
  const fetch = () => listAttachments()
    .then(cb)
    .catch(onErr || ((e) => console.error('[watchAttachments]', e.message)));
  fetch();
  const channel = supabase.channel('watch-attachments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attachments' }, fetch)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ─────────────────────── Activity logs ────────────────────────────────── */

export async function logActivity({ action, targetType, targetId, userId, meta }) {
  try {
    const { error } = await supabase.from('logs').insert({
      action,
      target_type: targetType ?? null,
      target_id: targetId ?? null,
      user_id: userId ?? null,
      meta: meta ?? null,
      timestamp: Date.now(),
    });
    if (error) console.warn('logActivity failed:', error.message);
  } catch (e) {
    console.warn('logActivity failed:', e.message);
  }
}

export async function listLogs(max = 20) {
  const { data, error } = await supabase
    .from('logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(max);
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, ...r }));
}

export function watchLogs(cb, max = 8, onErr) {
  const fetch = () => listLogs(max)
    .then(cb)
    .catch(onErr || ((e) => console.error('[watchLogs]', e.message)));
  fetch();
  const channel = supabase.channel('watch-logs')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'logs' }, fetch)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ─────────────────────── Messages ─────────────────────────────────────── */

function msgFromRow(r) {
  return {
    id: r.id,
    fromUid: r.from_uid,
    fromName: r.from_name,
    subject: r.subject,
    body: r.body,
    toUids: r.to_uids || [],
    toAll: r.to_all,
    channels: r.channels || {},
    recipientsSummary: r.recipients_summary,
    readBy: r.read_by || {},
    createdAt: r.created_at,
  };
}

export async function sendMessage(payload) {
  const { data, error } = await supabase.from('messages').insert({
    from_uid: payload.fromUid,
    from_name: payload.fromName,
    subject: payload.subject,
    body: payload.body,
    to_uids: payload.toUids || [],
    to_all: payload.toAll || false,
    channels: payload.channels || {},
    recipients_summary: payload.recipientsSummary || '',
    read_by: {},
    created_at: Date.now(),
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function listMessagesForUser(uid) {
  // Direct messages (uid in to_uids array) OR broadcast (to_all = true)
  const [{ data: direct, error: e1 }, { data: broadcast, error: e2 }] = await Promise.all([
    supabase.from('messages').select('*').contains('to_uids', [uid]),
    supabase.from('messages').select('*').eq('to_all', true),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const seen = new Set();
  const out = [];
  for (const r of [...(direct || []), ...(broadcast || [])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(msgFromRow(r));
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

export async function listMessagesSentBy(uid) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('from_uid', uid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(msgFromRow);
}

export async function markMessageRead(id, uid) {
  // Update read_by JSONB: read_by[uid] = timestamp
  const { data: row, error: fetchErr } = await supabase
    .from('messages').select('read_by').eq('id', id).single();
  if (fetchErr) throw fetchErr;
  const readBy = { ...(row.read_by || {}), [uid]: Date.now() };
  const { error } = await supabase.from('messages').update({ read_by: readBy }).eq('id', id);
  if (error) throw error;
}

export async function deleteMessage(id) {
  const { error } = await supabase.from('messages').delete().eq('id', id);
  if (error) throw error;
}

/** Live message inbox (mirrors watchMessagesForUser). */
export function watchMessagesForUser(uid, cb, onErr) {
  const fetch = () => listMessagesForUser(uid)
    .then(cb)
    .catch(onErr || ((e) => console.error('[watchMessages]', e.message)));
  fetch();
  const channel = supabase.channel('watch-messages-' + uid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, fetch)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ─────────────────────── Projects ─────────────────────────────────────── */

function projectFromRow(r) {
  return { id: r.id, createdAt: r.created_at, ...(r.data || {}) };
}

export async function createProject(payload) {
  const { id: _id, createdAt, ...rest } = payload;
  const { data, error } = await supabase
    .from('projects')
    .insert({ created_at: Date.now(), data: rest })
    .select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateProject(id, payload) {
  const { id: _id, createdAt, ...rest } = payload;
  const { error } = await supabase.from('projects').update({ data: rest }).eq('id', id);
  if (error) throw error;
}

export async function deleteProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function getProject(id) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return projectFromRow(data);
}

export async function listProjects(max) {
  let q = supabase.from('projects').select('*').order('created_at', { ascending: false });
  if (max) q = q.limit(max);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(projectFromRow);
}

/* ─────────────────────── Users / Profiles ─────────────────────────────── */

function profileFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    uid: r.id,  // alias for compat
    username: r.username,
    name: r.name,
    phone: r.phone,
    role: r.role,
    disabled: r.disabled,
    createdAt: r.created_at,
    email: r.email,
    isSetupComplete: r.is_setup_complete !== false, // default to true if null/undefined
  };
}

export async function getUserProfile(uid) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  return profileFromRow(data);
}

export async function listUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(profileFromRow);
}

export async function setUserProfile(uid, payload) {
  // Use update instead of upsert to avoid triggering INSERT RLS policies for non-admin users completing setup
  const { error } = await supabase.from('profiles').update({
    name: payload.name ?? undefined,
    username: payload.username ?? undefined,
    phone: payload.phone ?? undefined,
    role: payload.role ?? undefined,
    disabled: payload.disabled ?? undefined,
    created_at: payload.createdAt ?? undefined,
    email: payload.email ?? undefined,
    is_setup_complete: payload.isSetupComplete ?? undefined,
  }).eq('id', uid);
  if (error) throw error;
}

export async function updateUserRole(uid, role) {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', uid);
  if (error) throw error;
}

export async function deleteUser(uid) {
  // Fully delete the user from both Auth and Profiles via Edge Function
  const { data, error } = await supabase.functions.invoke('create-user', {
    method: 'POST',
    body: { action: 'delete', uid }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
}

export const disableUser = (uid) =>
  supabase.from('profiles').update({ disabled: true }).eq('id', uid).then(({ error }) => { if (error) throw error; });

export const enableUser = (uid) =>
  supabase.from('profiles').update({ disabled: false }).eq('id', uid).then(({ error }) => { if (error) throw error; });

/* ─────────────────────── Taxonomy ─────────────────────────────────────── */
// Single `taxonomy` table replaces 5 separate Firestore collections.

const TAXONOMY_TYPES = new Set(['locations', 'features', 'amenities', 'types', 'categories']);

function assertTaxonomyCollection(name) {
  if (!TAXONOMY_TYPES.has(name)) throw new Error(`Unknown taxonomy type: ${name}`);
}

export async function listTaxonomy(type) {
  assertTaxonomyCollection(type);
  const { data, error } = await supabase.from('taxonomy').select('*').eq('type', type);
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.slug, slug: r.slug, name: r.name }));
}

export async function setTaxonomy(type, slug, name) {
  assertTaxonomyCollection(type);
  const { error } = await supabase.from('taxonomy').upsert(
    { type, slug, name },
    { onConflict: 'type,slug' }
  );
  if (error) throw error;
}

export async function deleteTaxonomy(type, slug) {
  assertTaxonomyCollection(type);
  const { error } = await supabase.from('taxonomy').delete().eq('type', type).eq('slug', slug);
  if (error) throw error;
}

/* ─────────────────────── Property Deed Documents ──────────────────────── */

function propDocFromRow(r) {
  return {
    id: r.id,
    propertyId: r.property_id,
    title: r.title,
    docType: r.doc_type,
    fileUrl: r.file_url,
    fileName: r.file_name,
    fileSize: r.file_size,
    extracted: r.extracted,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export async function listPropertyDocs(propertyId) {
  const { data, error } = await supabase
    .from('property_docs')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  
  const mapped = (data || []).map(propDocFromRow);

  // Resolve private file URLs to signed URLs
  await Promise.all(mapped.map(async (doc) => {
    if (doc.fileUrl) {
      doc.fileUrl = await resolveFileUrl(doc.fileUrl);
    }
  }));

  return mapped;
}

export async function createPropertyDoc(payload) {
  const { data, error } = await supabase.from('property_docs').insert({
    property_id: payload.propertyId,
    title: payload.title,
    doc_type: payload.docType,
    file_url: payload.fileUrl,
    file_name: payload.fileName,
    file_size: payload.fileSize,
    extracted: payload.extracted ?? null,
    created_at: Date.now(),
    created_by: payload.createdBy ?? null,
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function deletePropertyDoc(id) {
  const { error } = await supabase.from('property_docs').delete().eq('id', id);
  if (error) throw error;
}

export async function updatePropertyDoc(id, payload) {
  const { error } = await supabase.from('property_docs').update({
    title: payload.title,
    doc_type: payload.docType,
    file_url: payload.fileUrl,
    file_name: payload.fileName,
    file_size: payload.fileSize,
    extracted: payload.extracted ?? null,
  }).eq('id', id);
  if (error) throw error;
}

export function watchPropertyDocs(propertyId, cb, onErr) {
  const fetch = () => listPropertyDocs(propertyId)
    .then(cb)
    .catch(onErr || ((e) => console.error('[watchPropertyDocs]', e.message)));
  fetch();
  const channel = supabase.channel('watch-propdocs-' + propertyId)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'property_docs',
      filter: `property_id=eq.${propertyId}`,
    }, fetch)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ─────────────────────── Property Boundary ────────────────────────────── */

export async function updatePropertyBoundary(id, boundary, source) {
  const { error } = await supabase.from('properties').update({
    boundary: boundary ?? null,
    boundary_source: source ?? null,
    updated_at: Date.now(),
  }).eq('id', id);
  if (error) throw error;
}

/* ─────────────────────── Bulk Property Import ──────────────────────────── */

export async function importProperties(rows, userId) {
  const ids = [];
  for (const row of rows) {
    const id = await createProperty({ ...row, createdBy: userId });
    ids.push(id);
  }
  return ids;
}
