// Supabase Storage client integration for file uploads
// Replaces Cloudinary with native Supabase Storage buckets.
import { supabase } from './supabase-config.js';

/**
 * Uploads a file to a Supabase Storage bucket.
 * Custom onProgress handling using XMLHttpRequest since supabase-js upload()
 * does not support progress callbacks natively in standard fetch.
 */
export async function uploadToStorage(file, bucket, { path = '', onProgress } = {}) {
  const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
  const filePath = path ? `${path}/${fileName}` : fileName;

  // Get current session token for authentication
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${supabase.supabaseUrl}/storage/v1/object/${bucket}/${filePath}`;
    
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token || supabase.supabaseKey}`);
    xhr.setRequestHeader('apikey', supabase.supabaseKey);

    const formData = new FormData();
    formData.append('cacheControl', '3600');
    formData.append('file', file);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress((e.loaded / e.total) * 100);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve({
            path: filePath,
            bucket: bucket,
          });
        } catch {
          reject(new Error('Invalid response from Supabase Storage'));
        }
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.message) message = body.message;
        } catch {}
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error('Network error uploading to Supabase Storage'));
    xhr.send(formData);
  });
}

/**
 * Gets a public URL for a file in a public bucket (e.g. land-images).
 */
export function getPublicUrl(bucket, path) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Gets a signed URL for a file in a private bucket (e.g. deed-images).
 * Default expiry: 1 hour (3600 seconds).
 */
export async function getSignedUrl(bucket, path, expiry = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiry);
  if (error) throw error;
  return data.signedUrl;
}
