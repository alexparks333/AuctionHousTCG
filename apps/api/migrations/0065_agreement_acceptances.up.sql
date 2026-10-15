-- Records each member's acceptance of a specific version of a legal
-- document: the Terms of Service (which incorporates the Privacy Policy) and
-- the Seller Agreement. One row per (user, document, version) — publishing a
-- new version means everyone accepts again, and the old rows stay as the
-- record of what they agreed to and when. internal/agreement owns the
-- current version numbers and the checks that require them.
create table agreement_acceptances (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users(id),
    document    text not null check (document in ('terms', 'seller')),
    version     text not null,
    accepted_at timestamptz not null default now(),
    unique (user_id, document, version)
);

alter table agreement_acceptances enable row level security;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  desired_username text;
  candidate text;
  suffix int := 0;
begin
  desired_username := nullif(trim(new.raw_user_meta_data->>'username'), '');

  begin
    insert into public.users (id, email, created_at, username)
    values (new.id, new.email, new.created_at, desired_username)
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- ON CONFLICT (id) already absorbs an id collision; landing here
      -- means desired_username collided with an existing user's username.
      candidate := desired_username;
      loop
        suffix := suffix + 1;
        candidate := desired_username || '_' || suffix;
        begin
          insert into public.users (id, email, created_at, username)
          values (new.id, new.email, new.created_at, candidate)
          on conflict (id) do nothing;
          exit;
        exception
          when unique_violation then
            continue;
        end;
      end loop;
  end;

  -- The email sign-up form sends the Terms version the user ticked "I
  -- agree" to (SignUpForm.tsx). Recorded here, in the same transaction that
  -- creates the account, so the acceptance exists even before the user
  -- confirms their email. Google sign-ups don't carry it and accept on
  -- first page view instead (internal/agreement).
  if nullif(new.raw_user_meta_data->>'accepted_terms_version', '') is not null then
    insert into public.agreement_acceptances (user_id, document, version)
    values (new.id, 'terms', new.raw_user_meta_data->>'accepted_terms_version')
    on conflict do nothing;
  end if;
  return new;
end;
$function$;
