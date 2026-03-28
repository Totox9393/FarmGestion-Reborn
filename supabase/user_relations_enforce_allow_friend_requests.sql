-- Enforce allow_friend_requests server-side.
-- Default behavior stays permissive when no row exists in user_settings.

create or replace function public.get_allow_friend_requests(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  setting_value jsonb;
  allows_requests boolean := true;
begin
  if p_user_id is null then
    return true;
  end if;

  select us.setting_value
    into setting_value
  from public.user_settings us
  where us.user_id = p_user_id
    and us.setting_name = 'allow_friend_requests'
  limit 1;

  if setting_value is null then
    return true;
  end if;

  if jsonb_typeof(setting_value) = 'boolean' then
    allows_requests := (setting_value::text = 'true');
  elsif jsonb_typeof(setting_value) = 'string' then
    allows_requests := lower(trim(both '"' from setting_value::text)) = 'true';
  elsif jsonb_typeof(setting_value) = 'object' then
    if jsonb_typeof(setting_value -> 'enabled') = 'boolean' then
      allows_requests := coalesce((setting_value ->> 'enabled')::boolean, true);
    elsif jsonb_typeof(setting_value -> 'value') = 'boolean' then
      allows_requests := coalesce((setting_value ->> 'value')::boolean, true);
    else
      allows_requests := true;
    end if;
  end if;

  return allows_requests;
end;
$$;

create or replace function public.enforce_allow_friend_requests_on_pending_relation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id uuid;
  setting_value jsonb;
  allows_requests boolean := true;
begin
  if new.status is distinct from 'pending' then
    return new;
  end if;

  if new.initiator is null then
    return new;
  end if;

  recipient_id := case
    when new.initiator = new.user_a then new.user_b
    else new.user_a
  end;

  select us.setting_value
    into setting_value
  from public.user_settings us
  where us.user_id = recipient_id
    and us.setting_name = 'allow_friend_requests'
  limit 1;

  if setting_value is null then
    return new;
  end if;

  if jsonb_typeof(setting_value) = 'boolean' then
    allows_requests := (setting_value::text = 'true');
  elsif jsonb_typeof(setting_value) = 'string' then
    allows_requests := lower(trim(both '"' from setting_value::text)) = 'true';
  elsif jsonb_typeof(setting_value) = 'object' then
    if jsonb_typeof(setting_value -> 'enabled') = 'boolean' then
      allows_requests := coalesce((setting_value ->> 'enabled')::boolean, true);
    elsif jsonb_typeof(setting_value -> 'value') = 'boolean' then
      allows_requests := coalesce((setting_value ->> 'value')::boolean, true);
    else
      allows_requests := true;
    end if;
  end if;

  if not allows_requests then
    raise exception 'Target user disabled friend requests'
      using errcode = 'P0001', detail = 'ALLOW_FRIEND_REQUESTS_DISABLED';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_allow_friend_requests_on_pending_relation on public.user_relations;

create trigger trg_enforce_allow_friend_requests_on_pending_relation
before insert or update of status, initiator, user_a, user_b
on public.user_relations
for each row
execute function public.enforce_allow_friend_requests_on_pending_relation();
