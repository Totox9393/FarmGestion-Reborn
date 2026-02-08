import { supabase } from '../../features/authentification/supabaseClient';

// Upload une image dans un bucket Supabase Storage
export async function uploadImageToBucket(bucket, file, userId, folder = '') {
  if (!file) return { error: 'Aucun fichier' };
  const ext = file.name.split('.').pop();
  const normalizedFolder = folder ? `${folder.replace(/^\/+|\/+$/g, '')}/` : '';
  const filePath = `${normalizedFolder}${userId}/${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from(bucket).upload(filePath, file, {
    cacheControl: '3600',
    upsert: true,
  });
  if (error) return { error };
  // Récupère l'URL publique
  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return { url: publicUrlData?.publicUrl, error: null };
}
