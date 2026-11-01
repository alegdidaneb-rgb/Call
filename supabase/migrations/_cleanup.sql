-- Destructive teardown for the Open Cold Dialer schema.
--
-- Drops everything created by 001_init.sql, including the RLS policies,
-- triggers and helper functions. Run only against a database you intend to wipe.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON public.campaigns;
DROP TRIGGER IF EXISTS trg_leads_updated_at ON public.leads;
DROP TRIGGER IF EXISTS trg_call_scripts_updated_at ON public.call_scripts;
DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
DROP TRIGGER IF EXISTS trg_profiles_protect ON public.profiles;
DROP TRIGGER IF EXISTS trg_call_logs_owner ON public.call_logs;
DROP TRIGGER IF EXISTS trg_leads_created_by ON public.leads;
DROP TRIGGER IF EXISTS trg_campaigns_created_by ON public.campaigns;
DROP TRIGGER IF EXISTS trg_call_scripts_created_by ON public.call_scripts;

DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.protect_profile_fields() CASCADE;
DROP FUNCTION IF EXISTS public.normalize_call_log_owner() CASCADE;
DROP FUNCTION IF EXISTS public.normalize_created_by() CASCADE;

DROP TABLE IF EXISTS public.dnc_list CASCADE;
DROP TABLE IF EXISTS public.appointments CASCADE;
DROP TABLE IF EXISTS public.call_logs CASCADE;
DROP TABLE IF EXISTS public.call_scripts CASCADE;
DROP TABLE IF EXISTS public.leads CASCADE;
DROP TABLE IF EXISTS public.campaigns CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.is_privileged() CASCADE;
