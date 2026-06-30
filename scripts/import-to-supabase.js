#!/usr/bin/env node
/**
 * import-to-supabase.js
 * ────────────────────────────────────────────────────────────
 * Imports the JSON files from ./exported-data/ into your Supabase project.
 *
 * SETUP:
 *   1. npm install @supabase/supabase-js
 *   2. Create a .env file (or edit the constants below):
 *        SUPABASE_URL=https://your-project.supabase.co
 *        SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 *   3. Make sure you've already run supabase/schema.sql in the SQL Editor
 *   4. node import-to-supabase.js
 *
 * WHAT IT DOES:
 *   - Creates Supabase Auth accounts for all Firebase Auth users
 *     (with a temporary password — users must reset via Settings page)
 *   - Imports profiles, properties, messages, attachments, logs,
 *     property_docs, projects, databases, database_records, taxonomy
 *   - Preserves all Firestore timestamps (stored as BIGINT milliseconds)
 *   - Preserves Firestore document IDs in a `firestore_id` metadata field
 *     inside the JSONB `data` column for traceability
 * ────────────────────────────────────────────────────────────
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_SERVICE_ROLE_KEY';

// Temporary password assigned to all migrated users.
// They should change it via Settings → Change Password after first login.
const TEMP_PASSWORD = 'Almalakiyah@2025!ChangeMe';

// Auth domain suffix used for username→email conversion
const AUTH_DOMAIN_SUFFIX = '@almalakiyah.local';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'exported-data');

function loadJSON(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠  ${filename} not found, skipping.`);
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function batchInsert(table, rows, batchSize = 200) {
  if (!rows.length) return;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { ignoreDuplicates: true });
    if (error) {
      console.error(`    ❌ ${table} batch error:`, error.message);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`  ✓  ${table}  (${inserted}/${rows.length} rows)`);
}

// Maps old Firebase UID → new Supabase UUID
const uidMap = new Map();

// ── Step 1: Create Supabase Auth users ────────────────────────────────────────

async function importAuthUsers() {
  console.log('\n📦 Step 1: Creating Supabase Auth users...');
  const authUsers = loadJSON('auth_users.json');
  const profiles = loadJSON('users.json');

  // Build a quick lookup from uid → Firestore profile
  const profileByUid = new Map(profiles.map((p) => [p._firestoreId, p]));

  for (const fbUser of authUsers) {
    try {
      const profile = profileByUid.get(fbUser.uid) || {};
      const email = fbUser.email || `${fbUser.uid}${AUTH_DOMAIN_SUFFIX}`;

      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: TEMP_PASSWORD,
        email_confirm: true,
        user_metadata: {
          role: profile.role || 'viewer',
          firestore_uid: fbUser.uid,
        },
      });

      if (error) {
        if (error.message?.includes('already been registered') || error.message?.includes('already exists')) {
          // User already exists — look them up to get the Supabase UID
          const { data: existing } = await supabase.auth.admin.listUsers();
          const found = existing?.users?.find((u) => u.email === email);
          if (found) {
            uidMap.set(fbUser.uid, found.id);
            console.log(`    ↩  ${email} already exists (${found.id})`);
          }
        } else {
          console.error(`    ❌  ${email}: ${error.message}`);
        }
        continue;
      }

      const newUid = data.user.id;
      uidMap.set(fbUser.uid, newUid);
      console.log(`    ✓  ${email} → ${newUid}`);
    } catch (e) {
      console.error(`    ❌  ${fbUser.uid}: ${e.message}`);
    }
  }

  // Save the UID mapping for reference
  const mapObj = Object.fromEntries(uidMap);
  fs.writeFileSync(
    path.join(__dirname, 'exported-data', 'uid-map.json'),
    JSON.stringify(mapObj, null, 2),
    'utf8',
  );
  console.log(`  UID map saved to exported-data/uid-map.json (${uidMap.size} entries)`);
}

function resolveUid(firebaseUid) {
  return uidMap.get(firebaseUid) || null;
}

// ── Step 2: Import profiles ────────────────────────────────────────────────────

async function importProfiles() {
  console.log('\n📦 Step 2: Importing profiles...');
  const users = loadJSON('users.json');
  const rows = users.map((u) => {
    const newUid = resolveUid(u._firestoreId);
    if (!newUid) return null;
    return {
      id: newUid,
      username: u.username || null,
      name: u.name || null,
      phone: u.phone || null,
      email: u.email || null,
      role: u.role || 'viewer',
      disabled: u.disabled || false,
      is_setup_complete: false, // force migrated users to complete setup on first login
      created_at: u.createdAt || Date.now(),
    };
  }).filter(Boolean);

  await batchInsert('profiles', rows);
}

// ── Step 3: Import properties ──────────────────────────────────────────────────

async function importProperties() {
  console.log('\n📦 Step 3: Importing properties...');
  const items = loadJSON('properties.json');
  const rows = items.map((p) => {
    const { _firestoreId, createdAt, updatedAt, createdBy,
      status, category, featured, boundary, boundarySource,
      coordinates, ...rest } = p;
    return {
      // Store the Firestore ID as the Postgres UUID where possible
      // (Firestore IDs are 20-char strings, not valid UUIDs — we generate new ones)
      status: status || null,
      category: category || null,
      featured: featured || false,
      boundary: boundary || null,
      boundary_source: boundarySource || null,
      coordinates: coordinates || null,
      created_at: createdAt || Date.now(),
      updated_at: updatedAt || null,
      created_by: resolveUid(createdBy) || null,
      data: { ...rest, _firestoreId },  // preserve old ID for traceability
    };
  });
  await batchInsert('properties', rows);
}

// ── Step 4: Import projects ────────────────────────────────────────────────────

async function importProjects() {
  console.log('\n📦 Step 4: Importing projects...');
  const items = loadJSON('projects.json');
  const rows = items.map(({ _firestoreId, createdAt, createdBy, ...rest }) => ({
    created_at: createdAt || Date.now(),
    created_by: resolveUid(createdBy) || null,
    data: { ...rest, _firestoreId },
  }));
  await batchInsert('projects', rows);
}

// ── Step 5: Import attachments ─────────────────────────────────────────────────

async function importAttachments() {
  console.log('\n📦 Step 5: Importing attachments...');
  const items = loadJSON('attachments.json');
  const rows = items.map(({ _firestoreId, createdAt, createdBy, ...rest }) => ({
    created_at: createdAt || Date.now(),
    created_by: resolveUid(createdBy) || null,
    data: { ...rest, _firestoreId },
  }));
  await batchInsert('attachments', rows);
}

// ── Step 6: Import messages ────────────────────────────────────────────────────

async function importMessages() {
  console.log('\n📦 Step 6: Importing messages...');
  const items = loadJSON('messages.json');
  const rows = items.map((m) => {
    const toUids = (m.toUids || []).map(resolveUid).filter(Boolean);
    return {
      from_uid: resolveUid(m.fromUid) || null,
      from_name: m.fromName || null,
      subject: m.subject || null,
      body: m.body || null,
      to_uids: toUids,
      to_all: m.toAll || false,
      channels: m.channels || {},
      recipients_summary: m.recipientsSummary || '',
      read_by: m.readBy || {},
      created_at: m.createdAt || Date.now(),
    };
  });
  await batchInsert('messages', rows);
}

// ── Step 7: Import logs ────────────────────────────────────────────────────────

async function importLogs() {
  console.log('\n📦 Step 7: Importing activity logs...');
  const items = loadJSON('logs.json');
  const rows = items.map((l) => ({
    action: l.action || null,
    target_type: l.targetType || null,
    target_id: l.targetId || null,
    user_id: resolveUid(l.userId) || null,
    meta: l.meta || null,
    timestamp: l.timestamp || Date.now(),
  }));
  await batchInsert('logs', rows);
}

// ── Step 8: Import property docs ──────────────────────────────────────────────

async function importPropertyDocs() {
  console.log('\n📦 Step 8: Importing property documents...');
  // We need to know the new Postgres UUIDs for properties.
  // Since we didn't preserve Firestore IDs as PKs, we fetch properties with their
  // _firestoreId stored in the `data` column.
  const { data: propRows } = await supabase
    .from('properties')
    .select('id, data');

  const propIdByFirestoreId = new Map(
    (propRows || []).map((r) => [r.data?._firestoreId, r.id])
  );

  const items = loadJSON('propertyDocs.json');
  const rows = items.map((doc) => ({
    property_id: propIdByFirestoreId.get(doc.propertyId) || null,
    title: doc.title || null,
    doc_type: doc.docType || null,
    file_url: doc.fileUrl || null,
    file_name: doc.fileName || null,
    file_size: doc.fileSize || null,
    extracted: doc.extracted || null,
    created_at: doc.createdAt || Date.now(),
    created_by: resolveUid(doc.createdBy) || null,
  })).filter((r) => r.property_id);  // skip orphaned docs
  await batchInsert('property_docs', rows);
}

// ── Step 9: Import taxonomy ────────────────────────────────────────────────────

async function importTaxonomy() {
  console.log('\n📦 Step 9: Importing taxonomy...');
  const items = loadJSON('taxonomy.json');
  const rows = items.map((t) => ({
    type: t.type,
    slug: t.slug || t._firestoreId,
    name: t.name || t.slug || t._firestoreId,
  }));
  await batchInsert('taxonomy', rows);
}

// ── Step 10: Import databases ─────────────────────────────────────────────────

async function importDatabases() {
  console.log('\n📦 Step 10: Importing custom databases...');
  const items = loadJSON('databases.json');
  // Map old Firestore DB ID → new Postgres UUID
  const dbIdMap = new Map();

  for (const db of items) {
    const { _firestoreId, createdAt, updatedAt, createdBy, ...rest } = db;
    const { data: result, error } = await supabase
      .from('databases')
      .insert({
        name: rest.name,
        description: rest.description || '',
        category: rest.category || '',
        icon: rest.icon || 'database',
        fields: rest.fields || [],
        created_at: createdAt || Date.now(),
        updated_at: updatedAt || Date.now(),
        created_by: resolveUid(createdBy) || null,
      })
      .select('id')
      .single();
    if (error) {
      console.error(`    ❌  database ${rest.name}: ${error.message}`);
    } else {
      dbIdMap.set(_firestoreId, result.id);
      console.log(`    ✓  database "${rest.name}" → ${result.id}`);
    }
  }
  return dbIdMap;
}

async function importDatabaseRecords(dbIdMap) {
  console.log('\n📦 Step 11: Importing database records...');
  const items = loadJSON('database_records.json');
  const rows = items.map(({ _firestoreId, _parentId, _createdAt, _updatedAt, _createdBy, ...rest }) => {
    const dbId = dbIdMap.get(_parentId);
    if (!dbId) return null;
    return {
      db_id: dbId,
      data: { ...rest, _firestoreId },
      _created_at: _createdAt || Date.now(),
      _updated_at: _updatedAt || Date.now(),
      _created_by: resolveUid(_createdBy) || null,
    };
  }).filter(Boolean);
  await batchInsert('database_records', rows);
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n🚀 Starting Firestore → Supabase data import...\n');

  if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    console.error('❌ Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in scripts/.env');
    process.exit(1);
  }

  await importAuthUsers();
  await importProfiles();
  await importProperties();
  await importProjects();
  await importAttachments();
  await importMessages();
  await importLogs();
  await importPropertyDocs();
  await importTaxonomy();
  const dbIdMap = await importDatabases();
  await importDatabaseRecords(dbIdMap);

  console.log('\n✅ Import complete!\n');
  console.log('⚠️  IMPORTANT: All migrated users have the temporary password:');
  console.log(`    ${TEMP_PASSWORD}`);
  console.log('   Ask each user to change their password in Settings → Change Password.\n');
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ Import failed:', e);
  process.exit(1);
});
