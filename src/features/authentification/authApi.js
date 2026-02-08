import { supabase } from './supabaseClient';

export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  return { data, error };
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function signInWithProvider(provider) {
  // provider: 'google', 'apple', 'discord', etc.
  const { data, error } = await supabase.auth.signInWithOAuth({ provider });
  return { data, error };
}
