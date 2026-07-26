-- =====================================================================
-- Start over: delete everything this app created.
-- =====================================================================
-- ⚠️ This erases all chores, approvals, balances and payout history.
--    There is no undo.
--
-- Run this, then run schema.sql (and optionally seed.sql) again.
--
-- Why not just `drop schema public cascade`? Because that also revokes the
-- anon role's USAGE on the schema, and Supabase does not restore it. The app
-- then fails with "relation does not exist" for everything, which is a
-- thoroughly confusing way to spend an evening. This drops the app's own
-- objects and leaves the schema and its grants alone.
-- =====================================================================

-- Notifications (only present if you ran notifications.sql)
drop trigger if exists chore_submitted_notify on chore_instances;
drop function if exists notify_parent_of_submission() cascade;
drop table if exists notification_log cascade;
drop table if exists private_config cascade;

-- Functions
drop function if exists child_balances() cascade;
drop function if exists unregister_push(text) cascade;
drop function if exists register_push(text, text, text, text, text) cascade;
drop function if exists rename_household(text, text) cascade;
drop function if exists update_settings(text, jsonb) cascade;
drop function if exists upsert_rotation_group(text, jsonb) cascade;
drop function if exists delete_assignment(text, uuid) cascade;
drop function if exists upsert_assignment(text, jsonb) cascade;
drop function if exists upsert_chore(text, jsonb) cascade;
drop function if exists upsert_child(text, jsonb) cascade;
drop function if exists adjust_balance(text, uuid, int, text) cascade;
drop function if exists record_payout(text, uuid, int, text) cascade;
drop function if exists approve_all(text, uuid) cascade;
drop function if exists reject_chore(text, uuid, text) cascade;
drop function if exists approve_chore(text, uuid) cascade;
drop function if exists unsubmit_chore(uuid) cascade;
drop function if exists submit_chore(uuid) cascade;
drop function if exists generate_week(date) cascade;
drop function if exists set_parent_pin(text, text) cascade;
drop function if exists parent_lock(text) cascade;
drop function if exists parent_unlock(text) cascade;
drop function if exists parent_status() cascade;
drop function if exists require_parent(text) cascade;
drop function if exists get_settings() cascade;
drop function if exists week_start_for(date) cascade;

-- View
drop view if exists household_public cascade;

-- Tables (order doesn't matter with cascade, but this reads top-down)
drop table if exists ledger_entries cascade;
drop table if exists chore_instances cascade;
drop table if exists assignments cascade;
drop table if exists rotation_groups cascade;
drop table if exists chores cascade;
drop table if exists children cascade;
drop table if exists parent_sessions cascade;
drop table if exists pin_attempts cascade;
drop table if exists push_subscriptions cascade;
drop table if exists household cascade;

-- Types
drop type if exists ledger_type cascade;
drop type if exists chore_status cascade;
drop type if exists schedule_type cascade;

-- The realtime publication survives; schema.sql re-adds its tables.
