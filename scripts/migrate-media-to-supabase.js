#!/usr/bin/env node
/**
 * migrate-media-to-supabase.js
 * ────────────────────────────────────────────────────────────
 * Downloads all existing media files (from Cloudinary/external URLs)
 * found in your database records and uploads them to Supabase Storage:
 *   - Property photos (from public.properties.data.images) → 'land-images' bucket (public)
 *   - Attachments (from public.attachments.data.fileUrl) → 'deed-images' bucket (private)
 *   - Property documents (from public.property_docs.file_url) → 'deed-images' bucket (private)
 *
 * It then updates the database records to point to the new Supabase Storage locations.
 *
 * SETUP:
 *   1. Make sure scripts/.env has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   2. Make sure you created the 'land-images' (public) and 'deed-images' (private) buckets in Supabase Storage
 *   3. node migrate-media-to-supabase.js
 * ────────────────────────────────────────────────────────────
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || SUPABASE_URL.includes('YOUR_')) {
  console.error('❌ Please configure your Supabase credentials in scripts/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Download file from URL into a Buffer */
async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} when downloading ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Upload Buffer to Supabase Storage bucket */
async function uploadToStorage(buffer, bucket, originalUrl, contentType = 'application/octet-stream') {
  // Extract file extension and generate a clean filename
  const urlPath = new URL(originalUrl).pathname;
  const ext = path.extname(urlPath) || '.jpg';
  const name = path.basename(urlPath, ext).replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${Date.now()}_${name}${ext}`;

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filename, buffer, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw error;
  return data.path;
}

// ── Migration Logic ───────────────────────────────────────────────────────────

async function migrateProperties() {
  console.log('\n📸 Migrating property images to "land-images" bucket...');
  const { data: properties, error } = await supabase
    .from('properties')
    .select('id, data');

  if (error) throw error;
  console.log(`Found ${properties.length} properties to process.`);

  let count = 0;
  for (const prop of properties) {
    const data = prop.data || {};
    const images = data.images || [];
    if (!images.length) continue;

    const newImages = [];
    let updated = false;

    for (const imgUrl of images) {
      // Only migrate external URLs (Cloudinary or others)
      if (imgUrl.startsWith('http') && !imgUrl.includes(SUPABASE_URL)) {
        console.log(`  Downloading property photo: ${imgUrl}`);
        try {
          const buffer = await downloadFile(imgUrl);
          const storagePath = await uploadToStorage(buffer, 'land-images', imgUrl, 'image/jpeg');
          
          // Get public URL for public bucket
          const { data: { publicUrl } } = supabase.storage.from('land-images').getPublicUrl(storagePath);
          newImages.push(publicUrl);
          updated = true;
          count++;
        } catch (e) {
          console.error(`  ❌ Failed to migrate ${imgUrl}:`, e.message);
          newImages.push(imgUrl); // Keep old URL on failure
        }
      } else {
        newImages.push(imgUrl);
      }
    }

    if (updated) {
      const updatedData = { ...data, images: newImages };
      const { error: updateErr } = await supabase
        .from('properties')
        .update({ data: updatedData })
        .eq('id', prop.id);
      if (updateErr) {
        console.error(`  ❌ Failed to update property ${prop.id} in DB:`, updateErr.message);
      } else {
        console.log(`  ✓ Updated property images in database.`);
      }
    }
  }
  console.log(`✅ Property images migration finished (${count} photos migrated).`);
}

async function migrateAttachments() {
  console.log('\n📎 Migrating attachments to "deed-images" bucket...');
  const { data: attachments, error } = await supabase
    .from('attachments')
    .select('id, data');

  if (error) throw error;
  console.log(`Found ${attachments.length} attachments to process.`);

  let count = 0;
  for (const att of attachments) {
    const data = att.data || {};
    const fileUrl = data.fileUrl || '';

    // Only migrate external URLs (Cloudinary or others)
    if (fileUrl.startsWith('http') && !fileUrl.includes(SUPABASE_URL)) {
      console.log(`  Downloading attachment: ${fileUrl}`);
      try {
        const buffer = await downloadFile(fileUrl);
        const storagePath = await uploadToStorage(buffer, 'deed-images', fileUrl);
        
        // Save relative path for private bucket so resolveFileUrl() handles it
        const dbPath = `deed-images/${storagePath}`;
        const updatedData = { ...data, fileUrl: dbPath };
        
        const { error: updateErr } = await supabase
          .from('attachments')
          .update({ data: updatedData })
          .eq('id', att.id);

        if (updateErr) {
          console.error(`  ❌ Failed to update attachment ${att.id} in DB:`, updateErr.message);
        } else {
          console.log(`  ✓ Attachment migrated to Supabase Storage.`);
          count++;
        }
      } catch (e) {
        console.error(`  ❌ Failed to migrate attachment ${fileUrl}:`, e.message);
      }
    }
  }
  console.log(`✅ Attachments migration finished (${count} files migrated).`);
}

async function migratePropertyDocs() {
  console.log('\n📄 Migrating property deed documents to "deed-images" bucket...');
  const { data: docs, error } = await supabase
    .from('property_docs')
    .select('id, file_url');

  if (error) throw error;
  console.log(`Found ${docs.length} property documents to process.`);

  let count = 0;
  for (const doc of docs) {
    const fileUrl = doc.file_url || '';

    // Only migrate external URLs
    if (fileUrl.startsWith('http') && !fileUrl.includes(SUPABASE_URL)) {
      console.log(`  Downloading deed doc: ${fileUrl}`);
      try {
        const buffer = await downloadFile(fileUrl);
        const storagePath = await uploadToStorage(buffer, 'deed-images', fileUrl);
        
        // Save relative path for private bucket so resolveFileUrl() handles it
        const dbPath = `deed-images/${storagePath}`;
        
        const { error: updateErr } = await supabase
          .from('property_docs')
          .update({ file_url: dbPath })
          .eq('id', doc.id);

        if (updateErr) {
          console.error(`  ❌ Failed to update document ${doc.id} in DB:`, updateErr.message);
        } else {
          console.log(`  ✓ Document migrated to Supabase Storage.`);
          count++;
        }
      } catch (e) {
        console.error(`  ❌ Failed to migrate document ${fileUrl}:`, e.message);
      }
    }
  }
  console.log(`✅ Property documents migration finished (${count} files migrated).`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n🚀 Starting Media Assets Migration to Supabase Storage...\n');

  await migrateProperties();
  await migrateAttachments();
  await migratePropertyDocs();

  console.log('\n🎉 ALL MEDIA ASSETS MIGRATION COMPLETED SUCCESSFULLY!\n');
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ Media migration failed:', e);
  process.exit(1);
});
