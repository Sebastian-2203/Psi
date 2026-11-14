-- =============================================================================
-- Phase 2 QA D-2 / PRD PAT-06 — care-team notice before the age of majority.
-- app.majority_in_days: days until majority when 0 < days <= window, else null (adult, far away,
-- or jurisdiction not configured). The window is a server setting (MAJORITY_NOTICE_DAYS, default 60),
-- never a literal in SQL. It reads no row: callers pass columns they can already read through RLS.
-- The legal effect at majority (suspension, own consent) is unchanged. [NEEDS LEGAL VERIFICATION]
-- Forward-only.
-- =============================================================================
create function app.majority_in_days(p_date_of_birth date, p_country char(2), p_window integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select case when d > 0 and d <= p_window then d end
  from (select (app.majority_date(p_date_of_birth, p_country) - current_date) as d) x
$$;
comment on function app.majority_in_days(date, char, integer) is
  'PAT-06: days to majority when inside the notice window, else null.';
revoke all on function app.majority_in_days(date, char, integer) from public, anon, service_role;
grant execute on function app.majority_in_days(date, char, integer) to authenticated;
