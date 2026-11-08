-- Workstream 1.3: recovery codes (ADR-021) and invitation preview (SECURITY.md §3.8).
begin;
\ir _helpers.psql

select plan(31);

-- Grants and hardening -----------------------------------------------------------------
select ok(not has_function_privilege('anon', 'app.replace_recovery_codes(text[])', 'execute'), 'anon cannot replace codes');
select ok(not has_function_privilege('anon', 'app.consume_recovery_code(text)', 'execute'), 'anon cannot consume codes');
select ok(not has_function_privilege('authenticated', 'app.peek_staff_invitation(bytea)', 'execute'), 'authenticated cannot peek invitations');
select ok(has_function_privilege('app_server', 'app.peek_staff_invitation(bytea)', 'execute'), 'app_server may peek invitations');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('has_recent_mfa', 'replace_recovery_codes', 'consume_recovery_code',
                       'my_recovery_codes_status', 'peek_staff_invitation')
     and p.proconfig @> array['search_path=""']),
  5, 'new functions pin search_path to empty');

-- Recovery codes ------------------------------------------------------------------------
create function tests.as_user_mfa(p_sub uuid, p_mfa_age_seconds integer) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', 'aal2', 'session_id', gen_random_uuid(),
      'amr', json_build_array(json_build_object('method', 'totp',
        'timestamp', extract(epoch from now())::bigint - p_mfa_age_seconds)))::text, true);
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
end
$$;
grant execute on function tests.as_user_mfa(uuid, integer) to authenticated;

select tests.as_user('c0000000-0000-4000-8000-000000000003', 'aal2');
select ok(not app.has_recent_mfa(900), 'aal2 without amr: no recent MFA');
select throws_like(
  $$ select app.replace_recovery_codes(array['AAAAAAAAAAAAAAAA','BBBBBBBBBBBBBBBB','CCCCCCCCCCCCCCCC','DDDDDDDDDDDDDDDD','EEEEEEEEEEEEEEEE','FFFFFFFFFFFFFFFF','GGGGGGGGGGGGGGGG','HHHHHHHHHHHHHHHH','JJJJJJJJJJJJJJJJ','KKKKKKKKKKKKKKKK']) $$,
  '%recent_mfa_required%', 'replace requires recent MFA');

select tests.as_user_mfa('c0000000-0000-4000-8000-000000000003', 1200);
select ok(not app.has_recent_mfa(900), 'MFA 20 min ago is not recent');

select tests.as_user_mfa('c0000000-0000-4000-8000-000000000003', 10);
select ok(app.has_recent_mfa(900), 'MFA 10 s ago is recent');
select throws_like(
  $$ select app.replace_recovery_codes(array['AAAAAAAAAAAAAAAA']) $$,
  '%recovery_codes_invalid%', 'exactly 10 codes required');
select throws_like(
  $$ select app.replace_recovery_codes(array['AAAAAAAAAAAAAAA0','BBBBBBBBBBBBBBBB','CCCCCCCCCCCCCCCC','DDDDDDDDDDDDDDDD','EEEEEEEEEEEEEEEE','FFFFFFFFFFFFFFFF','GGGGGGGGGGGGGGGG','HHHHHHHHHHHHHHHH','JJJJJJJJJJJJJJJJ','KKKKKKKKKKKKKKKK']) $$,
  '%recovery_codes_invalid%', 'codes outside the alphabet are rejected');
select isnt(
  app.replace_recovery_codes(array['AAAAAAAAAAAAAAAA','BBBBBBBBBBBBBBBB','CCCCCCCCCCCCCCCC','DDDDDDDDDDDDDDDD','EEEEEEEEEEEEEEEE','FFFFFFFFFFFFFFFF','GGGGGGGGGGGGGGGG','HHHHHHHHHHHHHHHH','JJJJJJJJJJJJJJJJ','KKKKKKKKKKKKKKKK']),
  null, 'replace returns a batch id');
select is((select remaining from app.my_recovery_codes_status()), 10, 'status: 10 remaining');
select throws_ok($$ select count(*) from public.mfa_recovery_codes $$, '42501', null,
  'authenticated cannot read the hash table directly');

select is((select status from app.consume_recovery_code('aaaa-aaaa-aaaa-aaaa')), 'ok', 'valid code (normalized) is accepted');
select is((select remaining from app.my_recovery_codes_status()), 9, 'status: 9 remaining');

-- P1-05: the reset is pending until the server records `ok`; the same code resumes it.
select ok(not has_function_privilege('anon', 'app.finish_recovery_reset(text, integer)', 'execute'), 'anon cannot finish a reset');
select is((select status from app.consume_recovery_code('AAAAAAAAAAAAAAAA')), 'retry', 'a used code with a pending reset resumes it');
select throws_like($$ select app.finish_recovery_reset('maybe', 0) $$, '%invalid_reset_outcome%', 'unknown outcome rejected');
select is(app.finish_recovery_reset('partial', 1), 'pending', 'partial outcome keeps the reset pending');
select is((select status from app.consume_recovery_code('AAAAAAAAAAAAAAAA')), 'retry', 'still retryable after a partial reset');
select is(app.finish_recovery_reset('ok', 2), 'completed', 'ok completes the reset');
select is((select status from app.consume_recovery_code('AAAAAAAAAAAAAAAA')), 'invalid', 'a used code with a completed reset is rejected');
select throws_like($$ select app.finish_recovery_reset('ok', 0) $$, '%no_pending_reset%', 'nothing left to finish');
select is((select remaining from app.my_recovery_codes_status()), 9, 'retries do not consume other codes');

select tests.as_admin();
select ok(
  (select bool_and(code_hash like '$2a$10$%') from public.mfa_recovery_codes
   where profile_id = 'c0000000-0000-4000-8000-000000000003'),
  'codes are stored as bcrypt (cost 10) hashes only');
select is(
  (select count(*)::int from public.audit_logs
   where actor_profile_id = 'c0000000-0000-4000-8000-000000000003'
     and event_type in ('auth.recovery_codes_generated', 'auth.recovery_code_used', 'auth.mfa_failed')),
  3, 'generation, use and failed use are audited');
select is(
  (select array_agg(metadata->>'outcome' order by seq)::text from public.audit_logs
   where actor_profile_id = 'c0000000-0000-4000-8000-000000000003' and event_type = 'auth.mfa_reset'),
  '{started,started,partial,started,ok}', 'every reset step is audited with its outcome');
select is(
  (select (metadata->>'factors_removed')::int from public.audit_logs
   where actor_profile_id = 'c0000000-0000-4000-8000-000000000003' and event_type = 'auth.mfa_reset'
     and metadata->>'outcome' = 'ok'),
  2, 'the ok outcome records factors_removed');
select throws_like(
  $$ update public.mfa_recovery_codes set reset_status = 'pending' where reset_status = 'completed' $$,
  '%IMMUTABLE:mfa_recovery_codes%', 'a completed reset is final');

-- Invitation preview (system path only) ------------------------------------------------
select is(
  (select email from app.peek_staff_invitation(extensions.digest('test-token-x', 'sha256'))),
  'invitee.x@example.test', 'system path previews a pending invitation by token hash');

select * from finish();
rollback;
