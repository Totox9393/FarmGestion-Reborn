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

const bucketPrefix = '/storage/v1/object/public/betails/';
const isBucketUrl = (url) => typeof url === 'string' && url.includes(bucketPrefix);
const isFlatBucketUrl = (url) => {
  if (!isBucketUrl(url)) return false;
  const path = url.split(bucketPrefix)[1] || '';
  return path && !path.includes('/') && !path.includes('%2F');
};
const getBucketPath = (url) => {
  if (!isBucketUrl(url)) return '';
  const rawPath = url.split(bucketPrefix)[1] || '';
  return decodeURIComponent(rawPath.split('?')[0]);
};

const getExtensionFromType = (contentType) => {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/jpeg' || contentType === 'image/jpg') return 'jpg';
  return 'png';
};

let offset = 0;
let migrated = 0;
let skipped = 0;

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

    try {
      let buffer;
      let contentType = 'image/png';

      if (isBucketUrl(avatarUrl)) {
        if (isFlatBucketUrl(avatarUrl)) {
          skipped += 1;
          continue;
        }
        const objectPath = getBucketPath(avatarUrl);
        const { data: fileData, error: downloadError } = await supabase
          .storage
          .from(BUCKET)
          .download(objectPath);
        if (downloadError || !fileData) {
          const { error: updateError } = await supabase
            .from('betails')
            .update({ avatar_url: null })
            .eq('id', id);
          if (updateError) {
            console.warn(`Skip ${id}: missing file and update failed (${updateError.message})`);
          } else {
            console.warn(`Missing file for ${id}: avatar_url cleared`);
          }
          skipped += 1;
          continue;
        }
        contentType = fileData.type || contentType;
        const arrayBuffer = await fileData.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else {
        const response = await fetch(avatarUrl, { mode: 'cors' });
        if (!response.ok) {
          console.warn(`Skip ${id}: fetch failed (${response.status})`);
          skipped += 1;
          continue;
        }
        contentType = response.headers.get('content-type') || contentType;
        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }

      const extension = getExtensionFromType(contentType);
      const filePath = `${Date.now()}-${id}-migrated.${extension}`;

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

      const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
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
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (err) {
      console.warn(`Skip ${id}: ${err.message || 'error'}`);
      skipped += 1;
    }
  }

  offset += PAGE_SIZE;
}

console.log(`Migration done. Migrated: ${migrated}, Skipped: ${skipped}`);
