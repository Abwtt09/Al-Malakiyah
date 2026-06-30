// Supabase data layer for the custom Database Builder feature.
// Replaces databases-firestore.js — all exports are identical.
//
// Postgres tables:
//   public.databases        → schema (name, description, icon, fields JSONB[])
//   public.database_records → dynamic records keyed by db_id + JSONB data
import { supabase } from './supabase-config.js';

export function genFieldId() {
  return 'fld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ──────────────── Databases ──────────────── */

export async function createDatabase(data, userId) {
  const { data: result, error } = await supabase
    .from('databases')
    .insert({
      name: data.name,
      description: data.description || '',
      category: data.category || '',
      icon: data.icon || 'database',
      fields: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      created_by: userId || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return result.id;
}

export async function getDatabase(id) {
  const { data, error } = await supabase
    .from('databases')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return dbFromRow(data);
}

function dbFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    icon: r.icon,
    fields: r.fields || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
  };
}

export async function listDatabases() {
  const { data, error } = await supabase
    .from('databases')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const dbs = (data || []).map(dbFromRow);

  // Fetch record counts using a count query per database
  await Promise.all(
    dbs.map(async (db) => {
      try {
        const { count } = await supabase
          .from('database_records')
          .select('*', { count: 'exact', head: true })
          .eq('db_id', db.id);
        db.recordCount = count ?? 0;
      } catch {
        db.recordCount = 0;
      }
    }),
  );
  return dbs;
}

export async function updateDatabase(id, data) {
  const { error } = await supabase
    .from('databases')
    .update({
      name: data.name,
      description: data.description,
      category: data.category,
      icon: data.icon,
      fields: data.fields,
      updated_at: Date.now(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteDatabase(id) {
  // Delete records first (FK constraint), then the database row.
  const { error: recErr } = await supabase
    .from('database_records')
    .delete()
    .eq('db_id', id);
  if (recErr) throw recErr;

  const { error } = await supabase.from('databases').delete().eq('id', id);
  if (error) throw error;
}

export function watchDatabase(id, cb, onErr) {
  const fetch = () => getDatabase(id)
    .then(cb)
    .catch(onErr || ((e) => console.error('[watchDatabase]', e.message)));
  fetch();
  const channel = supabase.channel('watch-db-' + id)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'databases',
      filter: `id=eq.${id}`,
    }, fetch)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ──────────────── Fields (stored inside databases.fields JSONB array) ──── */

export async function addField(dbId, field) {
  const db = await getDatabase(dbId);
  if (!db) throw new Error('Database not found');
  const fields = db.fields || [];
  const newField = { ...field, id: genFieldId(), order: fields.length };
  const updated = [...fields, newField];
  const { error } = await supabase
    .from('databases')
    .update({ fields: updated, updated_at: Date.now() })
    .eq('id', dbId);
  if (error) throw error;
  return newField;
}

export async function updateField(dbId, fieldId, updates) {
  const db = await getDatabase(dbId);
  if (!db) throw new Error('Database not found');
  const fields = (db.fields || []).map((f) =>
    f.id === fieldId ? { ...f, ...updates } : f
  );
  const { error } = await supabase
    .from('databases')
    .update({ fields, updated_at: Date.now() })
    .eq('id', dbId);
  if (error) throw error;
}

export async function deleteField(dbId, fieldId) {
  const db = await getDatabase(dbId);
  if (!db) throw new Error('Database not found');
  const fields = (db.fields || []).filter((f) => f.id !== fieldId);
  const { error } = await supabase
    .from('databases')
    .update({ fields, updated_at: Date.now() })
    .eq('id', dbId);
  if (error) throw error;
}

export async function reorderFields(dbId, orderedFields) {
  const fields = orderedFields.map((f, i) => ({ ...f, order: i }));
  const { error } = await supabase
    .from('databases')
    .update({ fields, updated_at: Date.now() })
    .eq('id', dbId);
  if (error) throw error;
}

/* ──────────────── Records ──────────────── */

function recordFromRow(r) {
  return {
    id: r.id,
    _createdAt: r._created_at,
    _updatedAt: r._updated_at,
    _createdBy: r._created_by,
    ...(r.data || {}),
  };
}

export async function createRecord(dbId, data, userId) {
  const { id: _id, _createdAt, _updatedAt, _createdBy, ...rest } = data;
  const { data: result, error } = await supabase
    .from('database_records')
    .insert({
      db_id: dbId,
      data: rest,
      _created_at: Date.now(),
      _updated_at: Date.now(),
      _created_by: userId || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return result.id;
}

export async function listRecords(dbId, opts = {}) {
  let q = supabase
    .from('database_records')
    .select('*')
    .eq('db_id', dbId)
    .order('_created_at', { ascending: true });
  if (opts.max) q = q.limit(opts.max);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(recordFromRow);
}

export async function updateRecord(dbId, recordId, data) {
  const { id: _id, _createdAt, _updatedAt, _createdBy, ...rest } = data;
  const { error } = await supabase
    .from('database_records')
    .update({ data: rest, _updated_at: Date.now() })
    .eq('id', recordId)
    .eq('db_id', dbId);
  if (error) throw error;
}

export async function deleteRecord(dbId, recordId) {
  const { error } = await supabase
    .from('database_records')
    .delete()
    .eq('id', recordId)
    .eq('db_id', dbId);
  if (error) throw error;
}

export async function duplicateRecord(dbId, recordId, userId) {
  const { data: row, error } = await supabase
    .from('database_records')
    .select('*')
    .eq('id', recordId)
    .single();
  if (error) throw error;
  return createRecord(dbId, row.data || {}, userId);
}

export async function importRecords(dbId, rows, userId) {
  const ids = [];
  const BATCH_SIZE = 400;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const payload = chunk.map((row) => {
      const { id: _id, _createdAt, _updatedAt, _createdBy, ...rest } = row;
      return {
        db_id: dbId,
        data: rest,
        _created_at: Date.now(),
        _updated_at: Date.now(),
        _created_by: userId || null,
      };
    });
    const { data: inserted, error } = await supabase
      .from('database_records')
      .insert(payload)
      .select('id');
    if (error) throw error;
    ids.push(...(inserted || []).map((r) => r.id));
  }
  return ids;
}
