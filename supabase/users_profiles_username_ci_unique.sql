-- Enforce case-insensitive uniqueness for usernames.
-- Run this migration once in Supabase SQL editor.

-- Optional diagnostic query before applying:
-- select lower(username) as normalized_username, array_agg(id) as user_ids, count(*)
-- from public.users_profiles
-- group by lower(username)
-- having count(*) > 1;

create unique index if not exists users_profiles_username_ci_unique_idx
on public.users_profiles (lower(username));
