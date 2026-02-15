import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const BUCKET = 'betails';
const PAGE_SIZE = 50;
const SLEEP_MS = 50;

const bucketPrefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`;

const isPublicBucketUrl = (url) =>
  typeof url === 'string' && url.startsWith(bucketPrefix);

const getExtensionFromType = (contentType) => {
  if (!contentType) return 'png';
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  return 'png';
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let offset = 0;
let migrated = 0;
let skipped = 0;
let cleared = 0;

while (true) {
  const { data, error } = await supabase
    .from('betails')
    .select('id, avatar_url')
    .not('avatar_url', 'is', null)
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    console.error('Query error:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) break;

  for (const row of data) {
    const { id, avatar_url: avatarUrl } = row;

    if (!avatarUrl) {
      skipped += 1;
      continue;
    }

    // ✅ Déjà dans le bucket betails -> on ignore
    if (isPublicBucketUrl(avatarUrl)) {
      skipped += 1;
      continue;
    }

    try {
      const response = await fetch(avatarUrl, { mode: 'cors' });
      if (!response.ok) {
        console.warn(`Skip ${id}: fetch failed (${response.status})`);
        skipped += 1;
        continue;
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      const extension = getExtensionFromType(contentType);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Upload à la racine du bucket (pas de dossier)
      const filePath = `${Date.now()}-${id}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, buffer, {
          cacheControl: '3600',
          upsert: true,
          contentType,
        });

      if (uploadError) {
        console.warn(`Skip ${id}: upload failed (${uploadError.message})`);
        skipped += 1;
        continue;
      }

      const { data: publicUrlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(filePath);

      const publicUrl = publicUrlData?.publicUrl;
      if (!publicUrl) {
        console.warn(`Skip ${id}: no public URL`);
        skipped += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from('betails')
        .update({ avatar_url: publicUrl })
        .eq('id', id);

      if (updateError) {
        console.warn(`Skip ${id}: update failed (${updateError.message})`);
        skipped += 1;
        continue;
      }

      migrated += 1;
      await sleep(SLEEP_MS);
    } catch (err) {
      console.warn(`Skip ${id}: ${err?.message || 'error'}`);
      skipped += 1;
    }
  }

  offset += PAGE_SIZE;
}

console.log(`Done. Migrated: ${migrated}, Skipped: ${skipped}, Cleared: ${cleared}`);
