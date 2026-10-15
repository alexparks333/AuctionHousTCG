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
  return new;
end;
$function$;

drop table agreement_acceptances;
