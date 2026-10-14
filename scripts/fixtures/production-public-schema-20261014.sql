-- Schema-only production catalog snapshot, captured 2026-10-14. No customer rows.
-- Public application objects reproduced from live catalogs. Supabase Auth HTTP, cron scheduling, and vault service infrastructure are not supplied by this harness.
SET check_function_bodies = false;
CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
-- Roles are cluster-wide; the earlier smoke database may already have created them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
ALTER ROLE authenticated NOLOGIN NOBYPASSRLS; GRANT USAGE ON SCHEMA public,auth,extensions TO authenticated;
ALTER ROLE anon NOLOGIN NOBYPASSRLS; GRANT USAGE ON SCHEMA public,auth,extensions TO anon;
ALTER ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public,auth,extensions TO service_role;
CREATE TABLE auth.users (
"instance_id" uuid,
"id" uuid NOT NULL,
"aud" character varying(255),
"role" character varying(255),
"email" character varying(255),
"encrypted_password" character varying(255),
"email_confirmed_at" timestamp with time zone,
"invited_at" timestamp with time zone,
"confirmation_token" character varying(255),
"confirmation_sent_at" timestamp with time zone,
"recovery_token" character varying(255),
"recovery_sent_at" timestamp with time zone,
"email_change_token_new" character varying(255),
"email_change" character varying(255),
"email_change_sent_at" timestamp with time zone,
"last_sign_in_at" timestamp with time zone,
"raw_app_meta_data" jsonb,
"raw_user_meta_data" jsonb,
"is_super_admin" boolean,
"created_at" timestamp with time zone,
"updated_at" timestamp with time zone,
"phone" text DEFAULT NULL::character varying,
"phone_confirmed_at" timestamp with time zone,
"phone_change" text DEFAULT ''::character varying,
"phone_change_token" character varying(255) DEFAULT ''::character varying,
"phone_change_sent_at" timestamp with time zone,
"confirmed_at" timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
"email_change_token_current" character varying(255) DEFAULT ''::character varying,
"email_change_confirm_status" smallint DEFAULT 0,
"banned_until" timestamp with time zone,
"reauthentication_token" character varying(255) DEFAULT ''::character varying,
"reauthentication_sent_at" timestamp with time zone,
"is_sso_user" boolean DEFAULT false NOT NULL,
"deleted_at" timestamp with time zone,
"is_anonymous" boolean DEFAULT false NOT NULL,
PRIMARY KEY(id)
);
CREATE OR REPLACE FUNCTION auth.email()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$function$
;
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$
;
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$
;
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
;
CREATE TABLE public."customers" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"external_id" text,
"first_name" text,
"last_name" text,
"phone" text,
"email" text,
"notes" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."follow_ups" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"customer_id" uuid,
"opportunity_id" uuid,
"channel" text NOT NULL,
"status" text DEFAULT 'pending'::text NOT NULL,
"scheduled_at" timestamp with time zone,
"completed_at" timestamp with time zone,
"message" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."recovery_events" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"opportunity_id" uuid,
"customer_id" uuid,
"amount" numeric(12,2) NOT NULL,
"source" text,
"note" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."audit_events" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"actor_user_id" uuid,
"entity_type" text NOT NULL,
"entity_id" uuid,
"action" text NOT NULL,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."workspace_members" (
"workspace_id" uuid NOT NULL,
"user_id" uuid NOT NULL,
"role" text DEFAULT 'owner'::text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."opportunities" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"customer_id" uuid,
"source" text NOT NULL,
"title" text NOT NULL,
"reason" text,
"amount" numeric(12,2) DEFAULT 0 NOT NULL,
"priority" numeric(12,2) DEFAULT 0 NOT NULL,
"status" text DEFAULT 'open'::text NOT NULL,
"due_at" timestamp with time zone,
"recovered_amount" numeric(12,2) DEFAULT 0 NOT NULL,
"recovered_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."workspaces" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"name" text NOT NULL,
"slug" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"owner_user_id" uuid
);
CREATE TABLE public."contacts" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"customer_id" uuid NOT NULL,
"first_name" text,
"last_name" text,
"phone" text,
"email" text,
"role" text,
"notes" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."appointments" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"customer_id" uuid,
"opportunity_id" uuid,
"title" text NOT NULL,
"starts_at" timestamp with time zone NOT NULL,
"ends_at" timestamp with time zone,
"status" text DEFAULT 'scheduled'::text NOT NULL,
"notes" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."workflow_events" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"event_type" text NOT NULL,
"entity_type" text NOT NULL,
"entity_id" uuid,
"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"processed_at" timestamp with time zone
);
CREATE TABLE public."workflow_runs" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"workflow_id" uuid NOT NULL,
"trigger_event_id" uuid,
"status" text DEFAULT 'queued'::text NOT NULL,
"idempotency_key" text NOT NULL,
"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
"error" text,
"started_at" timestamp with time zone,
"completed_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"approved_by" uuid
);
CREATE TABLE public."workflows" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"name" text NOT NULL,
"description" text,
"enabled" boolean DEFAULT true NOT NULL,
"mode" text DEFAULT 'manual'::text NOT NULL,
"trigger_type" text NOT NULL,
"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."activity_events" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"actor_user_id" uuid,
"entity_type" text NOT NULL,
"entity_id" uuid,
"event_type" text NOT NULL,
"title" text NOT NULL,
"body" text,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."workspace_usage" (
"workspace_id" uuid NOT NULL,
"period_start" date NOT NULL,
"metric" text NOT NULL,
"quantity" bigint DEFAULT 0 NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."stripe_webhook_events" (
"event_id" text NOT NULL,
"event_type" text NOT NULL,
"livemode" boolean DEFAULT false NOT NULL,
"received_at" timestamp with time zone DEFAULT now() NOT NULL,
"processed_at" timestamp with time zone,
"processing_error" text
);
CREATE TABLE public."workspace_records" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"record_type" text NOT NULL,
"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"record_key" text DEFAULT ''::text NOT NULL
);
CREATE TABLE public."workspace_settings" (
"workspace_id" uuid NOT NULL,
"business_type" text DEFAULT 'Other Small Business'::text NOT NULL,
"timezone" text DEFAULT 'America/New_York'::text NOT NULL,
"onboarding_completed" boolean DEFAULT false NOT NULL,
"onboarding_completed_at" timestamp with time zone,
"currency" text DEFAULT 'USD'::text NOT NULL,
"locale" text DEFAULT 'en-US'::text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."quickbooks_connections" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"realm_id" text,
"status" text DEFAULT 'disconnected'::text NOT NULL,
"last_sync_at" timestamp with time zone,
"last_sync_count" integer DEFAULT 0 NOT NULL,
"last_error" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."workspace_subscriptions" (
"workspace_id" uuid NOT NULL,
"provider" text DEFAULT 'stripe'::text NOT NULL,
"provider_customer_id" text,
"provider_subscription_id" text,
"plan_key" text DEFAULT 'trial'::text NOT NULL,
"status" text DEFAULT 'trialing'::text NOT NULL,
"current_period_start" timestamp with time zone,
"current_period_end" timestamp with time zone,
"trial_ends_at" timestamp with time zone,
"cancel_at_period_end" boolean DEFAULT false NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."tasks" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"customer_id" uuid,
"opportunity_id" uuid,
"title" text NOT NULL,
"status" text DEFAULT 'open'::text NOT NULL,
"due_at" timestamp with time zone,
"priority" numeric DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."documents" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"customer_id" uuid,
"opportunity_id" uuid,
"document_type" text NOT NULL,
"document_number" text,
"status" text DEFAULT 'draft'::text NOT NULL,
"total" numeric DEFAULT 0 NOT NULL,
"due_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."loose_ends" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"workspace_id" uuid NOT NULL,
"customer_id" uuid,
"opportunity_id" uuid,
"source_entity" text NOT NULL,
"source_id" uuid,
"reason" text NOT NULL,
"amount" numeric DEFAULT 0 NOT NULL,
"score" numeric DEFAULT 0 NOT NULL,
"priority" text DEFAULT 'medium'::text NOT NULL,
"recommended_action" text,
"due_at" timestamp with time zone,
"status" text DEFAULT 'open'::text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"next_action_at" timestamp with time zone,
"recovery_stage" text DEFAULT 'identified'::text NOT NULL,
"confidence_score" numeric DEFAULT 50 NOT NULL,
"recovered_amount" numeric DEFAULT 0 NOT NULL,
"last_action_at" timestamp with time zone,
"last_action" text
);
CREATE TABLE public."public_leads" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"name" text NOT NULL,
"business" text NOT NULL,
"phone" text NOT NULL,
"email" text NOT NULL,
"business_type" text,
"biggest_problem" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."customers" ADD CONSTRAINT "customers_pkey" PRIMARY KEY (id);
ALTER TABLE public."follow_ups" ADD CONSTRAINT "follow_ups_channel_check" CHECK (channel = ANY (ARRAY['call'::text, 'sms'::text, 'email'::text, 'task'::text]));
ALTER TABLE public."follow_ups" ADD CONSTRAINT "follow_ups_pkey" PRIMARY KEY (id);
ALTER TABLE public."follow_ups" ADD CONSTRAINT "follow_ups_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'dismissed'::text]));
ALTER TABLE public."recovery_events" ADD CONSTRAINT "recovery_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."audit_events" ADD CONSTRAINT "audit_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."workspace_members" ADD CONSTRAINT "workspace_members_pkey" PRIMARY KEY (workspace_id, user_id);
ALTER TABLE public."workspace_members" ADD CONSTRAINT "workspace_members_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]));
ALTER TABLE public."opportunities" ADD CONSTRAINT "opportunities_pkey" PRIMARY KEY (id);
ALTER TABLE public."opportunities" ADD CONSTRAINT "opportunities_status_check" CHECK (status = ANY (ARRAY['open'::text, 'contacted'::text, 'responded'::text, 'scheduled'::text, 'completed'::text, 'recovered'::text, 'dismissed'::text]));
ALTER TABLE public."workspaces" ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY (id);
ALTER TABLE public."workspaces" ADD CONSTRAINT "workspaces_slug_key" UNIQUE (slug);
ALTER TABLE public."contacts" ADD CONSTRAINT "contacts_pkey" PRIMARY KEY (id);
ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_pkey" PRIMARY KEY (id);
ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_status_check" CHECK (status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text]));
ALTER TABLE public."workflow_events" ADD CONSTRAINT "workflow_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."workflow_runs" ADD CONSTRAINT "workflow_runs_pkey" PRIMARY KEY (id);
ALTER TABLE public."workflow_runs" ADD CONSTRAINT "workflow_runs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'waiting_approval'::text, 'completed'::text, 'failed'::text, 'skipped'::text]));
ALTER TABLE public."workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_idempotency_key_key" UNIQUE (workflow_id, idempotency_key);
ALTER TABLE public."workflows" ADD CONSTRAINT "workflows_mode_check" CHECK (mode = ANY (ARRAY['manual'::text, 'automatic'::text, 'approval'::text]));
ALTER TABLE public."workflows" ADD CONSTRAINT "workflows_pkey" PRIMARY KEY (id);
ALTER TABLE public."workflows" ADD CONSTRAINT "workflows_trigger_type_check" CHECK (trigger_type = ANY (ARRAY['record_created'::text, 'record_updated'::text, 'record_due'::text, 'manual'::text, 'schedule'::text]));
ALTER TABLE public."activity_events" ADD CONSTRAINT "activity_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."workspace_usage" ADD CONSTRAINT "workspace_usage_pkey" PRIMARY KEY (workspace_id, period_start, metric);
ALTER TABLE public."stripe_webhook_events" ADD CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY (event_id);
ALTER TABLE public."workspace_records" ADD CONSTRAINT "workspace_records_pkey" PRIMARY KEY (id);
ALTER TABLE public."workspace_settings" ADD CONSTRAINT "workspace_settings_pkey" PRIMARY KEY (workspace_id);
ALTER TABLE public."quickbooks_connections" ADD CONSTRAINT "quickbooks_connections_pkey" PRIMARY KEY (id);
ALTER TABLE public."quickbooks_connections" ADD CONSTRAINT "quickbooks_connections_status_check" CHECK (status = ANY (ARRAY['disconnected'::text, 'connected'::text, 'error'::text]));
ALTER TABLE public."quickbooks_connections" ADD CONSTRAINT "quickbooks_connections_workspace_id_key" UNIQUE (workspace_id);
ALTER TABLE public."workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_pkey" PRIMARY KEY (workspace_id);
ALTER TABLE public."workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_status_check" CHECK (status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'incomplete'::text, 'paused'::text, 'unpaid'::text]));
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_pkey" PRIMARY KEY (id);
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_status_check" CHECK (status = ANY (ARRAY['open'::text, 'done'::text, 'dismissed'::text]));
ALTER TABLE public."documents" ADD CONSTRAINT "documents_document_type_check" CHECK (document_type = ANY (ARRAY['quote'::text, 'order'::text, 'purchase_order'::text, 'invoice'::text, 'payment'::text]));
ALTER TABLE public."documents" ADD CONSTRAINT "documents_pkey" PRIMARY KEY (id);
ALTER TABLE public."loose_ends" ADD CONSTRAINT "loose_ends_pkey" PRIMARY KEY (id);
ALTER TABLE public."loose_ends" ADD CONSTRAINT "loose_ends_priority_check" CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]));
ALTER TABLE public."loose_ends" ADD CONSTRAINT "loose_ends_recovery_stage_check" CHECK (recovery_stage = ANY (ARRAY['identified'::text, 'actioned'::text, 'engaged'::text, 'converted'::text, 'collected'::text]));
ALTER TABLE public."loose_ends" ADD CONSTRAINT "loose_ends_status_check" CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'recovered'::text, 'dismissed'::text]));
ALTER TABLE public."public_leads" ADD CONSTRAINT "public_leads_pkey" PRIMARY KEY (id);
ALTER TABLE public."customers" ADD CONSTRAINT "customers_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."follow_ups" ADD CONSTRAINT "follow_ups_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public."follow_ups" ADD CONSTRAINT "follow_ups_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;
ALTER TABLE public."follow_ups" ADD CONSTRAINT "follow_ups_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."recovery_events" ADD CONSTRAINT "recovery_events_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public."recovery_events" ADD CONSTRAINT "recovery_events_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;
ALTER TABLE public."recovery_events" ADD CONSTRAINT "recovery_events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."opportunities" ADD CONSTRAINT "opportunities_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public."opportunities" ADD CONSTRAINT "opportunities_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."workspaces" ADD CONSTRAINT "workspaces_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id);
ALTER TABLE public."contacts" ADD CONSTRAINT "contacts_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public."contacts" ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;
ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."workflow_events" ADD CONSTRAINT "workflow_events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."workflow_runs" ADD CONSTRAINT "workflow_runs_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_fkey" FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE;
ALTER TABLE public."workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."workflows" ADD CONSTRAINT "workflows_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."activity_events" ADD CONSTRAINT "activity_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."activity_events" ADD CONSTRAINT "activity_events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."workspace_usage" ADD CONSTRAINT "workspace_usage_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."workspace_records" ADD CONSTRAINT "workspace_records_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."quickbooks_connections" ADD CONSTRAINT "quickbooks_connections_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."documents" ADD CONSTRAINT "documents_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public."documents" ADD CONSTRAINT "documents_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;
ALTER TABLE public."documents" ADD CONSTRAINT "documents_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public."loose_ends" ADD CONSTRAINT "loose_ends_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public."loose_ends" ADD CONSTRAINT "loose_ends_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;
ALTER TABLE public."loose_ends" ADD CONSTRAINT "loose_ends_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX customers_workspace_idx ON public.customers USING btree (workspace_id);
CREATE INDEX customers_workspace_email_idx ON public.customers USING btree (workspace_id, email) WHERE (email IS NOT NULL);
CREATE INDEX customers_workspace_phone_idx ON public.customers USING btree (workspace_id, phone) WHERE (phone IS NOT NULL);
CREATE INDEX follow_ups_workspace_scheduled_idx ON public.follow_ups USING btree (workspace_id, scheduled_at);
CREATE INDEX follow_ups_customer_idx ON public.follow_ups USING btree (customer_id);
CREATE INDEX follow_ups_opportunity_idx ON public.follow_ups USING btree (opportunity_id);
CREATE INDEX follow_ups_workspace_status_scheduled_idx ON public.follow_ups USING btree (workspace_id, status, scheduled_at);
CREATE INDEX recovery_events_workspace_created_idx ON public.recovery_events USING btree (workspace_id, created_at DESC);
CREATE INDEX recovery_events_customer_idx ON public.recovery_events USING btree (customer_id);
CREATE INDEX recovery_events_opportunity_idx ON public.recovery_events USING btree (opportunity_id);
CREATE INDEX audit_events_workspace_created_idx ON public.audit_events USING btree (workspace_id, created_at DESC);
CREATE INDEX audit_events_actor_user_idx ON public.audit_events USING btree (actor_user_id);
CREATE INDEX workspace_members_user_idx ON public.workspace_members USING btree (user_id);
CREATE INDEX opportunities_workspace_status_idx ON public.opportunities USING btree (workspace_id, status);
CREATE INDEX opportunities_workspace_amount_idx ON public.opportunities USING btree (workspace_id, amount DESC);
CREATE INDEX opportunities_customer_idx ON public.opportunities USING btree (customer_id);
CREATE INDEX opportunities_workspace_status_amount_idx ON public.opportunities USING btree (workspace_id, status, amount DESC);
CREATE INDEX opportunities_workspace_due_idx ON public.opportunities USING btree (workspace_id, due_at) WHERE (due_at IS NOT NULL);
CREATE INDEX workspaces_owner_user_idx ON public.workspaces USING btree (owner_user_id);
CREATE INDEX contacts_workspace_customer_idx ON public.contacts USING btree (workspace_id, customer_id);
CREATE INDEX contacts_customer_idx ON public.contacts USING btree (customer_id);
CREATE INDEX appointments_workspace_start_idx ON public.appointments USING btree (workspace_id, starts_at);
CREATE INDEX appointments_customer_idx ON public.appointments USING btree (customer_id);
CREATE INDEX appointments_opportunity_idx ON public.appointments USING btree (opportunity_id) WHERE (opportunity_id IS NOT NULL);
CREATE INDEX workflow_events_workspace_idx ON public.workflow_events USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_workflow_events_schedule_lookup ON public.workflow_events USING btree (workspace_id, event_type, created_at DESC);
CREATE INDEX workflow_events_unprocessed_idx ON public.workflow_events USING btree (workspace_id, created_at) WHERE (processed_at IS NULL);
CREATE INDEX workflow_runs_workspace_idx ON public.workflow_runs USING btree (workspace_id, created_at DESC);
CREATE INDEX workflow_runs_approved_by_idx ON public.workflow_runs USING btree (approved_by);
CREATE INDEX workflows_workspace_idx ON public.workflows USING btree (workspace_id, enabled);
CREATE INDEX idx_activity_events_workspace_created ON public.activity_events USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_activity_events_actor ON public.activity_events USING btree (actor_user_id);
CREATE INDEX idx_workspace_usage_period ON public.workspace_usage USING btree (workspace_id, period_start DESC);
CREATE INDEX workspace_records_workspace_type_idx ON public.workspace_records USING btree (workspace_id, record_type);
CREATE UNIQUE INDEX workspace_records_workspace_type_key_idx ON public.workspace_records USING btree (workspace_id, record_type, record_key);
CREATE INDEX quickbooks_connections_workspace_idx ON public.quickbooks_connections USING btree (workspace_id);
CREATE UNIQUE INDEX uq_workspace_subscriptions_provider_sub ON public.workspace_subscriptions USING btree (provider, provider_subscription_id) WHERE (provider_subscription_id IS NOT NULL);
CREATE INDEX tasks_workspace_due_idx ON public.tasks USING btree (workspace_id, status, due_at);
CREATE INDEX tasks_customer_idx ON public.tasks USING btree (customer_id);
CREATE INDEX tasks_opportunity_idx ON public.tasks USING btree (opportunity_id) WHERE (opportunity_id IS NOT NULL);
CREATE INDEX documents_workspace_type_idx ON public.documents USING btree (workspace_id, document_type, status);
CREATE INDEX documents_customer_idx ON public.documents USING btree (customer_id);
CREATE INDEX documents_opportunity_idx ON public.documents USING btree (opportunity_id) WHERE (opportunity_id IS NOT NULL);
CREATE INDEX idx_documents_due_workspace ON public.documents USING btree (workspace_id, due_at) WHERE (due_at IS NOT NULL);
CREATE INDEX loose_ends_workspace_status_score_idx ON public.loose_ends USING btree (workspace_id, status, score DESC);
CREATE INDEX loose_ends_customer_idx ON public.loose_ends USING btree (customer_id);
CREATE UNIQUE INDEX loose_ends_open_source_idx ON public.loose_ends USING btree (workspace_id, source_entity, source_id) WHERE (status = ANY (ARRAY['open'::text, 'in_progress'::text]));
CREATE INDEX loose_ends_queue_idx ON public.loose_ends USING btree (workspace_id, status, next_action_at, score);
CREATE INDEX loose_ends_stage_idx ON public.loose_ends USING btree (workspace_id, recovery_stage);
CREATE INDEX loose_ends_opportunity_idx ON public.loose_ends USING btree (opportunity_id) WHERE (opportunity_id IS NOT NULL);
CREATE INDEX loose_ends_workspace_queue_idx ON public.loose_ends USING btree (workspace_id, status, priority, score DESC, next_action_at) WHERE (status = ANY (ARRAY['open'::text, 'in_progress'::text]));
CREATE INDEX public_leads_created_at_idx ON public.public_leads USING btree (created_at DESC);
CREATE INDEX public_leads_email_created_at_idx ON public.public_leads USING btree (lower(btrim(email)), created_at DESC);
CREATE INDEX public_leads_phone_created_at_idx ON public.public_leads USING btree (regexp_replace(phone, '[^0-9]'::text, ''::text, 'g'::text), created_at DESC);
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$select exists (select 1 from public.workspace_members wm where wm.workspace_id = p_workspace_id and wm.user_id = (select auth.uid()));$function$
;
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$begin new.updated_at=now(); return new; end;$function$
;
CREATE OR REPLACE FUNCTION public.revenue_recovery_summary(p_workspace_id uuid)
 RETURNS TABLE(open_amount numeric, open_count bigint, contacted_amount numeric, scheduled_amount numeric, recovered_amount numeric, recovered_count bigint, recovery_rate numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    coalesce(sum(amount) filter (where status in ('open','contacted','scheduled')),0),
    count(*) filter (where status in ('open','contacted','scheduled')),
    coalesce(sum(amount) filter (where status='contacted'),0),
    coalesce(sum(amount) filter (where status='scheduled'),0),
    coalesce(sum(coalesce(recovered_amount,0)) filter (where status='recovered'),0),
    count(*) filter (where status='recovered'),
    case when coalesce(sum(amount),0)=0 then 0 else round((coalesce(sum(coalesce(recovered_amount,0)) filter (where status='recovered'),0) / nullif(sum(amount),0))*100,1) end
  from public.opportunities
  where workspace_id=p_workspace_id;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_loose_end_recovered(p_loose_end_id uuid, p_amount numeric DEFAULT NULL::numeric, p_note text DEFAULT 'Recovered from Loose Ends'::text)
 RETURNS loose_ends
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare le public.loose_ends; amt numeric;
begin
 select * into le from public.loose_ends where id=p_loose_end_id and is_workspace_member(workspace_id) for update;
 if not found then raise exception 'Loose End not found or access denied'; end if;
 if le.status='recovered' then return le; end if;
 amt=coalesce(p_amount,le.amount,0);
 update public.loose_ends set status='recovered', updated_at=now() where id=le.id returning * into le;
 insert into public.recovery_events(workspace_id,opportunity_id,customer_id,amount,source,note) values(le.workspace_id,le.opportunity_id,le.customer_id,amt,'loose_end',coalesce(p_note,le.reason));
 if le.opportunity_id is not null then update public.opportunities set recovered_amount=coalesce(recovered_amount,0)+amt,recovered_at=now(),status='recovered',updated_at=now() where id=le.opportunity_id and workspace_id=le.workspace_id; end if;
 return le;
end; $function$
;
CREATE OR REPLACE FUNCTION public.run_scheduled_and_due_workflows()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare wf record; rec record; ev_id uuid; run_id uuid; idem text; record_json jsonb; entity text; due_field text; interval_minutes integer; last_schedule timestamptz; action jsonb; patch jsonb; inserted_count integer:=0; executed_count integer:=0; now_ts timestamptz:=now();
begin
  for wf in select * from public.workflows where enabled=true and trigger_type='schedule' loop
    interval_minutes:=greatest(1,coalesce((wf.trigger_config->>'interval_minutes')::integer,60));
    select max(created_at) into last_schedule from public.workflow_events where workspace_id=wf.workspace_id and event_type='schedule' and payload->>'workflow_id'=wf.id::text;
    if last_schedule is null or last_schedule <= now_ts-make_interval(mins=>interval_minutes) then
      insert into public.workflow_events(workspace_id,event_type,entity_type,entity_id,payload) values(wf.workspace_id,'schedule','workflow',wf.id,jsonb_build_object('workflow_id',wf.id,'record',jsonb_build_object())) returning id into ev_id;
      inserted_count:=inserted_count+1;
      if wf.mode='automatic' then
        idem:=ev_id::text||':'||wf.id::text;
        insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,'running',idem,jsonb_build_object('event_id',ev_id,'record',jsonb_build_object()),now_ts) on conflict(workflow_id,idempotency_key) do nothing returning id into run_id;
        if run_id is not null then
          for action in select value from jsonb_array_elements(coalesce(wf.actions,'[]'::jsonb)) loop
            if action->>'type'='create_task' then insert into public.tasks(workspace_id,title,status,priority,due_at) values(wf.workspace_id,coalesce(action->>'title','Workflow task'),'open',coalesce((action->>'priority')::numeric,1),now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)));
            elsif action->>'type'='create_follow_up' then insert into public.follow_ups(workspace_id,channel,status,scheduled_at,message) values(wf.workspace_id,coalesce(action->>'channel','task'),'pending',now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)),coalesce(action->>'message','Workflow follow-up'));
            end if;
          end loop;
          update public.workflow_runs set status='completed',result=jsonb_build_object('background',true),completed_at=now() where id=run_id; executed_count:=executed_count+1;
        end if;
      else
        insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,'waiting_approval',ev_id::text||':'||wf.id::text,jsonb_build_object('event_id',ev_id,'record',jsonb_build_object()),now_ts) on conflict(workflow_id,idempotency_key) do nothing;
      end if;
    end if;
  end loop;

  for wf in select * from public.workflows where enabled=true and trigger_type='record_due' loop
    entity:=coalesce(wf.trigger_config->>'entity_type','opportunities'); due_field:=coalesce(wf.trigger_config->>'due_field','due_at');
    if entity='opportunities' and due_field='due_at' then
      for rec in select * from public.opportunities where workspace_id=wf.workspace_id and due_at is not null and due_at<=now_ts and due_at<=now_ts loop
        record_json:=to_jsonb(rec); if not public.workflow_conditions_match(record_json,wf.conditions) then continue; end if;
        if exists(select 1 from public.workflow_events e where e.workspace_id=wf.workspace_id and e.entity_type='opportunities' and e.entity_id=rec.id and e.event_type='due' and e.payload->>'workflow_id'=wf.id::text) then continue; end if;
        idem:=wf.id::text||':due:'||rec.id::text||':'||to_char(rec.due_at at time zone 'UTC','YYYYMMDDHH24MI');
        insert into public.workflow_events(workspace_id,event_type,entity_type,entity_id,payload) values(wf.workspace_id,'due','opportunities',rec.id,jsonb_build_object('record',record_json,'workflow_id',wf.id)) returning id into ev_id; inserted_count:=inserted_count+1;
        if wf.mode='automatic' then
          insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,'running',idem,jsonb_build_object('event_id',ev_id,'record',record_json),now_ts) on conflict(workflow_id,idempotency_key) do nothing returning id into run_id;
          if run_id is not null then
            for action in select value from jsonb_array_elements(coalesce(wf.actions,'[]'::jsonb)) loop
              if action->>'type'='create_task' then insert into public.tasks(workspace_id,customer_id,opportunity_id,title,status,priority,due_at) values(wf.workspace_id,rec.customer_id,rec.id,coalesce(action->>'title','Follow up on due opportunity'),'open',coalesce((action->>'priority')::numeric,1),now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)));
              elsif action->>'type'='create_follow_up' then insert into public.follow_ups(workspace_id,customer_id,opportunity_id,channel,status,scheduled_at,message) values(wf.workspace_id,rec.customer_id,rec.id,coalesce(action->>'channel','task'),'pending',now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)),coalesce(action->>'message','Workflow follow-up'));
              elsif action->>'type'='update_opportunity' then patch:=coalesce(action->'patch','{}'::jsonb); update public.opportunities set title=coalesce(patch->>'title',title),reason=coalesce(patch->>'reason',reason),status=coalesce(patch->>'status',status),priority=coalesce((patch->>'priority')::numeric,priority),amount=coalesce((patch->>'amount')::numeric,amount),due_at=coalesce((patch->>'due_at')::timestamptz,due_at),updated_at=now() where id=rec.id and workspace_id=wf.workspace_id;
              end if;
            end loop;
            update public.workflow_runs set status='completed',result=jsonb_build_object('background',true),completed_at=now() where id=run_id; executed_count:=executed_count+1;
          end if;
        else
          insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,'waiting_approval',idem,jsonb_build_object('event_id',ev_id,'record',record_json),now_ts) on conflict(workflow_id,idempotency_key) do nothing;
        end if;
      end loop;
    elsif entity='documents' and due_field='due_at' then
      for rec in select * from public.documents where workspace_id=wf.workspace_id and due_at is not null and due_at<=now_ts and due_at<=now_ts loop
        record_json:=to_jsonb(rec); if not public.workflow_conditions_match(record_json,wf.conditions) then continue; end if;
        if exists(select 1 from public.workflow_events e where e.workspace_id=wf.workspace_id and e.entity_type='documents' and e.entity_id=rec.id and e.event_type='due' and e.payload->>'workflow_id'=wf.id::text) then continue; end if;
        idem:=wf.id::text||':due:'||rec.id::text||':'||to_char(rec.due_at at time zone 'UTC','YYYYMMDDHH24MI');
        insert into public.workflow_events(workspace_id,event_type,entity_type,entity_id,payload) values(wf.workspace_id,'due','documents',rec.id,jsonb_build_object('record',record_json,'workflow_id',wf.id)) returning id into ev_id; inserted_count:=inserted_count+1;
        insert into public.workflow_runs(workspace_id,workflow_id,trigger_event_id,status,idempotency_key,context,started_at) values(wf.workspace_id,wf.id,ev_id,case when wf.mode='automatic' then 'completed' else 'waiting_approval' end,idem,jsonb_build_object('event_id',ev_id,'record',record_json),now_ts) on conflict(workflow_id,idempotency_key) do nothing returning id into run_id;
        if run_id is not null and wf.mode='automatic' then
          for action in select value from jsonb_array_elements(coalesce(wf.actions,'[]'::jsonb)) loop
            if action->>'type'='create_task' then insert into public.tasks(workspace_id,customer_id,opportunity_id,title,status,priority,due_at) values(wf.workspace_id,rec.customer_id,rec.opportunity_id,coalesce(action->>'title','Review due document'),'open',coalesce((action->>'priority')::numeric,1),now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)));
            elsif action->>'type'='create_follow_up' then insert into public.follow_ups(workspace_id,customer_id,opportunity_id,channel,status,scheduled_at,message) values(wf.workspace_id,rec.customer_id,rec.opportunity_id,coalesce(action->>'channel','task'),'pending',now_ts+make_interval(hours=>coalesce((action->>'delay_hours')::integer,0)),coalesce(action->>'message','Workflow follow-up'));
            end if;
          end loop;
          update public.workflow_runs set result=jsonb_build_object('background',true),completed_at=now() where id=run_id; executed_count:=executed_count+1;
        end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('scheduled_or_due_events',inserted_count,'executed_runs',executed_count,'ran_at',now_ts);
end $function$
;
CREATE OR REPLACE FUNCTION public.workflow_conditions_match(record jsonb, conditions jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  condition jsonb;
  actual jsonb;
  expected text;
  op text;
begin
  if conditions is null or jsonb_typeof(conditions) <> 'array' or jsonb_array_length(conditions) = 0 then
    return true;
  end if;

  for condition in select value from jsonb_array_elements(conditions)
  loop
    actual := record -> (condition ->> 'field');
    op := coalesce(condition ->> 'operator', 'equals');
    expected := condition ->> 'value';

    if op = 'exists' then
      if not (actual is not null and actual <> 'null'::jsonb) then return false; end if;
    elsif op = 'equals' then
      if coalesce(actual #>> '{}', '') <> coalesce(expected, '') then return false; end if;
    elsif op = 'not_equals' then
      if coalesce(actual #>> '{}', '') = coalesce(expected, '') then return false; end if;
    elsif op = 'contains' then
      if position(lower(coalesce(expected, '')) in lower(coalesce(actual #>> '{}', ''))) = 0 then return false; end if;
    elsif op in ('gt','gte','lt','lte') then
      if not (coalesce(actual #>> '{}','') ~ '^-?[0-9]+(\.[0-9]+)?$' and coalesce(expected,'') ~ '^-?[0-9]+(\.[0-9]+)?$') then return false; end if;
      if op = 'gt' and not ((actual #>> '{}')::numeric > expected::numeric) then return false; end if;
      if op = 'gte' and not ((actual #>> '{}')::numeric >= expected::numeric) then return false; end if;
      if op = 'lt' and not ((actual #>> '{}')::numeric < expected::numeric) then return false; end if;
      if op = 'lte' and not ((actual #>> '{}')::numeric <= expected::numeric) then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_or_create_workspace_settings(p_workspace_id uuid)
 RETURNS workspace_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.workspace_settings;
begin
  if not exists (select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid()) then
    raise exception 'not authorized';
  end if;
  insert into public.workspace_settings(workspace_id) values(p_workspace_id) on conflict (workspace_id) do nothing;
  select * into r from public.workspace_settings where workspace_id=p_workspace_id;
  return r;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ begin new.updated_at=now(); return new; end; $function$
;
CREATE OR REPLACE FUNCTION public.record_usage(p_workspace_id uuid, p_metric text, p_quantity bigint DEFAULT 1)
 RETURNS workspace_usage
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.workspace_usage;
begin
  if not exists (select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid()) then
    raise exception 'not authorized';
  end if;
  insert into public.workspace_usage(workspace_id,period_start,metric,quantity)
  values(p_workspace_id,date_trunc('month',now())::date,p_metric,greatest(p_quantity,0))
  on conflict (workspace_id,period_start,metric) do update set quantity=workspace_usage.quantity+greatest(p_quantity,0),updated_at=now();
  select * into r from public.workspace_usage where workspace_id=p_workspace_id and period_start=date_trunc('month',now())::date and metric=p_metric;
  return r;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.initialize_workspace_saas_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.workspace_settings(workspace_id,business_type)
  values(new.id,'Other Small Business')
  on conflict (workspace_id) do nothing;

  insert into public.workspace_subscriptions(workspace_id,plan_key,status,trial_ends_at,current_period_start,current_period_end)
  values(new.id,'trial','trialing',now()+interval '14 days',now(),now()+interval '14 days')
  on conflict (workspace_id) do nothing;

  insert into public.workflows(workspace_id,name,description,enabled,mode,trigger_type,trigger_config,conditions,actions)
  values
    (new.id,'Follow up on open opportunities','Queue a human-reviewed follow-up when a new open opportunity is created.',true,'approval','record_created',jsonb_build_object('entity_type','opportunities'),jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','open')),jsonb_build_array(jsonb_build_object('type','create_follow_up','channel','task','message','Review and follow up on this open opportunity.','delay_hours',0))),
    (new.id,'Welcome new customers','Create a welcome task when a new customer is added.',true,'automatic','record_created',jsonb_build_object('entity_type','customers'),'[]'::jsonb,jsonb_build_array(jsonb_build_object('type','create_task','title','Welcome new customer','priority',1,'delay_hours',0))),
    (new.id,'Appointment follow-up','Create a task 24 hours after an appointment is marked completed.',true,'approval','record_updated',jsonb_build_object('entity_type','appointments'),jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','completed')),jsonb_build_array(jsonb_build_object('type','create_task','title','Follow up after completed appointment','priority',2,'delay_hours',24))),
    (new.id,'Overdue invoice alert','Create a task when an invoice is marked overdue.',true,'approval','record_updated',jsonb_build_object('entity_type','documents'),jsonb_build_array(jsonb_build_object('field','status','operator','equals','value','overdue')),jsonb_build_array(jsonb_build_object('type','create_task','title','Follow up on overdue invoice','priority',3,'delay_hours',0)))
  on conflict do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.process_record_workflow_events()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ev record;
  wf record;
  act jsonb;
  rec jsonb;
  run_id uuid;
  customer_id uuid;
  opportunity_id uuid;
  idem text;
  outputs jsonb;
  patch jsonb;
  action_count integer := 0;
  run_count integer := 0;
  failure_count integer := 0;
  event_failed boolean;
  error_message text;
begin
  for ev in
    select e.*
    from public.workflow_events e
    where e.processed_at is null
      and e.event_type ~ '^(insert|update):'
      and e.entity_type in ('customers','opportunities','documents','appointments','tasks')
    order by e.created_at
    limit 100
    for update skip locked
  loop
    rec := coalesce(ev.payload->'record', '{}'::jsonb);
    customer_id := nullif(rec->>'customer_id','')::uuid;
    if ev.entity_type = 'customers' then customer_id := ev.entity_id; end if;
    opportunity_id := nullif(rec->>'opportunity_id','')::uuid;
    if ev.entity_type = 'opportunities' then opportunity_id := ev.entity_id; end if;
    event_failed := false;

    for wf in
      select w.*
      from public.workflows w
      where w.workspace_id = ev.workspace_id
        and w.enabled = true
        and w.trigger_type = case
          when split_part(ev.event_type, ':', 1) = 'insert' then 'record_created'
          else 'record_updated'
        end
        and coalesce(w.trigger_config->>'entity_type','') = ev.entity_type
    loop
      if not public.workflow_conditions_match(rec, wf.conditions) then continue; end if;

      idem := ev.id::text || ':' || wf.id::text;
      run_id := null;
      insert into public.workflow_runs
        (workspace_id, workflow_id, trigger_event_id, status, idempotency_key, context, started_at)
      values
        (ev.workspace_id, wf.id, ev.id,
         case when wf.mode = 'automatic' then 'running' else 'waiting_approval' end,
         idem, jsonb_build_object('event_id', ev.id, 'event', jsonb_build_object(
           'id', ev.id, 'event_type', ev.event_type, 'entity_type', ev.entity_type,
           'entity_id', ev.entity_id, 'payload', ev.payload), 'record', rec), now())
      on conflict (workflow_id, idempotency_key) do update
        set status = 'running', error = null, started_at = now(), completed_at = null
        where workflow_runs.status = 'failed'
      returning id into run_id;

      if run_id is null then continue; end if;
      run_count := run_count + 1;

      if wf.mode <> 'automatic' then
        update public.workflow_runs
        set status = 'waiting_approval', started_at = null, completed_at = null, error = null
        where id = run_id and workspace_id = ev.workspace_id;
        continue;
      end if;

      outputs := '[]'::jsonb;
      begin
        for act in select value from jsonb_array_elements(coalesce(wf.actions, '[]'::jsonb))
        loop
          if act->>'type' = 'create_task' then
            insert into public.tasks
              (workspace_id, customer_id, opportunity_id, title, status, priority, due_at)
            values
              (ev.workspace_id, customer_id, opportunity_id,
               coalesce(nullif(act->>'title',''), 'Workflow task'),
               'open', coalesce(nullif(act->>'priority','')::numeric, 1),
               now() + make_interval(hours => coalesce(nullif(act->>'delay_hours','')::integer, 0)));
            outputs := outputs || jsonb_build_array(jsonb_build_object('type','create_task'));
            action_count := action_count + 1;
          elsif act->>'type' = 'create_follow_up' then
            insert into public.follow_ups
              (workspace_id, customer_id, opportunity_id, channel, status, scheduled_at, message)
            values
              (ev.workspace_id, customer_id, opportunity_id,
               coalesce(nullif(act->>'channel',''), 'task'), 'pending',
               now() + make_interval(hours => coalesce(nullif(act->>'delay_hours','')::integer, 0)),
               coalesce(nullif(act->>'message',''), 'Workflow follow-up'));
            outputs := outputs || jsonb_build_array(jsonb_build_object('type','create_follow_up'));
            action_count := action_count + 1;
          elsif act->>'type' = 'update_opportunity' and ev.entity_type = 'opportunities' then
            patch := coalesce(act->'patch', '{}'::jsonb);
            update public.opportunities
            set title = coalesce(patch->>'title', title),
                reason = coalesce(patch->>'reason', reason),
                status = coalesce(patch->>'status', status),
                priority = coalesce(nullif(patch->>'priority','')::numeric, priority),
                amount = coalesce(nullif(patch->>'amount','')::numeric, amount),
                due_at = coalesce(nullif(patch->>'due_at','')::timestamptz, due_at),
                updated_at = now()
            where id = ev.entity_id and workspace_id = ev.workspace_id;
            outputs := outputs || jsonb_build_array(jsonb_build_object('type','update_opportunity','id',ev.entity_id));
            action_count := action_count + 1;
          else
            raise exception 'Unsupported workflow action for background processing: %', coalesce(act->>'type','unknown');
          end if;
        end loop;

        update public.workflow_runs
        set status = 'completed', result = jsonb_build_object('outputs', outputs, 'background', true),
            completed_at = now(), error = null
        where id = run_id and workspace_id = ev.workspace_id;
      exception when others then
        get stacked diagnostics error_message = message_text;
        update public.workflow_runs
        set status = 'failed', error = error_message, completed_at = now()
        where id = run_id and workspace_id = ev.workspace_id;
        event_failed := true;
        failure_count := failure_count + 1;
      end;
    end loop;

    if not event_failed then
      update public.workflow_events set processed_at = now()
      where id = ev.id and workspace_id = ev.workspace_id;
    end if;
  end loop;

  return jsonb_build_object(
    'processed_actions', action_count,
    'runs_created_or_retried', run_count,
    'failed_runs', failure_count,
    'ran_at', now()
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.run_background_workflows()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  scheduled_result jsonb;
  record_result jsonb;
begin
  scheduled_result := public.run_scheduled_and_due_workflows();
  record_result := public.process_record_workflow_events();
  return jsonb_build_object('scheduled_and_due', scheduled_result, 'record_events', record_result, 'ran_at', now());
end;
$function$
;
CREATE OR REPLACE FUNCTION public.emit_workflow_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  ws uuid;
  payload jsonb;
BEGIN
  -- DELETE workflows are intentionally unsupported; do not enqueue misleading events.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  ws := NEW.workspace_id;
  IF ws IS NULL THEN
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'operation', TG_OP,
    'table', TG_TABLE_NAME,
    'record', to_jsonb(NEW),
    'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END
  );

  INSERT INTO public.workflow_events(workspace_id, event_type, entity_type, entity_id, payload)
  VALUES (ws, lower(TG_OP) || ':' || TG_TABLE_NAME, TG_TABLE_NAME, NEW.id, payload);

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_public_lead_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  normalized_phone text;
  recent_email_count integer;
  recent_phone_count integer;
BEGIN
  normalized_phone := regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g');

  -- Serialize concurrent submissions for the same identity before counting.
  PERFORM pg_advisory_xact_lock(hashtextextended('public_lead_email:' || lower(btrim(NEW.email)), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('public_lead_phone:' || normalized_phone, 0));

  SELECT count(*) INTO recent_email_count
  FROM public.public_leads
  WHERE lower(btrim(email)) = lower(btrim(NEW.email))
    AND created_at >= now() - interval '1 hour';

  IF recent_email_count >= 5 THEN
    RAISE EXCEPTION 'Too many lead submissions for this email. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO recent_phone_count
  FROM public.public_leads
  WHERE regexp_replace(phone, '[^0-9]', '', 'g') = normalized_phone
    AND created_at >= now() - interval '1 hour';

  IF recent_phone_count >= 5 THEN
    RAISE EXCEPTION 'Too many lead submissions for this phone. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE TRIGGER set_updated_at_workspaces BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER set_updated_at_customers BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER set_updated_at_opportunities BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER workflows_customers_event AFTER INSERT OR DELETE OR UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION emit_workflow_event();
CREATE TRIGGER workflows_opportunities_event AFTER INSERT OR DELETE OR UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION emit_workflow_event();
CREATE TRIGGER workflows_appointments_event AFTER INSERT OR DELETE OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION emit_workflow_event();
CREATE TRIGGER workflows_tasks_event AFTER INSERT OR DELETE OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION emit_workflow_event();
CREATE TRIGGER workflows_documents_event AFTER INSERT OR DELETE OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION emit_workflow_event();
CREATE TRIGGER workspace_settings_updated_at BEFORE UPDATE ON workspace_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspace_subscriptions_updated_at BEFORE UPDATE ON workspace_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspace_usage_updated_at BEFORE UPDATE ON workspace_usage FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workspace_saas_state_init AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION initialize_workspace_saas_state();
CREATE TRIGGER enforce_public_lead_rate_limit BEFORE INSERT ON public_leads FOR EACH ROW EXECUTE FUNCTION enforce_public_lead_rate_limit();
ALTER TABLE public."customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."follow_ups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."recovery_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workspace_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."activity_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workspace_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stripe_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workspace_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workspace_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quickbooks_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."workspace_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."loose_ends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."public_leads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_member_select" ON public."workspaces" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_workspace_member(id));
CREATE POLICY "workflow_runs_member_select" ON public."workflow_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_workspace_member(workspace_id));
CREATE POLICY "membership_select" ON public."workspace_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((user_id = ( SELECT auth.uid() AS uid)) OR is_workspace_member(workspace_id)));
CREATE POLICY "customers_member_all" ON public."customers" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_workspace_member(workspace_id)) WITH CHECK (is_workspace_member(workspace_id));
CREATE POLICY "opportunities_member_all" ON public."opportunities" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_workspace_member(workspace_id)) WITH CHECK (is_workspace_member(workspace_id));
CREATE POLICY "follow_ups_member_all" ON public."follow_ups" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_workspace_member(workspace_id)) WITH CHECK (is_workspace_member(workspace_id));
CREATE POLICY "recovery_events_member_all" ON public."recovery_events" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_workspace_member(workspace_id)) WITH CHECK (is_workspace_member(workspace_id));
CREATE POLICY "audit_events_member_select" ON public."audit_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_workspace_member(workspace_id));
CREATE POLICY "audit_events_member_insert" ON public."audit_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_workspace_member(workspace_id) AND (actor_user_id = ( SELECT auth.uid() AS uid))));
CREATE POLICY "contacts_member_select" ON public."contacts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (( SELECT is_workspace_member(contacts.workspace_id) AS is_workspace_member));
CREATE POLICY "contacts_member_insert" ON public."contacts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT is_workspace_member(contacts.workspace_id) AS is_workspace_member));
CREATE POLICY "contacts_member_update" ON public."contacts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (( SELECT is_workspace_member(contacts.workspace_id) AS is_workspace_member)) WITH CHECK (( SELECT is_workspace_member(contacts.workspace_id) AS is_workspace_member));
CREATE POLICY "contacts_member_delete" ON public."contacts" AS PERMISSIVE FOR DELETE TO "authenticated" USING (( SELECT is_workspace_member(contacts.workspace_id) AS is_workspace_member));
CREATE POLICY "appointments_member_select" ON public."appointments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (( SELECT is_workspace_member(appointments.workspace_id) AS is_workspace_member));
CREATE POLICY "appointments_member_insert" ON public."appointments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT is_workspace_member(appointments.workspace_id) AS is_workspace_member));
CREATE POLICY "appointments_member_update" ON public."appointments" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (( SELECT is_workspace_member(appointments.workspace_id) AS is_workspace_member)) WITH CHECK (( SELECT is_workspace_member(appointments.workspace_id) AS is_workspace_member));
CREATE POLICY "appointments_member_delete" ON public."appointments" AS PERMISSIVE FOR DELETE TO "authenticated" USING (( SELECT is_workspace_member(appointments.workspace_id) AS is_workspace_member));
CREATE POLICY "tasks_member_select" ON public."tasks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (( SELECT is_workspace_member(tasks.workspace_id) AS is_workspace_member));
CREATE POLICY "tasks_member_insert" ON public."tasks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT is_workspace_member(tasks.workspace_id) AS is_workspace_member));
CREATE POLICY "tasks_member_update" ON public."tasks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (( SELECT is_workspace_member(tasks.workspace_id) AS is_workspace_member)) WITH CHECK (( SELECT is_workspace_member(tasks.workspace_id) AS is_workspace_member));
CREATE POLICY "tasks_member_delete" ON public."tasks" AS PERMISSIVE FOR DELETE TO "authenticated" USING (( SELECT is_workspace_member(tasks.workspace_id) AS is_workspace_member));
CREATE POLICY "documents_member_select" ON public."documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (( SELECT is_workspace_member(documents.workspace_id) AS is_workspace_member));
CREATE POLICY "documents_member_insert" ON public."documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT is_workspace_member(documents.workspace_id) AS is_workspace_member));
CREATE POLICY "documents_member_update" ON public."documents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (( SELECT is_workspace_member(documents.workspace_id) AS is_workspace_member)) WITH CHECK (( SELECT is_workspace_member(documents.workspace_id) AS is_workspace_member));
CREATE POLICY "documents_member_delete" ON public."documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (( SELECT is_workspace_member(documents.workspace_id) AS is_workspace_member));
CREATE POLICY "loose_ends_member_select" ON public."loose_ends" AS PERMISSIVE FOR SELECT TO "authenticated" USING (( SELECT is_workspace_member(loose_ends.workspace_id) AS is_workspace_member));
CREATE POLICY "loose_ends_member_insert" ON public."loose_ends" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (( SELECT is_workspace_member(loose_ends.workspace_id) AS is_workspace_member));
CREATE POLICY "loose_ends_member_update" ON public."loose_ends" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (( SELECT is_workspace_member(loose_ends.workspace_id) AS is_workspace_member)) WITH CHECK (( SELECT is_workspace_member(loose_ends.workspace_id) AS is_workspace_member));
CREATE POLICY "loose_ends_member_delete" ON public."loose_ends" AS PERMISSIVE FOR DELETE TO "authenticated" USING (( SELECT is_workspace_member(loose_ends.workspace_id) AS is_workspace_member));
CREATE POLICY "workspace_owner_insert" ON public."workspaces" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((owner_user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "public leads can be submitted" ON public."public_leads" AS PERMISSIVE FOR INSERT TO "anon","authenticated" WITH CHECK ((((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 200)) AND ((length(TRIM(BOTH FROM business)) >= 1) AND (length(TRIM(BOTH FROM business)) <= 200)) AND ((length(TRIM(BOTH FROM phone)) >= 7) AND (length(TRIM(BOTH FROM phone)) <= 50)) AND ((length(TRIM(BOTH FROM email)) >= 3) AND (length(TRIM(BOTH FROM email)) <= 320))));
CREATE POLICY "workspace members can view public leads" ON public."public_leads" AS PERMISSIVE FOR SELECT TO "authenticated" USING (false);
CREATE POLICY "membership_self_insert" ON public."workspace_members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (workspace_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "stripe_webhook_events_no_client_access" ON public."stripe_webhook_events" AS PERMISSIVE FOR ALL TO "anon","authenticated" USING (false) WITH CHECK (false);
CREATE POLICY "quickbooks_connection_member_select" ON public."quickbooks_connections" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_workspace_member(workspace_id));
CREATE POLICY "usage_member_select" ON public."workspace_usage" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_workspace_member(workspace_id));
CREATE POLICY "subscriptions_member_select" ON public."workspace_subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_workspace_member(workspace_id));
CREATE POLICY "workflows_member_select" ON public."workflows" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workflows.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "workflows_admin_insert" ON public."workflows" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workflows.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
CREATE POLICY "workflows_admin_update" ON public."workflows" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workflows.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workflows.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
CREATE POLICY "workflows_admin_delete" ON public."workflows" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workflows.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
CREATE POLICY "membership_self_delete" ON public."workspace_members" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "activity_events_member_insert" ON public."activity_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = activity_events.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "activity_events_member_select" ON public."activity_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = activity_events.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "workflow_events_member_select" ON public."workflow_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workflow_events.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "workspace_records_member_delete" ON public."workspace_records" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_workspace_member(workspace_id));
CREATE POLICY "workspace_records_member_insert" ON public."workspace_records" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_workspace_member(workspace_id));
CREATE POLICY "workspace_records_member_select" ON public."workspace_records" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_workspace_member(workspace_id));
CREATE POLICY "workspace_records_member_update" ON public."workspace_records" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_workspace_member(workspace_id)) WITH CHECK (is_workspace_member(workspace_id));
CREATE POLICY "workspace_settings_member_insert" ON public."workspace_settings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspace_settings.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
CREATE POLICY "workspace_settings_member_select" ON public."workspace_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspace_settings.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "workspace_settings_member_update" ON public."workspace_settings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspace_settings.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspace_settings.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
CREATE POLICY "workspace_admin_update" ON public."workspaces" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspaces.id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspaces.id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
GRANT INSERT ON TABLE public."customers" TO "authenticated";
GRANT SELECT ON TABLE public."customers" TO "authenticated";
GRANT UPDATE ON TABLE public."customers" TO "authenticated";
GRANT DELETE ON TABLE public."customers" TO "authenticated";
GRANT INSERT ON TABLE public."customers" TO "service_role";
GRANT SELECT ON TABLE public."customers" TO "service_role";
GRANT UPDATE ON TABLE public."customers" TO "service_role";
GRANT DELETE ON TABLE public."customers" TO "service_role";
GRANT TRUNCATE ON TABLE public."customers" TO "service_role";
GRANT REFERENCES ON TABLE public."customers" TO "service_role";
GRANT TRIGGER ON TABLE public."customers" TO "service_role";
GRANT INSERT ON TABLE public."follow_ups" TO "authenticated";
GRANT SELECT ON TABLE public."follow_ups" TO "authenticated";
GRANT UPDATE ON TABLE public."follow_ups" TO "authenticated";
GRANT DELETE ON TABLE public."follow_ups" TO "authenticated";
GRANT INSERT ON TABLE public."follow_ups" TO "service_role";
GRANT SELECT ON TABLE public."follow_ups" TO "service_role";
GRANT UPDATE ON TABLE public."follow_ups" TO "service_role";
GRANT DELETE ON TABLE public."follow_ups" TO "service_role";
GRANT TRUNCATE ON TABLE public."follow_ups" TO "service_role";
GRANT REFERENCES ON TABLE public."follow_ups" TO "service_role";
GRANT TRIGGER ON TABLE public."follow_ups" TO "service_role";
GRANT INSERT ON TABLE public."recovery_events" TO "authenticated";
GRANT SELECT ON TABLE public."recovery_events" TO "authenticated";
GRANT UPDATE ON TABLE public."recovery_events" TO "authenticated";
GRANT DELETE ON TABLE public."recovery_events" TO "authenticated";
GRANT INSERT ON TABLE public."recovery_events" TO "service_role";
GRANT SELECT ON TABLE public."recovery_events" TO "service_role";
GRANT UPDATE ON TABLE public."recovery_events" TO "service_role";
GRANT DELETE ON TABLE public."recovery_events" TO "service_role";
GRANT TRUNCATE ON TABLE public."recovery_events" TO "service_role";
GRANT REFERENCES ON TABLE public."recovery_events" TO "service_role";
GRANT TRIGGER ON TABLE public."recovery_events" TO "service_role";
GRANT INSERT ON TABLE public."audit_events" TO "authenticated";
GRANT SELECT ON TABLE public."audit_events" TO "authenticated";
GRANT UPDATE ON TABLE public."audit_events" TO "authenticated";
GRANT DELETE ON TABLE public."audit_events" TO "authenticated";
GRANT INSERT ON TABLE public."audit_events" TO "service_role";
GRANT SELECT ON TABLE public."audit_events" TO "service_role";
GRANT UPDATE ON TABLE public."audit_events" TO "service_role";
GRANT DELETE ON TABLE public."audit_events" TO "service_role";
GRANT TRUNCATE ON TABLE public."audit_events" TO "service_role";
GRANT REFERENCES ON TABLE public."audit_events" TO "service_role";
GRANT TRIGGER ON TABLE public."audit_events" TO "service_role";
GRANT INSERT ON TABLE public."workspace_members" TO "authenticated";
GRANT SELECT ON TABLE public."workspace_members" TO "authenticated";
GRANT UPDATE ON TABLE public."workspace_members" TO "authenticated";
GRANT DELETE ON TABLE public."workspace_members" TO "authenticated";
GRANT INSERT ON TABLE public."workspace_members" TO "service_role";
GRANT SELECT ON TABLE public."workspace_members" TO "service_role";
GRANT UPDATE ON TABLE public."workspace_members" TO "service_role";
GRANT DELETE ON TABLE public."workspace_members" TO "service_role";
GRANT TRUNCATE ON TABLE public."workspace_members" TO "service_role";
GRANT REFERENCES ON TABLE public."workspace_members" TO "service_role";
GRANT TRIGGER ON TABLE public."workspace_members" TO "service_role";
GRANT INSERT ON TABLE public."opportunities" TO "authenticated";
GRANT SELECT ON TABLE public."opportunities" TO "authenticated";
GRANT UPDATE ON TABLE public."opportunities" TO "authenticated";
GRANT DELETE ON TABLE public."opportunities" TO "authenticated";
GRANT INSERT ON TABLE public."opportunities" TO "service_role";
GRANT SELECT ON TABLE public."opportunities" TO "service_role";
GRANT UPDATE ON TABLE public."opportunities" TO "service_role";
GRANT DELETE ON TABLE public."opportunities" TO "service_role";
GRANT TRUNCATE ON TABLE public."opportunities" TO "service_role";
GRANT REFERENCES ON TABLE public."opportunities" TO "service_role";
GRANT TRIGGER ON TABLE public."opportunities" TO "service_role";
GRANT INSERT ON TABLE public."workspaces" TO "authenticated";
GRANT SELECT ON TABLE public."workspaces" TO "authenticated";
GRANT INSERT ON TABLE public."workspaces" TO "service_role";
GRANT SELECT ON TABLE public."workspaces" TO "service_role";
GRANT UPDATE ON TABLE public."workspaces" TO "service_role";
GRANT DELETE ON TABLE public."workspaces" TO "service_role";
GRANT TRUNCATE ON TABLE public."workspaces" TO "service_role";
GRANT REFERENCES ON TABLE public."workspaces" TO "service_role";
GRANT TRIGGER ON TABLE public."workspaces" TO "service_role";
GRANT INSERT ON TABLE public."contacts" TO "anon";
GRANT SELECT ON TABLE public."contacts" TO "anon";
GRANT UPDATE ON TABLE public."contacts" TO "anon";
GRANT DELETE ON TABLE public."contacts" TO "anon";
GRANT INSERT ON TABLE public."contacts" TO "authenticated";
GRANT SELECT ON TABLE public."contacts" TO "authenticated";
GRANT UPDATE ON TABLE public."contacts" TO "authenticated";
GRANT DELETE ON TABLE public."contacts" TO "authenticated";
GRANT INSERT ON TABLE public."contacts" TO "service_role";
GRANT SELECT ON TABLE public."contacts" TO "service_role";
GRANT UPDATE ON TABLE public."contacts" TO "service_role";
GRANT DELETE ON TABLE public."contacts" TO "service_role";
GRANT TRUNCATE ON TABLE public."contacts" TO "service_role";
GRANT REFERENCES ON TABLE public."contacts" TO "service_role";
GRANT TRIGGER ON TABLE public."contacts" TO "service_role";
GRANT INSERT ON TABLE public."appointments" TO "anon";
GRANT SELECT ON TABLE public."appointments" TO "anon";
GRANT UPDATE ON TABLE public."appointments" TO "anon";
GRANT DELETE ON TABLE public."appointments" TO "anon";
GRANT INSERT ON TABLE public."appointments" TO "authenticated";
GRANT SELECT ON TABLE public."appointments" TO "authenticated";
GRANT UPDATE ON TABLE public."appointments" TO "authenticated";
GRANT DELETE ON TABLE public."appointments" TO "authenticated";
GRANT INSERT ON TABLE public."appointments" TO "service_role";
GRANT SELECT ON TABLE public."appointments" TO "service_role";
GRANT UPDATE ON TABLE public."appointments" TO "service_role";
GRANT DELETE ON TABLE public."appointments" TO "service_role";
GRANT TRUNCATE ON TABLE public."appointments" TO "service_role";
GRANT REFERENCES ON TABLE public."appointments" TO "service_role";
GRANT TRIGGER ON TABLE public."appointments" TO "service_role";
GRANT INSERT ON TABLE public."workflow_events" TO "service_role";
GRANT SELECT ON TABLE public."workflow_events" TO "service_role";
GRANT UPDATE ON TABLE public."workflow_events" TO "service_role";
GRANT DELETE ON TABLE public."workflow_events" TO "service_role";
GRANT TRUNCATE ON TABLE public."workflow_events" TO "service_role";
GRANT REFERENCES ON TABLE public."workflow_events" TO "service_role";
GRANT TRIGGER ON TABLE public."workflow_events" TO "service_role";
GRANT SELECT ON TABLE public."workflow_events" TO "authenticated";
GRANT INSERT ON TABLE public."workflow_runs" TO "service_role";
GRANT SELECT ON TABLE public."workflow_runs" TO "service_role";
GRANT UPDATE ON TABLE public."workflow_runs" TO "service_role";
GRANT DELETE ON TABLE public."workflow_runs" TO "service_role";
GRANT TRUNCATE ON TABLE public."workflow_runs" TO "service_role";
GRANT REFERENCES ON TABLE public."workflow_runs" TO "service_role";
GRANT TRIGGER ON TABLE public."workflow_runs" TO "service_role";
GRANT SELECT ON TABLE public."workflow_runs" TO "authenticated";
GRANT INSERT ON TABLE public."workflows" TO "anon";
GRANT SELECT ON TABLE public."workflows" TO "anon";
GRANT UPDATE ON TABLE public."workflows" TO "anon";
GRANT DELETE ON TABLE public."workflows" TO "anon";
GRANT INSERT ON TABLE public."workflows" TO "authenticated";
GRANT SELECT ON TABLE public."workflows" TO "authenticated";
GRANT UPDATE ON TABLE public."workflows" TO "authenticated";
GRANT DELETE ON TABLE public."workflows" TO "authenticated";
GRANT INSERT ON TABLE public."workflows" TO "service_role";
GRANT SELECT ON TABLE public."workflows" TO "service_role";
GRANT UPDATE ON TABLE public."workflows" TO "service_role";
GRANT DELETE ON TABLE public."workflows" TO "service_role";
GRANT TRUNCATE ON TABLE public."workflows" TO "service_role";
GRANT REFERENCES ON TABLE public."workflows" TO "service_role";
GRANT TRIGGER ON TABLE public."workflows" TO "service_role";
GRANT INSERT ON TABLE public."activity_events" TO "anon";
GRANT SELECT ON TABLE public."activity_events" TO "anon";
GRANT UPDATE ON TABLE public."activity_events" TO "anon";
GRANT DELETE ON TABLE public."activity_events" TO "anon";
GRANT INSERT ON TABLE public."activity_events" TO "authenticated";
GRANT SELECT ON TABLE public."activity_events" TO "authenticated";
GRANT UPDATE ON TABLE public."activity_events" TO "authenticated";
GRANT DELETE ON TABLE public."activity_events" TO "authenticated";
GRANT INSERT ON TABLE public."activity_events" TO "service_role";
GRANT SELECT ON TABLE public."activity_events" TO "service_role";
GRANT UPDATE ON TABLE public."activity_events" TO "service_role";
GRANT DELETE ON TABLE public."activity_events" TO "service_role";
GRANT TRUNCATE ON TABLE public."activity_events" TO "service_role";
GRANT REFERENCES ON TABLE public."activity_events" TO "service_role";
GRANT TRIGGER ON TABLE public."activity_events" TO "service_role";
GRANT SELECT ON TABLE public."workspace_usage" TO "anon";
GRANT SELECT ON TABLE public."workspace_usage" TO "authenticated";
GRANT INSERT ON TABLE public."workspace_usage" TO "service_role";
GRANT SELECT ON TABLE public."workspace_usage" TO "service_role";
GRANT UPDATE ON TABLE public."workspace_usage" TO "service_role";
GRANT DELETE ON TABLE public."workspace_usage" TO "service_role";
GRANT TRUNCATE ON TABLE public."workspace_usage" TO "service_role";
GRANT REFERENCES ON TABLE public."workspace_usage" TO "service_role";
GRANT TRIGGER ON TABLE public."workspace_usage" TO "service_role";
GRANT INSERT ON TABLE public."stripe_webhook_events" TO "service_role";
GRANT SELECT ON TABLE public."stripe_webhook_events" TO "service_role";
GRANT UPDATE ON TABLE public."stripe_webhook_events" TO "service_role";
GRANT DELETE ON TABLE public."stripe_webhook_events" TO "service_role";
GRANT TRUNCATE ON TABLE public."stripe_webhook_events" TO "service_role";
GRANT REFERENCES ON TABLE public."stripe_webhook_events" TO "service_role";
GRANT TRIGGER ON TABLE public."stripe_webhook_events" TO "service_role";
GRANT INSERT ON TABLE public."workspace_records" TO "authenticated";
GRANT SELECT ON TABLE public."workspace_records" TO "authenticated";
GRANT UPDATE ON TABLE public."workspace_records" TO "authenticated";
GRANT DELETE ON TABLE public."workspace_records" TO "authenticated";
GRANT INSERT ON TABLE public."workspace_records" TO "service_role";
GRANT SELECT ON TABLE public."workspace_records" TO "service_role";
GRANT UPDATE ON TABLE public."workspace_records" TO "service_role";
GRANT DELETE ON TABLE public."workspace_records" TO "service_role";
GRANT TRUNCATE ON TABLE public."workspace_records" TO "service_role";
GRANT REFERENCES ON TABLE public."workspace_records" TO "service_role";
GRANT TRIGGER ON TABLE public."workspace_records" TO "service_role";
GRANT INSERT ON TABLE public."workspace_settings" TO "authenticated";
GRANT SELECT ON TABLE public."workspace_settings" TO "authenticated";
GRANT UPDATE ON TABLE public."workspace_settings" TO "authenticated";
GRANT INSERT ON TABLE public."workspace_settings" TO "service_role";
GRANT SELECT ON TABLE public."workspace_settings" TO "service_role";
GRANT UPDATE ON TABLE public."workspace_settings" TO "service_role";
GRANT DELETE ON TABLE public."workspace_settings" TO "service_role";
GRANT TRUNCATE ON TABLE public."workspace_settings" TO "service_role";
GRANT REFERENCES ON TABLE public."workspace_settings" TO "service_role";
GRANT TRIGGER ON TABLE public."workspace_settings" TO "service_role";
GRANT INSERT ON TABLE public."quickbooks_connections" TO "service_role";
GRANT SELECT ON TABLE public."quickbooks_connections" TO "service_role";
GRANT UPDATE ON TABLE public."quickbooks_connections" TO "service_role";
GRANT DELETE ON TABLE public."quickbooks_connections" TO "service_role";
GRANT TRUNCATE ON TABLE public."quickbooks_connections" TO "service_role";
GRANT REFERENCES ON TABLE public."quickbooks_connections" TO "service_role";
GRANT TRIGGER ON TABLE public."quickbooks_connections" TO "service_role";
GRANT SELECT ON TABLE public."quickbooks_connections" TO "authenticated";
GRANT INSERT ON TABLE public."workspace_subscriptions" TO "service_role";
GRANT SELECT ON TABLE public."workspace_subscriptions" TO "service_role";
GRANT UPDATE ON TABLE public."workspace_subscriptions" TO "service_role";
GRANT DELETE ON TABLE public."workspace_subscriptions" TO "service_role";
GRANT TRUNCATE ON TABLE public."workspace_subscriptions" TO "service_role";
GRANT REFERENCES ON TABLE public."workspace_subscriptions" TO "service_role";
GRANT TRIGGER ON TABLE public."workspace_subscriptions" TO "service_role";
GRANT SELECT ON TABLE public."workspace_subscriptions" TO "authenticated";
GRANT INSERT ON TABLE public."tasks" TO "anon";
GRANT SELECT ON TABLE public."tasks" TO "anon";
GRANT UPDATE ON TABLE public."tasks" TO "anon";
GRANT DELETE ON TABLE public."tasks" TO "anon";
GRANT INSERT ON TABLE public."tasks" TO "authenticated";
GRANT SELECT ON TABLE public."tasks" TO "authenticated";
GRANT UPDATE ON TABLE public."tasks" TO "authenticated";
GRANT DELETE ON TABLE public."tasks" TO "authenticated";
GRANT INSERT ON TABLE public."tasks" TO "service_role";
GRANT SELECT ON TABLE public."tasks" TO "service_role";
GRANT UPDATE ON TABLE public."tasks" TO "service_role";
GRANT DELETE ON TABLE public."tasks" TO "service_role";
GRANT TRUNCATE ON TABLE public."tasks" TO "service_role";
GRANT REFERENCES ON TABLE public."tasks" TO "service_role";
GRANT TRIGGER ON TABLE public."tasks" TO "service_role";
GRANT INSERT ON TABLE public."documents" TO "anon";
GRANT SELECT ON TABLE public."documents" TO "anon";
GRANT UPDATE ON TABLE public."documents" TO "anon";
GRANT DELETE ON TABLE public."documents" TO "anon";
GRANT INSERT ON TABLE public."documents" TO "authenticated";
GRANT SELECT ON TABLE public."documents" TO "authenticated";
GRANT UPDATE ON TABLE public."documents" TO "authenticated";
GRANT DELETE ON TABLE public."documents" TO "authenticated";
GRANT INSERT ON TABLE public."documents" TO "service_role";
GRANT SELECT ON TABLE public."documents" TO "service_role";
GRANT UPDATE ON TABLE public."documents" TO "service_role";
GRANT DELETE ON TABLE public."documents" TO "service_role";
GRANT TRUNCATE ON TABLE public."documents" TO "service_role";
GRANT REFERENCES ON TABLE public."documents" TO "service_role";
GRANT TRIGGER ON TABLE public."documents" TO "service_role";
GRANT INSERT ON TABLE public."loose_ends" TO "anon";
GRANT SELECT ON TABLE public."loose_ends" TO "anon";
GRANT UPDATE ON TABLE public."loose_ends" TO "anon";
GRANT DELETE ON TABLE public."loose_ends" TO "anon";
GRANT INSERT ON TABLE public."loose_ends" TO "authenticated";
GRANT SELECT ON TABLE public."loose_ends" TO "authenticated";
GRANT UPDATE ON TABLE public."loose_ends" TO "authenticated";
GRANT DELETE ON TABLE public."loose_ends" TO "authenticated";
GRANT INSERT ON TABLE public."loose_ends" TO "service_role";
GRANT SELECT ON TABLE public."loose_ends" TO "service_role";
GRANT UPDATE ON TABLE public."loose_ends" TO "service_role";
GRANT DELETE ON TABLE public."loose_ends" TO "service_role";
GRANT TRUNCATE ON TABLE public."loose_ends" TO "service_role";
GRANT REFERENCES ON TABLE public."loose_ends" TO "service_role";
GRANT TRIGGER ON TABLE public."loose_ends" TO "service_role";
GRANT INSERT ON TABLE public."public_leads" TO "service_role";
GRANT SELECT ON TABLE public."public_leads" TO "service_role";
GRANT UPDATE ON TABLE public."public_leads" TO "service_role";
GRANT DELETE ON TABLE public."public_leads" TO "service_role";
GRANT TRUNCATE ON TABLE public."public_leads" TO "service_role";
GRANT REFERENCES ON TABLE public."public_leads" TO "service_role";
GRANT TRIGGER ON TABLE public."public_leads" TO "service_role";
GRANT INSERT ON TABLE public."public_leads" TO "anon";
GRANT INSERT ON TABLE public."public_leads" TO "authenticated";
GRANT UPDATE ("name") ON TABLE public."workspaces" TO "authenticated";
GRANT UPDATE ("slug") ON TABLE public."workspaces" TO "authenticated";
REVOKE ALL ON FUNCTION public."is_workspace_member"(p_workspace_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."is_workspace_member"(p_workspace_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."is_workspace_member"(p_workspace_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public."is_workspace_member"(p_workspace_id uuid) TO "anon";
GRANT EXECUTE ON FUNCTION public."is_workspace_member"(p_workspace_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public."is_workspace_member"(p_workspace_id uuid) TO "service_role";
REVOKE ALL ON FUNCTION public."touch_updated_at"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."touch_updated_at"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."touch_updated_at"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."touch_updated_at"() TO "anon";
GRANT EXECUTE ON FUNCTION public."touch_updated_at"() TO "authenticated";
GRANT EXECUTE ON FUNCTION public."touch_updated_at"() TO "service_role";
REVOKE ALL ON FUNCTION public."revenue_recovery_summary"(p_workspace_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."revenue_recovery_summary"(p_workspace_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."revenue_recovery_summary"(p_workspace_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public."revenue_recovery_summary"(p_workspace_id uuid) TO "anon";
GRANT EXECUTE ON FUNCTION public."revenue_recovery_summary"(p_workspace_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public."revenue_recovery_summary"(p_workspace_id uuid) TO "service_role";
REVOKE ALL ON FUNCTION public."mark_loose_end_recovered"(p_loose_end_id uuid, p_amount numeric, p_note text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."mark_loose_end_recovered"(p_loose_end_id uuid, p_amount numeric, p_note text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."mark_loose_end_recovered"(p_loose_end_id uuid, p_amount numeric, p_note text) TO "postgres";
GRANT EXECUTE ON FUNCTION public."mark_loose_end_recovered"(p_loose_end_id uuid, p_amount numeric, p_note text) TO "anon";
GRANT EXECUTE ON FUNCTION public."mark_loose_end_recovered"(p_loose_end_id uuid, p_amount numeric, p_note text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public."mark_loose_end_recovered"(p_loose_end_id uuid, p_amount numeric, p_note text) TO "service_role";
REVOKE ALL ON FUNCTION public."run_scheduled_and_due_workflows"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."run_scheduled_and_due_workflows"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."run_scheduled_and_due_workflows"() TO "service_role";
REVOKE ALL ON FUNCTION public."workflow_conditions_match"(record jsonb, conditions jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."workflow_conditions_match"(record jsonb, conditions jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."workflow_conditions_match"(record jsonb, conditions jsonb) TO "postgres";
GRANT EXECUTE ON FUNCTION public."workflow_conditions_match"(record jsonb, conditions jsonb) TO "anon";
GRANT EXECUTE ON FUNCTION public."workflow_conditions_match"(record jsonb, conditions jsonb) TO "authenticated";
GRANT EXECUTE ON FUNCTION public."workflow_conditions_match"(record jsonb, conditions jsonb) TO "service_role";
REVOKE ALL ON FUNCTION public."get_or_create_workspace_settings"(p_workspace_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."get_or_create_workspace_settings"(p_workspace_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public."get_or_create_workspace_settings"(p_workspace_id uuid) TO "service_role";
REVOKE ALL ON FUNCTION public."set_updated_at"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO "anon";
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO "authenticated";
GRANT EXECUTE ON FUNCTION public."set_updated_at"() TO "service_role";
REVOKE ALL ON FUNCTION public."record_usage"(p_workspace_id uuid, p_metric text, p_quantity bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."record_usage"(p_workspace_id uuid, p_metric text, p_quantity bigint) TO "postgres";
GRANT EXECUTE ON FUNCTION public."record_usage"(p_workspace_id uuid, p_metric text, p_quantity bigint) TO "service_role";
REVOKE ALL ON FUNCTION public."initialize_workspace_saas_state"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."initialize_workspace_saas_state"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."initialize_workspace_saas_state"() TO "service_role";
REVOKE ALL ON FUNCTION public."process_record_workflow_events"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."process_record_workflow_events"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."process_record_workflow_events"() TO "service_role";
REVOKE ALL ON FUNCTION public."run_background_workflows"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."run_background_workflows"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."run_background_workflows"() TO "service_role";
REVOKE ALL ON FUNCTION public."emit_workflow_event"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."emit_workflow_event"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."emit_workflow_event"() TO "service_role";
REVOKE ALL ON FUNCTION public."enforce_public_lead_rate_limit"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."enforce_public_lead_rate_limit"() TO "postgres";
GRANT EXECUTE ON FUNCTION public."enforce_public_lead_rate_limit"() TO "service_role";
