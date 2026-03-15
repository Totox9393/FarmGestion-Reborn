create or replace function public.create_betail_reborn(
  p_name text,
  p_age integer,
  p_avatar_url text,
  p_matricule text,
  p_premium boolean default false,
  p_comments text default null,
  p_has_custom_photo boolean default false
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.users_profiles%rowtype;
  v_today date := (timezone('Europe/Paris', now()))::date;
  v_created_today integer := 0;
  v_award_limit integer := 10;
  v_is_awarded boolean := false;
  v_reward_amount integer := 0;
  v_reward_remaining integer := 0;
  v_reward_reason text := 'AWARDED';
  v_first_digit integer := 0;
  v_digits text;
  v_has_comment boolean := false;
  v_betail_id uuid;
  v_money_after integer := 0;
begin
  if v_user_id is null then
    return json_build_object('success', false, 'reason', 'NOT_AUTHENTICATED');
  end if;

  if p_name is null or btrim(p_name) = '' then
    return json_build_object('success', false, 'reason', 'INVALID_NAME');
  end if;

  if p_matricule is null or btrim(p_matricule) = '' then
    return json_build_object('success', false, 'reason', 'INVALID_MATRICULE');
  end if;

  if p_avatar_url is null or btrim(p_avatar_url) = '' then
    return json_build_object('success', false, 'reason', 'INVALID_AVATAR_URL');
  end if;

  if p_age is null or p_age < 1 then
    return json_build_object('success', false, 'reason', 'INVALID_AGE');
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text || ':' || v_today::text));

  select *
  into v_profile
  from public.users_profiles
  where id = v_user_id
  for update;

  if not found then
    return json_build_object('success', false, 'reason', 'PROFILE_NOT_FOUND');
  end if;

  select count(*)
  into v_created_today
  from public.betails b
  where b.author_id = v_user_id
    and (timezone('Europe/Paris', b.created_at))::date = v_today;

  v_is_awarded := v_created_today < v_award_limit;

  if v_is_awarded then
    v_digits := regexp_replace(coalesce(p_matricule, ''), '\\D', '', 'g');
    if v_digits is not null and v_digits <> '' then
      v_first_digit := coalesce(nullif(substr(v_digits, 1, 1), '')::integer, 0);
    else
      v_first_digit := 0;
    end if;

    v_has_comment := btrim(coalesce(p_comments, '')) <> '';

    v_reward_amount := 75
      + (case when coalesce(p_premium, false) then 75 else 0 end)
      + (case when coalesce(p_has_custom_photo, false) then 80 else 0 end)
      + (case when v_has_comment then 42 else 0 end)
      + greatest(0, least(v_first_digit, 9));

    v_reward_remaining := greatest(0, v_award_limit - (v_created_today + 1));
  else
    v_reward_amount := 0;
    v_reward_remaining := 0;
    v_reward_reason := 'DAILY_LIMIT_REACHED';
  end if;

  insert into public.betails (
    name,
    age,
    avatar_url,
    matricule,
    premium,
    comments,
    author_id,
    created_at
  )
  values (
    btrim(p_name),
    p_age,
    btrim(p_avatar_url),
    btrim(p_matricule),
    coalesce(p_premium, false),
    nullif(btrim(coalesce(p_comments, '')), ''),
    v_user_id,
    now()
  )
  returning id
  into v_betail_id;

  if v_is_awarded and v_reward_amount > 0 then
    update public.users_profiles
    set money = coalesce(money, 0) + v_reward_amount,
        updated_at = now()
    where id = v_user_id;
  end if;

  select coalesce(money, 0)
  into v_money_after
  from public.users_profiles
  where id = v_user_id;

  return json_build_object(
    'success', true,
    'betail_id', v_betail_id,
    'money_after', v_money_after,
    'reward', json_build_object(
      'awarded', v_is_awarded,
      'amount', v_reward_amount,
      'remaining', v_reward_remaining,
      'reason', v_reward_reason
    )
  );
end;
$$;

grant execute on function public.create_betail_reborn(text, integer, text, text, boolean, text, boolean) to authenticated;
