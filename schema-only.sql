--
-- PostgreSQL database dump
--

\restrict QmIQoaKLbyCc5XlDUyF43QHlyedqX3dIX5NxdCaoq25EN7eN9rZdJY79yPRwuNB

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgbouncer;


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vault;


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'super_admin',
    'finance',
    'hr',
    'operations_manager',
    'supervisor',
    'employee',
    'client'
);


--
-- Name: income_entry_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.income_entry_type AS ENUM (
    'service',
    'product_sale'
);


--
-- Name: leave_request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.leave_request_status AS ENUM (
    'Pending',
    'Approved',
    'Rejected',
    'Cancelled'
);


--
-- Name: product_sale_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.product_sale_status AS ENUM (
    'active',
    'voided'
);


--
-- Name: stock_movement_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.stock_movement_type AS ENUM (
    'production_in',
    'sale_out',
    'internal_consumption_out',
    'adjustment'
);


--
-- Name: action; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in',
    'like',
    'ilike',
    'is',
    'match',
    'imatch',
    'isdistinct'
);


--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text,
	negate boolean
);


--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
begin
    if not exists (
        select 1
        from pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: graphql(text, text, jsonb, jsonb); Type: FUNCTION; Schema: graphql_public; Owner: -
--

CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


--
-- Name: admin_delete_payroll_history_for_month(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_payroll_history_for_month(p_month date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  alter table payroll_history disable trigger trg_protect_locked_payroll;
  delete from payroll_history where payroll_month = p_month;
  alter table payroll_history enable trigger trg_protect_locked_payroll;
end;
$$;


--
-- Name: apply_internal_consumption(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_internal_consumption() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_go_live DATE;
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_unit_cost NUMERIC(18, 4);
  v_expense_amount NUMERIC(18, 4);
  v_expense_id UUID;
BEGIN
  UPDATE finished_products
  SET
    current_stock = current_stock - NEW.quantity,
    updated_at = now()
  WHERE id = NEW.product_id;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes
  )
  VALUES (
    NEW.product_id,
    'internal_consumption_out',
    NEW.quantity,
    NEW.id,
    NEW.consumption_date,
    COALESCE(
      NULLIF(TRIM(NEW.notes), ''),
      NULLIF(TRIM(NEW.reason), ''),
      'Internal consumption'
    )
  );

  SELECT go_live_date
  INTO v_go_live
  FROM inventory_balance_config
  WHERE id = 1;

  IF v_go_live IS NULL OR NEW.consumption_date < v_go_live THEN
    RETURN NEW;
  END IF;

  SELECT product_name, unit_of_measure
  INTO v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = NEW.product_id;

  v_unit_cost := finished_product_weighted_avg_cost(NEW.product_id);
  v_expense_amount := ROUND(NEW.quantity * v_unit_cost, 4);

  INSERT INTO expense_register (
    date,
    expense_category,
    sub_category,
    description,
    vendor,
    price,
    quantity,
    amount,
    payment_method,
    approved_by,
    receipt_no,
    payment_status,
    notes
  )
  VALUES (
    NEW.consumption_date,
    'Direct Operational',
    'Cleaning Supplies - Internal Use',
    'Auto-posted internal consumption of ' || v_product_name,
    'Internal',
    v_unit_cost,
    NEW.quantity,
    v_expense_amount,
    'Internal',
    'System',
    'IC-' || LEFT(NEW.id::TEXT, 8),
    'Non-Cash',
    'Linked to internal_consumption ' || NEW.id::TEXT
  )
  RETURNING id INTO v_expense_id;

  UPDATE internal_consumption
  SET expense_register_id = v_expense_id
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;


--
-- Name: apply_raw_material_purchase(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_raw_material_purchase() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_old_stock NUMERIC(18,4); v_old_avg NUMERIC(18,4); v_old_value NUMERIC(18,4); v_new_stock NUMERIC(18,4); v_new_value NUMERIC(18,4); v_new_avg NUMERIC(18,4);
BEGIN
  NEW.total_cost := ROUND(NEW.quantity * NEW.cost_per_unit, 4);
  SELECT current_stock, average_cost_per_unit INTO v_old_stock, v_old_avg FROM raw_materials WHERE id = NEW.material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raw material % not found for purchase', NEW.material_id; END IF;
  v_old_value := ROUND(v_old_stock * v_old_avg, 4); v_new_stock := v_old_stock + NEW.quantity; v_new_value := v_old_value + NEW.total_cost;
  IF v_new_stock <= 0 THEN v_new_avg := 0; ELSE v_new_avg := ROUND(v_new_value / v_new_stock, 4); END IF;
  UPDATE raw_materials SET current_stock = v_new_stock, average_cost_per_unit = v_new_avg, updated_at = now() WHERE id = NEW.material_id;
  RETURN NEW;
END; $$;


--
-- Name: approve_leave_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_leave_request(p_request_id uuid, p_decision_notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_request leave_requests%ROWTYPE;
  v_year INTEGER;
BEGIN
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request % not found', p_request_id;
  END IF;

  IF v_request.status <> 'Pending' THEN
    RAISE EXCEPTION 'Only pending leave requests can be approved';
  END IF;

  IF NOT is_assigned_leave_approver(v_request.approver_user_account_id)
     AND NOT can_manage_leave_balances() THEN
    RAISE EXCEPTION 'You are not authorized to approve this leave request';
  END IF;

  v_year := EXTRACT(YEAR FROM v_request.start_date)::INTEGER;

  INSERT INTO employee_leave_balances (
    employee_id,
    leave_type_id,
    year,
    entitled_days,
    days_used
  )
  VALUES (
    v_request.employee_id,
    v_request.leave_type_id,
    v_year,
    0,
    0
  )
  ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;

  UPDATE employee_leave_balances
  SET
    days_used = days_used + v_request.days_requested,
    updated_at = now()
  WHERE employee_id = v_request.employee_id
    AND leave_type_id = v_request.leave_type_id
    AND year = v_year;

  UPDATE leave_requests
  SET
    status = 'Approved',
    decided_at = now(),
    decision_notes = NULLIF(TRIM(p_decision_notes), '')
  WHERE id = p_request_id;
END;
$$;


--
-- Name: assert_raw_material_stock_not_negative(uuid, uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_raw_material_stock_not_negative(p_material_id uuid, p_exclude_purchase_id uuid DEFAULT NULL::uuid, p_override_purchase_id uuid DEFAULT NULL::uuid, p_override_quantity numeric DEFAULT NULL::numeric, p_action text DEFAULT 'delete'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_purchased_qty NUMERIC(18, 4) := 0;
  v_consumed_qty NUMERIC(18, 4) := 0;
  v_unit TEXT;
  v_purchase RECORD;
  v_action_label TEXT;
BEGIN
  FOR v_purchase IN
    SELECT id, quantity
    FROM raw_material_purchases
    WHERE material_id = p_material_id
      AND (p_exclude_purchase_id IS NULL OR id <> p_exclude_purchase_id)
  LOOP
    IF p_override_purchase_id IS NOT NULL AND v_purchase.id = p_override_purchase_id THEN
      v_purchased_qty := v_purchased_qty + COALESCE(p_override_quantity, v_purchase.quantity);
    ELSE
      v_purchased_qty := v_purchased_qty + v_purchase.quantity;
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(quantity_used), 0)
  INTO v_consumed_qty
  FROM production_batch_materials
  WHERE material_id = p_material_id;

  IF v_purchased_qty - v_consumed_qty < 0 THEN
    SELECT unit_of_measure
    INTO v_unit
    FROM raw_materials
    WHERE id = p_material_id;

    v_action_label := CASE
      WHEN lower(trim(p_action)) IN ('update', 'edit', 'save') THEN 'save changes to this purchase'
      ELSE 'delete'
    END;

    RAISE EXCEPTION
      'Cannot % — % of this material has already been used in production, but remaining purchases only total %',
      v_action_label,
      TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM v_consumed_qty::TEXT)) || COALESCE(v_unit, ''),
      TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM v_purchased_qty::TEXT)) || COALESCE(v_unit, '');
  END IF;
END;
$$;


--
-- Name: calculate_leave_days(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_leave_days(p_start_date date, p_end_date date) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN 0::numeric
    ELSE (p_end_date - p_start_date + 1)::numeric
  END;
$$;


--
-- Name: calculate_live_inventory_value(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_live_inventory_value() RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(
    ROUND(
      (
        SELECT COALESCE(SUM(current_stock * average_cost_per_unit), 0)
        FROM raw_materials
      ) + (
        SELECT COALESCE(
          SUM(
            fp.current_stock * finished_product_weighted_avg_cost(fp.id)
          ),
          0
        )
        FROM finished_products fp
      ),
      4
    ),
    0
  );
$$;


--
-- Name: can_access_client_record(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_client_record(p_client_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE current_user_role()
    WHEN 'super_admin'::app_role THEN true
    WHEN 'finance'::app_role THEN true
    WHEN 'hr'::app_role THEN true
    WHEN 'operations_manager'::app_role THEN true
    WHEN 'supervisor'::app_role THEN true
    WHEN 'client'::app_role THEN
      p_client_id IS NOT NULL
      AND p_client_id = current_user_client_id()
    ELSE false
  END;
$$;


--
-- Name: can_access_client_site(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_client_site(p_site_code text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM sites s
    WHERE s.site_code = p_site_code
      AND can_access_client_record(s.client_id)
  );
$$;


--
-- Name: can_access_employee_record(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_employee_record(p_assigned_site_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE current_user_role()
    WHEN 'super_admin'::app_role THEN true
    WHEN 'finance'::app_role THEN true
    WHEN 'hr'::app_role THEN true
    WHEN 'operations_manager'::app_role THEN true
    WHEN 'supervisor'::app_role THEN
      p_assigned_site_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM user_account_supervisor_sites
        WHERE auth_uid = auth.uid()
          AND site_code = p_assigned_site_id
      )
    WHEN 'client'::app_role THEN can_access_client_site(p_assigned_site_id)
    ELSE false
  END;
$$;


--
-- Name: can_access_finance_income_data(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_finance_income_data() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role
  );
$$;


--
-- Name: can_access_hr_payroll_data(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_hr_payroll_data() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role
  );
$$;


--
-- Name: can_access_operations_site(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_operations_site(p_site_code text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE current_user_role()
    WHEN 'super_admin'::app_role THEN true
    WHEN 'operations_manager'::app_role THEN true
    WHEN 'supervisor'::app_role THEN EXISTS (
      SELECT 1
      FROM user_account_supervisor_sites
      WHERE auth_uid = auth.uid()
        AND site_code = p_site_code
    )
    WHEN 'client'::app_role THEN can_access_client_site(p_site_code)
    ELSE false
  END;
$$;


--
-- Name: can_manage_leave_balances(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_leave_balances() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'hr'::app_role
  );
$$;


--
-- Name: can_view_duty_roster_company_wide(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_duty_roster_company_wide() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'operations_manager'::app_role,
    'hr'::app_role,
    'supervisor'::app_role
  );
$$;


--
-- Name: can_write_employee_records(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_write_employee_records() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role
  );
$$;


--
-- Name: cancel_leave_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_leave_request(p_request_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_request leave_requests%ROWTYPE;
BEGIN
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request % not found', p_request_id;
  END IF;

  IF v_request.status <> 'Pending' THEN
    RAISE EXCEPTION 'Only pending leave requests can be cancelled';
  END IF;

  IF v_request.employee_id <> current_user_employee_id() THEN
    RAISE EXCEPTION 'You can only cancel your own leave requests';
  END IF;

  UPDATE leave_requests
  SET
    status = 'Cancelled',
    decided_at = now()
  WHERE id = p_request_id;
END;
$$;


--
-- Name: change_leave_approver(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.change_leave_approver(p_approver_auth_uid uuid, p_effective_from date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_config_id UUID;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only administrators can change the leave approver';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_accounts WHERE auth_uid = p_approver_auth_uid AND is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'Selected approver user account does not exist or is inactive';
  END IF;

  INSERT INTO leave_approver_config (
    approver_user_account_id,
    effective_from,
    notes
  )
  VALUES (
    p_approver_auth_uid,
    COALESCE(p_effective_from, CURRENT_DATE),
    NULLIF(TRIM(p_notes), '')
  )
  RETURNING id INTO v_config_id;

  RETURN v_config_id;
END;
$$;


--
-- Name: client_can_view_roster_employee(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_can_view_roster_employee(p_assigned_site_id text, p_contract_project text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE current_user_role()
    WHEN 'client'::app_role THEN
      can_access_client_site(p_assigned_site_id)
      OR (
        p_contract_project IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM sites s
          LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.client_id = current_user_client_id()
            AND (
              p_contract_project = p.project_code
              OR EXISTS (
                SELECT 1
                FROM projects pr
                WHERE pr.project_code = p_contract_project
                  AND pr.required_staff IS NOT NULL
                  AND lower(trim(pr.project_name)) = lower(trim(s.site_name))
              )
            )
        )
      )
    ELSE false
  END;
$$;


--
-- Name: client_can_view_roster_project(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_can_view_roster_project(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE current_user_role()
    WHEN 'client'::app_role THEN
      EXISTS (
        SELECT 1
        FROM sites s
        WHERE s.client_id = current_user_client_id()
          AND s.project_id = p_project_id
      )
      OR EXISTS (
        SELECT 1
        FROM sites s
        JOIN projects p ON p.id = p_project_id
        WHERE s.client_id = current_user_client_id()
          AND p.required_staff IS NOT NULL
          AND lower(trim(p.project_name)) = lower(trim(s.site_name))
      )
    ELSE false
  END;
$$;


--
-- Name: create_product_sale(date, text, text, text, uuid, numeric, numeric, numeric, text, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_product_sale(p_date date, p_invoice_no text, p_client_id text, p_customer_name text, p_product_id uuid, p_quantity numeric, p_unit_price numeric, p_amount_received numeric, p_payment_status text, p_due_date date, p_description text, p_notes text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_income_id UUID;
  v_expense_id UUID;
  v_current_stock NUMERIC(18, 4);
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_amount NUMERIC(18, 4);
  v_outstanding NUMERIC(18, 4);
  v_cogs_unit_cost NUMERIC(18, 4) := 0;
  v_cogs_amount NUMERIC(18, 4) := 0;
  v_cogs_receipt_no TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Unit price must be zero or greater';
  END IF;

  IF p_client_id IS NULL AND (p_customer_name IS NULL OR TRIM(p_customer_name) = '') THEN
    RAISE EXCEPTION 'Select a contract client or enter an other payer name';
  END IF;

  SELECT current_stock, product_name, unit_of_measure
  INTO v_current_stock, v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  IF v_current_stock < p_quantity THEN
    RAISE EXCEPTION
      'Only % % of % in stock, cannot sell %',
      v_current_stock,
      v_unit_of_measure,
      v_product_name,
      p_quantity;
  END IF;

  v_amount := ROUND(p_quantity * p_unit_price, 4);
  v_outstanding := ROUND(v_amount - COALESCE(p_amount_received, 0), 4);

  SELECT COALESCE(
    ROUND(SUM(total_batch_cost) / NULLIF(SUM(quantity_produced), 0), 4),
    0
  )
  INTO v_cogs_unit_cost
  FROM production_batches
  WHERE finished_product_id = p_product_id;

  v_cogs_amount := ROUND(v_cogs_unit_cost * p_quantity, 4);
  v_cogs_receipt_no := 'COGS-' || TRIM(p_invoice_no);

  INSERT INTO income_register (
    date,
    invoice_no,
    client_id,
    customer_name,
    entry_type,
    service_category,
    description,
    amount,
    amount_received,
    outstanding_balance,
    payment_status,
    due_date,
    notes,
    product_id,
    sale_quantity,
    unit_price
  )
  VALUES (
    p_date,
    p_invoice_no,
    p_client_id,
    CASE WHEN p_client_id IS NULL THEN NULLIF(TRIM(p_customer_name), '') ELSE NULL END,
    'product_sale',
    NULL,
    COALESCE(
      NULLIF(TRIM(p_description), ''),
      'Product sale: ' || v_product_name || ' x ' || p_quantity || ' ' || v_unit_of_measure
    ),
    v_amount,
    COALESCE(p_amount_received, 0),
    v_outstanding,
    p_payment_status,
    p_due_date,
    p_notes,
    p_product_id,
    p_quantity,
    p_unit_price
  )
  RETURNING id INTO v_income_id;

  UPDATE finished_products
  SET
    current_stock = current_stock - p_quantity,
    updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes
  )
  VALUES (
    p_product_id,
    'sale_out',
    p_quantity,
    v_income_id,
    p_date,
    COALESCE(
      NULLIF(TRIM(p_notes), ''),
      'Product sale invoice ' || p_invoice_no
    )
  );

  INSERT INTO expense_register (
    date,
    expense_category,
    sub_category,
    description,
    vendor,
    price,
    quantity,
    amount,
    payment_method,
    approved_by,
    receipt_no,
    payment_status,
    notes
  )
  VALUES (
    p_date,
    'Cost of Goods Sold',
    'Product Sales',
    'Auto-posted COGS for product sale ' || p_invoice_no || ' (' || v_product_name || ')',
    'Internal',
    v_cogs_unit_cost,
    p_quantity,
    v_cogs_amount,
    'Internal',
    'System',
    v_cogs_receipt_no,
    'Paid',
    'Linked to income_register ' || v_income_id::TEXT
  )
  RETURNING id INTO v_expense_id;

  UPDATE income_register
  SET cogs_expense_id = v_expense_id
  WHERE id = v_income_id;

  RETURN v_income_id;
END;
$$;


--
-- Name: create_production_batch(text, date, uuid, numeric, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_production_batch(p_batch_number text, p_production_date date, p_finished_product_id uuid, p_quantity_produced numeric, p_notes text, p_materials jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_batch_id UUID;
  v_material JSONB;
  v_material_id UUID;
  v_quantity_used NUMERIC(18, 4);
  v_cost_at_time NUMERIC(18, 4);
  v_current_stock NUMERIC(18, 4);
  v_total_batch_cost NUMERIC(18, 4) := 0;
  v_cost_per_unit NUMERIC(18, 4);
BEGIN
  IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN
    RAISE EXCEPTION 'quantity_produced must be greater than zero';
  END IF;

  IF p_materials IS NULL OR jsonb_array_length(p_materials) = 0 THEN
    RAISE EXCEPTION 'At least one raw material is required for a production batch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM finished_products WHERE id = p_finished_product_id
  ) THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  -- Validate stock and accumulate cost before writing
  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::UUID;
    v_quantity_used := (v_material ->> 'quantity_used')::NUMERIC(18, 4);

    IF v_material_id IS NULL OR v_quantity_used IS NULL OR v_quantity_used <= 0 THEN
      RAISE EXCEPTION 'Each material line requires material_id and quantity_used > 0';
    END IF;

    SELECT current_stock, average_cost_per_unit
    INTO v_current_stock, v_cost_at_time
    FROM raw_materials
    WHERE id = v_material_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Raw material % not found', v_material_id;
    END IF;

    IF v_current_stock < v_quantity_used THEN
      RAISE EXCEPTION 'Insufficient stock for material %. Available: %, required: %',
        v_material_id, v_current_stock, v_quantity_used;
    END IF;

    v_total_batch_cost := v_total_batch_cost + ROUND(v_quantity_used * v_cost_at_time, 4);
  END LOOP;

  v_cost_per_unit := ROUND(v_total_batch_cost / p_quantity_produced, 4);

  INSERT INTO production_batches (
    batch_number,
    production_date,
    finished_product_id,
    quantity_produced,
    cost_per_unit_produced,
    total_batch_cost,
    notes
  )
  VALUES (
    p_batch_number,
    p_production_date,
    p_finished_product_id,
    p_quantity_produced,
    v_cost_per_unit,
    v_total_batch_cost,
    p_notes
  )
  RETURNING id INTO v_batch_id;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::UUID;
    v_quantity_used := (v_material ->> 'quantity_used')::NUMERIC(18, 4);

    SELECT average_cost_per_unit
    INTO v_cost_at_time
    FROM raw_materials
    WHERE id = v_material_id;

    INSERT INTO production_batch_materials (
      batch_id,
      material_id,
      quantity_used,
      cost_at_time
    )
    VALUES (
      v_batch_id,
      v_material_id,
      v_quantity_used,
      v_cost_at_time
    );

    UPDATE raw_materials
    SET
      current_stock = current_stock - v_quantity_used,
      updated_at = now()
    WHERE id = v_material_id;
  END LOOP;

  UPDATE finished_products
  SET
    current_stock = current_stock + p_quantity_produced,
    updated_at = now()
  WHERE id = p_finished_product_id;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes
  )
  VALUES (
    p_finished_product_id,
    'production_in',
    p_quantity_produced,
    v_batch_id,
    p_production_date,
    COALESCE(p_notes, 'Production batch ' || p_batch_number)
  );

  RETURN v_batch_id;
END;
$$;


--
-- Name: create_raw_material_purchase_payable(uuid, uuid, date, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_raw_material_purchase_payable(p_purchase_id uuid, p_material_id uuid, p_purchase_date date, p_supplier text, p_total_cost numeric) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_payable_id UUID;
  v_invoice_no TEXT;
BEGIN
  v_invoice_no := 'RMP-' || LEFT(p_purchase_id::TEXT, 8);

  INSERT INTO accounts_payable (
    vendor_name,
    invoice_number,
    expense_category,
    sub_category,
    description,
    invoice_date,
    due_date,
    amount,
    amount_paid,
    balance_due,
    status,
    notes
  )
  VALUES (
    COALESCE(NULLIF(TRIM(p_supplier), ''), 'Raw Material Supplier'),
    v_invoice_no,
    'Direct Operational',
    'Raw Materials',
    'Raw material purchase posted to inventory',
    p_purchase_date,
    p_purchase_date + INTERVAL '30 days',
    p_total_cost,
    0,
    p_total_cost,
    'Outstanding',
    'Linked to raw_material_purchases ' || p_purchase_id::TEXT
  )
  RETURNING id INTO v_payable_id;

  UPDATE raw_material_purchases
  SET accounts_payable_id = v_payable_id
  WHERE id = p_purchase_id;

  RETURN v_payable_id;
END;
$$;


--
-- Name: current_leave_approver_auth_uid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_leave_approver_auth_uid() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT approver_user_account_id
  FROM leave_approver_config
  ORDER BY effective_from DESC, created_at DESC
  LIMIT 1;
$$;


--
-- Name: current_user_client_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_client_id() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT client_id
  FROM user_accounts
  WHERE auth_uid = auth.uid()
    AND is_active IS NOT FALSE;
$$;


--
-- Name: current_user_employee_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_employee_id() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT employee_id
  FROM user_accounts
  WHERE auth_uid = auth.uid()
    AND is_active IS NOT FALSE;
$$;


--
-- Name: current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_role() RETURNS public.app_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role
  FROM user_accounts
  WHERE auth_uid = auth.uid()
    AND is_active IS NOT FALSE;
$$;


--
-- Name: current_user_staff_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_staff_id() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT e.staff_id
  FROM user_accounts ua
  JOIN employees e ON e.employee_id = ua.employee_id
  WHERE ua.auth_uid = auth.uid()
    AND ua.is_active IS NOT FALSE;
$$;


--
-- Name: current_user_supervisor_site_codes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_supervisor_site_codes() RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT site_code
  FROM user_account_supervisor_sites
  WHERE auth_uid = auth.uid();
$$;


--
-- Name: delete_finished_product_cascade(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_finished_product_cascade(p_product_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_sale RECORD;
  v_consumption RECORD;
  v_batch RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM finished_products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Finished product % not found', p_product_id;
  END IF;

  FOR v_sale IN
    SELECT id, sale_status
    FROM income_register
    WHERE product_id = p_product_id
      AND entry_type = 'product_sale'
    ORDER BY date, id
  LOOP
    IF v_sale.sale_status IS DISTINCT FROM 'voided' THEN
      PERFORM void_product_sale(v_sale.id);
    END IF;
  END LOOP;

  FOR v_sale IN
    SELECT id, cogs_expense_id, cogs_reversal_expense_id
    FROM income_register
    WHERE product_id = p_product_id
      AND entry_type = 'product_sale'
  LOOP
    DELETE FROM stock_movements
    WHERE reference_id = v_sale.id;

    UPDATE income_register
    SET cogs_expense_id = NULL,
        cogs_reversal_expense_id = NULL
    WHERE id = v_sale.id;

    IF v_sale.cogs_reversal_expense_id IS NOT NULL THEN
      DELETE FROM expense_register WHERE id = v_sale.cogs_reversal_expense_id;
    END IF;
    IF v_sale.cogs_expense_id IS NOT NULL THEN
      DELETE FROM expense_register WHERE id = v_sale.cogs_expense_id;
    END IF;

    DELETE FROM income_register WHERE id = v_sale.id;
  END LOOP;

  FOR v_consumption IN
    SELECT id, expense_register_id
    FROM internal_consumption
    WHERE product_id = p_product_id
    ORDER BY consumption_date, id
  LOOP
    DELETE FROM stock_movements WHERE reference_id = v_consumption.id;

    UPDATE internal_consumption
    SET expense_register_id = NULL
    WHERE id = v_consumption.id;

    IF v_consumption.expense_register_id IS NOT NULL THEN
      DELETE FROM expense_register WHERE id = v_consumption.expense_register_id;
    END IF;

    DELETE FROM internal_consumption WHERE id = v_consumption.id;
  END LOOP;

  FOR v_batch IN
    SELECT id
    FROM production_batches
    WHERE finished_product_id = p_product_id
    ORDER BY production_date, id
  LOOP
    DELETE FROM production_batch_materials WHERE batch_id = v_batch.id;
    DELETE FROM stock_movements WHERE reference_id = v_batch.id;
    DELETE FROM production_batches WHERE id = v_batch.id;
  END LOOP;

  DELETE FROM stock_movements WHERE product_id = p_product_id;
  DELETE FROM finished_products WHERE id = p_product_id;
END;
$$;


--
-- Name: delete_raw_material_cascade(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_raw_material_cascade(p_material_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_purchase RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM raw_materials WHERE id = p_material_id) THEN
    RAISE EXCEPTION 'Raw material % not found', p_material_id;
  END IF;

  FOR v_purchase IN
    SELECT id, accounts_payable_id
    FROM raw_material_purchases
    WHERE material_id = p_material_id
    ORDER BY created_at, id
  LOOP
    PERFORM reverse_raw_material_purchase_payable(v_purchase.accounts_payable_id);
    DELETE FROM raw_material_purchases
    WHERE id = v_purchase.id;
  END LOOP;

  DELETE FROM production_batch_materials
  WHERE material_id = p_material_id;

  DELETE FROM raw_materials
  WHERE id = p_material_id;
END;
$$;


--
-- Name: delete_raw_material_purchase(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_raw_material_purchase(p_purchase_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_purchase raw_material_purchases%ROWTYPE;
BEGIN
  SELECT *
  INTO v_purchase
  FROM raw_material_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material purchase % not found', p_purchase_id;
  END IF;

  PERFORM assert_raw_material_stock_not_negative(
    v_purchase.material_id,
    p_exclude_purchase_id => p_purchase_id
  );

  PERFORM reverse_raw_material_purchase_payable(v_purchase.accounts_payable_id);

  DELETE FROM raw_material_purchases
  WHERE id = p_purchase_id;

  PERFORM recalculate_raw_material_inventory(v_purchase.material_id);
END;
$$;


--
-- Name: finished_product_weighted_avg_cost(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finished_product_weighted_avg_cost(p_product_id uuid) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(
    ROUND(SUM(total_batch_cost) / NULLIF(SUM(quantity_produced), 0), 4),
    0
  )
  FROM production_batches
  WHERE finished_product_id = p_product_id;
$$;


--
-- Name: get_duty_roster_employee_display(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_duty_roster_employee_display() RETURNS TABLE(employee_id text, staff_id text, full_name text, "position" text, shift text, contract_project text, employment_status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    e.employee_id,
    e.staff_id,
    e.full_name,
    e."position",
    e.shift,
    e.contract_project,
    e.employment_status
  FROM employees e
  WHERE
    can_view_duty_roster_company_wide()
    OR can_access_employee_record(e.assigned_site_id)
    OR e.employee_id = current_user_employee_id()
  ORDER BY e.staff_id ASC;
$$;


--
-- Name: is_assigned_leave_approver(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_assigned_leave_approver(p_approver_auth_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT auth.uid() = p_approver_auth_uid;
$$;


--
-- Name: is_cash_payment_method(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_cash_payment_method(p_method text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT NOT is_credit_payment_method(p_method);
$$;


--
-- Name: is_credit_payment_method(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_credit_payment_method(p_method text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN normalize_payment_method_text(p_method) = '' THEN FALSE
    WHEN normalize_payment_method_text(p_method) ~ '(credit|on account|on-account|accounts payable|supplier credit)'
      THEN TRUE
    ELSE FALSE
  END;
$$;


--
-- Name: is_current_leave_approver(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_current_leave_approver() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT auth.uid() = current_leave_approver_auth_uid();
$$;


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT current_user_role() = 'super_admin'::app_role;
$$;


--
-- Name: normalize_payment_method_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_payment_method_text(p_method text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(TRIM(COALESCE(p_method, '')), '\s+', ' ', 'g'),
      E'[\u2013\u2014]',
      '-',
      'g'
    )
  );
$$;


--
-- Name: post_raw_material_purchase_finance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_raw_material_purchase_finance() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_go_live DATE;
  v_material_name TEXT;
  v_payable_id UUID;
  v_invoice_no TEXT;
BEGIN
  SELECT go_live_date
  INTO v_go_live
  FROM inventory_balance_config
  WHERE id = 1;

  IF v_go_live IS NULL OR NEW.purchase_date < v_go_live THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method IS NULL OR TRIM(NEW.payment_method) = '' THEN
    RAISE EXCEPTION 'Payment method is required for raw material purchases';
  END IF;

  SELECT material_name
  INTO v_material_name
  FROM raw_materials
  WHERE id = NEW.material_id;

  IF is_credit_payment_method(NEW.payment_method) THEN
    v_invoice_no := 'RMP-' || LEFT(NEW.id::TEXT, 8);

    INSERT INTO accounts_payable (
      vendor_name,
      invoice_number,
      expense_category,
      sub_category,
      description,
      invoice_date,
      due_date,
      amount,
      amount_paid,
      balance_due,
      status,
      notes
    )
    VALUES (
      COALESCE(NULLIF(TRIM(NEW.supplier), ''), 'Raw Material Supplier'),
      v_invoice_no,
      'Direct Operational',
      'Raw Materials',
      'Raw material purchase posted to inventory',
      NEW.purchase_date,
      NEW.purchase_date + INTERVAL '30 days',
      NEW.total_cost,
      0,
      NEW.total_cost,
      'Outstanding',
      'Linked to raw_material_purchases ' || NEW.id::TEXT
    )
    RETURNING id INTO v_payable_id;

    UPDATE raw_material_purchases
    SET accounts_payable_id = v_payable_id
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: prevent_locked_payroll_edit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_locked_payroll_edit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if OLD.locked = true then
    raise exception 'This payroll record is locked and cannot be changed. Process corrections as an adjustment in a later month.';
  end if;
  return NEW;
end;
$$;


--
-- Name: prevent_roster_history_edit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_roster_history_edit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'Roster History is append-only. Existing rows can never be edited or deleted.';
end;
$$;


--
-- Name: preview_finished_product_delete(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preview_finished_product_delete(p_product_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_name TEXT;
  v_sale_count INTEGER := 0;
  v_consumption_count INTEGER := 0;
  v_stock_movement_count INTEGER := 0;
  v_batch_count INTEGER := 0;
BEGIN
  SELECT product_name
  INTO v_name
  FROM finished_products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product % not found', p_product_id;
  END IF;

  SELECT COUNT(*)
  INTO v_sale_count
  FROM income_register
  WHERE product_id = p_product_id
    AND entry_type = 'product_sale';

  SELECT COUNT(*)
  INTO v_consumption_count
  FROM internal_consumption
  WHERE product_id = p_product_id;

  SELECT COUNT(*)
  INTO v_stock_movement_count
  FROM stock_movements
  WHERE product_id = p_product_id;

  SELECT COUNT(*)
  INTO v_batch_count
  FROM production_batches
  WHERE finished_product_id = p_product_id;

  RETURN jsonb_build_object(
    'product_name', v_name,
    'sale_count', v_sale_count,
    'consumption_count', v_consumption_count,
    'stock_movement_count', v_stock_movement_count,
    'batch_count', v_batch_count
  );
END;
$$;


--
-- Name: preview_raw_material_delete(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preview_raw_material_delete(p_material_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_name TEXT;
  v_purchase_count INTEGER := 0;
  v_batch_material_count INTEGER := 0;
  v_incomplete_batches JSONB := '[]'::JSONB;
BEGIN
  SELECT material_name
  INTO v_name
  FROM raw_materials
  WHERE id = p_material_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material % not found', p_material_id;
  END IF;

  SELECT COUNT(*)
  INTO v_purchase_count
  FROM raw_material_purchases
  WHERE material_id = p_material_id;

  SELECT COUNT(*)
  INTO v_batch_material_count
  FROM production_batch_materials
  WHERE material_id = p_material_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'batch_number', pb.batch_number,
        'remaining_material_count', other_materials.cnt - 1
      )
      ORDER BY pb.batch_number
    ),
    '[]'::JSONB
  )
  INTO v_incomplete_batches
  FROM production_batch_materials pbm
  JOIN production_batches pb ON pb.id = pbm.batch_id
  JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS cnt
    FROM production_batch_materials x
    WHERE x.batch_id = pbm.batch_id
  ) other_materials ON TRUE
  WHERE pbm.material_id = p_material_id
    AND other_materials.cnt = 1;

  RETURN jsonb_build_object(
    'material_name', v_name,
    'purchase_count', v_purchase_count,
    'batch_material_count', v_batch_material_count,
    'incomplete_batches', v_incomplete_batches
  );
END;
$$;


--
-- Name: recalculate_raw_material_inventory(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_raw_material_inventory(p_material_id uuid) RETURNS TABLE(current_stock numeric, average_cost_per_unit numeric)
    LANGUAGE plpgsql
    AS $$
DECLARE v_purchased_qty NUMERIC(18,4):=0; v_purchased_value NUMERIC(18,4):=0; v_consumed_qty NUMERIC(18,4):=0; v_new_stock NUMERIC(18,4):=0; v_new_avg NUMERIC(18,4):=0; v_purchase RECORD;
BEGIN
  FOR v_purchase IN SELECT quantity, cost_per_unit FROM raw_material_purchases WHERE material_id = p_material_id ORDER BY created_at, id LOOP
    v_purchased_qty := v_purchased_qty + v_purchase.quantity;
    v_purchased_value := v_purchased_value + ROUND(v_purchase.quantity * v_purchase.cost_per_unit, 4);
  END LOOP;
  SELECT COALESCE(SUM(quantity_used),0) INTO v_consumed_qty FROM production_batch_materials WHERE material_id = p_material_id;
  v_new_stock := v_purchased_qty - v_consumed_qty;
  IF v_purchased_qty > 0 THEN v_new_avg := ROUND(v_purchased_value / v_purchased_qty, 4); ELSE v_new_avg := 0; END IF;
  UPDATE raw_materials SET current_stock = v_new_stock, average_cost_per_unit = v_new_avg, updated_at = now() WHERE id = p_material_id;
  current_stock := v_new_stock; average_cost_per_unit := v_new_avg; RETURN NEXT;
END; $$;


--
-- Name: reject_leave_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_leave_request(p_request_id uuid, p_decision_notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_request leave_requests%ROWTYPE;
BEGIN
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request % not found', p_request_id;
  END IF;

  IF v_request.status <> 'Pending' THEN
    RAISE EXCEPTION 'Only pending leave requests can be rejected';
  END IF;

  IF NOT is_assigned_leave_approver(v_request.approver_user_account_id)
     AND NOT can_manage_leave_balances() THEN
    RAISE EXCEPTION 'You are not authorized to reject this leave request';
  END IF;

  UPDATE leave_requests
  SET
    status = 'Rejected',
    decided_at = now(),
    decision_notes = NULLIF(TRIM(p_decision_notes), '')
  WHERE id = p_request_id;
END;
$$;


--
-- Name: reverse_raw_material_purchase_payable(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_raw_material_purchase_payable(p_payable_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF p_payable_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM accounts_payable
    WHERE id = p_payable_id
      AND COALESCE(amount_paid, 0) > 0
  ) THEN
    RAISE EXCEPTION
      'Cannot reverse accounts payable — partial or full payment has already been recorded';
  END IF;

  DELETE FROM accounts_payable
  WHERE id = p_payable_id;
END;
$$;


--
-- Name: submit_leave_request(uuid, date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_leave_request(p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_employee_id TEXT;
  v_days NUMERIC(8, 2);
  v_approver UUID;
  v_year INTEGER;
  v_remaining NUMERIC(8, 2);
  v_exceeds BOOLEAN := false;
  v_request_id UUID;
BEGIN
  IF current_user_role() <> 'employee'::app_role THEN
    RAISE EXCEPTION 'Only employee-role users can submit leave requests';
  END IF;

  v_employee_id := current_user_employee_id();
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Your user account is not linked to an employee record';
  END IF;

  v_days := calculate_leave_days(p_start_date, p_end_date);
  IF v_days <= 0 THEN
    RAISE EXCEPTION 'Invalid leave date range';
  END IF;

  v_approver := current_leave_approver_auth_uid();
  IF v_approver IS NULL THEN
    RAISE EXCEPTION 'No leave approver is configured';
  END IF;

  v_year := EXTRACT(YEAR FROM p_start_date)::INTEGER;

  SELECT days_remaining
  INTO v_remaining
  FROM employee_leave_balances
  WHERE employee_id = v_employee_id
    AND leave_type_id = p_leave_type_id
    AND year = v_year;

  IF v_remaining IS NOT NULL AND v_days > v_remaining THEN
    v_exceeds := true;
  END IF;

  INSERT INTO leave_requests (
    employee_id,
    leave_type_id,
    start_date,
    end_date,
    days_requested,
    reason,
    status,
    approver_user_account_id,
    exceeds_balance
  )
  VALUES (
    v_employee_id,
    p_leave_type_id,
    p_start_date,
    p_end_date,
    v_days,
    NULLIF(TRIM(p_reason), ''),
    'Pending',
    v_approver,
    v_exceeds
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;


--
-- Name: sync_raw_material_purchase_payable(uuid, uuid, date, text, text, numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_raw_material_purchase_payable(p_purchase_id uuid, p_material_id uuid, p_purchase_date date, p_supplier text, p_payment_method text, p_total_cost numeric, p_existing_payable_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_go_live DATE;
  v_should_post BOOLEAN;
  v_new_credit BOOLEAN;
  v_amount_paid NUMERIC(18, 4);
BEGIN
  SELECT go_live_date
  INTO v_go_live
  FROM inventory_balance_config
  WHERE id = 1;

  v_should_post := v_go_live IS NOT NULL AND p_purchase_date >= v_go_live;
  v_new_credit := is_credit_payment_method(p_payment_method);

  IF NOT v_should_post OR NOT v_new_credit THEN
    PERFORM reverse_raw_material_purchase_payable(p_existing_payable_id);
    UPDATE raw_material_purchases
    SET accounts_payable_id = NULL
    WHERE id = p_purchase_id;
    RETURN;
  END IF;

  IF p_existing_payable_id IS NULL THEN
    PERFORM create_raw_material_purchase_payable(
      p_purchase_id,
      p_material_id,
      p_purchase_date,
      p_supplier,
      p_total_cost
    );
    RETURN;
  END IF;

  SELECT COALESCE(amount_paid, 0)
  INTO v_amount_paid
  FROM accounts_payable
  WHERE id = p_existing_payable_id;

  IF v_amount_paid > p_total_cost THEN
    RAISE EXCEPTION
      'Cannot reduce purchase total below amount already paid on accounts payable (GHS %)',
      v_amount_paid;
  END IF;

  UPDATE accounts_payable
  SET
    vendor_name = COALESCE(NULLIF(TRIM(p_supplier), ''), 'Raw Material Supplier'),
    invoice_date = p_purchase_date,
    due_date = p_purchase_date + INTERVAL '30 days',
    amount = p_total_cost,
    balance_due = p_total_cost - v_amount_paid,
    status = CASE
      WHEN v_amount_paid >= p_total_cost THEN 'Paid'
      WHEN v_amount_paid > 0 THEN 'Partial'
      ELSE 'Outstanding'
    END
  WHERE id = p_existing_payable_id;
END;
$$;


--
-- Name: update_raw_material_purchase(uuid, date, numeric, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_raw_material_purchase(p_purchase_id uuid, p_purchase_date date, p_quantity numeric, p_cost_per_unit numeric, p_supplier text, p_payment_method text, p_notes text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_purchase raw_material_purchases%ROWTYPE;
  v_total_cost NUMERIC(18, 4);
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Purchase quantity must be greater than zero';
  END IF;

  IF p_cost_per_unit IS NULL OR p_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'Cost per unit must be zero or greater';
  END IF;

  IF p_payment_method IS NULL OR TRIM(p_payment_method) = '' THEN
    RAISE EXCEPTION 'Payment method is required for raw material purchases';
  END IF;

  SELECT *
  INTO v_purchase
  FROM raw_material_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material purchase % not found', p_purchase_id;
  END IF;

  v_total_cost := ROUND(p_quantity * p_cost_per_unit, 4);

  PERFORM assert_raw_material_stock_not_negative(
    v_purchase.material_id,
    p_override_purchase_id => p_purchase_id,
    p_override_quantity => p_quantity,
    p_action => 'save'
  );

  PERFORM sync_raw_material_purchase_payable(
    p_purchase_id,
    v_purchase.material_id,
    p_purchase_date,
    p_supplier,
    p_payment_method,
    v_total_cost,
    v_purchase.accounts_payable_id
  );

  UPDATE raw_material_purchases
  SET
    purchase_date = p_purchase_date,
    quantity = p_quantity,
    cost_per_unit = p_cost_per_unit,
    total_cost = v_total_cost,
    supplier = NULLIF(TRIM(p_supplier), ''),
    payment_method = TRIM(p_payment_method),
    notes = NULLIF(TRIM(p_notes), '')
  WHERE id = p_purchase_id;

  PERFORM recalculate_raw_material_inventory(v_purchase.material_id);
END;
$$;


--
-- Name: validate_internal_consumption(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_internal_consumption() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_current_stock NUMERIC(18, 4);
  v_product_name TEXT;
  v_unit_of_measure TEXT;
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT current_stock, product_name, unit_of_measure
  INTO v_current_stock, v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = NEW.product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  IF v_current_stock < NEW.quantity THEN
    RAISE EXCEPTION
      'Only % % of % in stock, cannot record use of %',
      v_current_stock,
      v_unit_of_measure,
      v_product_name,
      NEW.quantity;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: void_product_sale(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_product_sale(p_income_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_sale income_register%ROWTYPE;
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_cogs_amount NUMERIC(18, 4) := 0;
  v_cogs_unit_cost NUMERIC(18, 4) := 0;
  v_reversal_expense_id UUID;
  v_reversal_receipt_no TEXT;
BEGIN
  SELECT *
  INTO v_sale
  FROM income_register
  WHERE id = p_income_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product sale not found';
  END IF;

  IF v_sale.entry_type IS DISTINCT FROM 'product_sale' THEN
    RAISE EXCEPTION 'Only product sale entries can be voided';
  END IF;

  IF v_sale.sale_status = 'voided' THEN
    RAISE EXCEPTION 'Product sale % is already voided', v_sale.invoice_no;
  END IF;

  IF v_sale.product_id IS NULL OR v_sale.sale_quantity IS NULL OR v_sale.sale_quantity <= 0 THEN
    RAISE EXCEPTION 'Product sale % is missing product quantity details', v_sale.invoice_no;
  END IF;

  SELECT product_name, unit_of_measure
  INTO v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = v_sale.product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found for sale %', v_sale.invoice_no;
  END IF;

  IF v_sale.cogs_expense_id IS NOT NULL THEN
    SELECT amount, price
    INTO v_cogs_amount, v_cogs_unit_cost
    FROM expense_register
    WHERE id = v_sale.cogs_expense_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked COGS expense not found for sale %', v_sale.invoice_no;
    END IF;
  END IF;

  UPDATE finished_products
  SET
    current_stock = current_stock + v_sale.sale_quantity,
    updated_at = now()
  WHERE id = v_sale.product_id;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes
  )
  VALUES (
    v_sale.product_id,
    'adjustment',
    v_sale.sale_quantity,
    v_sale.id,
    COALESCE(v_sale.date, CURRENT_DATE),
    'Reversal of voided sale ' || v_sale.invoice_no
  );

  IF v_sale.cogs_expense_id IS NOT NULL AND v_cogs_amount <> 0 THEN
    v_reversal_receipt_no := 'VOID-COGS-' || TRIM(v_sale.invoice_no);

    INSERT INTO expense_register (
      date,
      expense_category,
      sub_category,
      description,
      vendor,
      price,
      quantity,
      amount,
      payment_method,
      approved_by,
      receipt_no,
      payment_status,
      notes
    )
    VALUES (
      CURRENT_DATE,
      'Cost of Goods Sold',
      'Product Sales',
      'COGS reversal for voided product sale ' || v_sale.invoice_no || ' (' || v_product_name || ')',
      'Internal',
      -ABS(v_cogs_unit_cost),
      v_sale.sale_quantity,
      -ABS(v_cogs_amount),
      'Internal',
      'System',
      v_reversal_receipt_no,
      'Paid',
      'Reversal of expense_register ' || v_sale.cogs_expense_id::TEXT
        || ' linked to voided income_register ' || v_sale.id::TEXT
    )
    RETURNING id INTO v_reversal_expense_id;
  END IF;

  UPDATE income_register
  SET
    sale_status = 'voided',
    voided_at = now(),
    cogs_reversal_expense_id = v_reversal_expense_id
  WHERE id = v_sale.id;
END;
$$;


--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
    -- Regclass of the table e.g. public.notes
    entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

    -- I, U, D, T: insert, update ...
    action realtime.action = (
        case wal ->> 'action'
            when 'I' then 'INSERT'
            when 'U' then 'UPDATE'
            when 'D' then 'DELETE'
            else 'ERROR'
        end
    );

    -- Is row level security enabled for the table
    is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

    subscriptions realtime.subscription[] = array_agg(subs)
        from
            realtime.subscription subs
        where
            subs.entity = entity_
            -- Filter by action early - only get subscriptions interested in this action
            -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
            and (subs.action_filter = '*' or subs.action_filter = action::text);

    -- Subscription vars
    working_role regrole;
    working_selected_columns text[];
    claimed_role regrole;
    claims jsonb;

    subscription_id uuid;
    subscription_has_access bool;
    visible_to_subscription_ids uuid[] = '{}';

    -- structured info for wal's columns
    columns realtime.wal_column[];
    -- previous identity values for update/delete
    old_columns realtime.wal_column[];

    error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

    -- Primary jsonb output for record
    output jsonb;

    -- Loop record for iterating unique roles (outer loop)
    role_record record;
    -- Loop record for iterating unique selected_columns within a role (inner loop)
    cols_record record;
    -- Subscription ids visible at the role level (before fanning out by selected_columns)
    visible_role_sub_ids uuid[] = '{}';

begin
    perform set_config('role', null, true);

    columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'columns') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    old_columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'identity') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    for role_record in
        select claims_role
        from (select distinct claims_role from unnest(subscriptions)) t
        order by claims_role::text
    loop
        working_role := role_record.claims_role;

        -- Update `is_selectable` for columns and old_columns (once per role)
        columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(columns) c;

        old_columns =
                array_agg(
                    (
                        c.name,
                        c.type_name,
                        c.type_oid,
                        c.value,
                        c.is_pkey,
                        pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                    )::realtime.wal_column
                )
                from
                    unnest(old_columns) c;

        if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
            -- Fan out 400 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 400: Bad Request, no primary key']
                )::realtime.wal_rls;
            end loop;

        -- The claims role does not have SELECT permission to the primary key of entity
        elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
            -- Fan out 401 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 401: Unauthorized']
                )::realtime.wal_rls;
            end loop;

        else
            -- Create the prepared statement (once per role)
            if is_rls_enabled and action <> 'DELETE' then
                if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                    deallocate walrus_rls_stmt;
                end if;
                execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
            end if;

            -- Collect all visible subscription IDs for this role (filter check + RLS check)
            visible_role_sub_ids = '{}';

            for subscription_id, claims in (
                    select
                        subs.subscription_id,
                        subs.claims
                    from
                        unnest(subscriptions) subs
                    where
                        subs.entity = entity_
                        and subs.claims_role = working_role
                        and (
                            realtime.is_visible_through_filters(columns, subs.filters)
                            or (
                              action = 'DELETE'
                              and realtime.is_visible_through_filters(old_columns, subs.filters)
                            )
                        )
            ) loop

                if not is_rls_enabled or action = 'DELETE' then
                    visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                else
                    -- Check if RLS allows the role to see the record
                    perform
                        -- Trim leading and trailing quotes from working_role because set_config
                        -- doesn't recognize the role as valid if they are included
                        set_config('role', trim(both '"' from working_role::text), true),
                        set_config('request.jwt.claims', claims::text, true);

                    execute 'execute walrus_rls_stmt' into subscription_has_access;

                    -- Reset the role on every FOR..LOOP batch execution.
                    -- The first batch of 10 rows is pre-fetched using the current connection role (PG internal behaviour)
                    -- then we have to reset it again otherwise it would use the role defined in the `set_config` above
                    -- to fetch the remaining rows when rows>10, which could be a user-defined role that lacks execution grants.
                    -- The flow is:
                    --   1. run batch with conn role
                    --   2. set_config working_role
                    --   3. execute walrus
                    --   4. reset role (revert)
                    --   5. repeat
                    perform set_config('role', null, true);

                    if subscription_has_access then
                        visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                    end if;
                end if;
            end loop;

            perform set_config('role', null, true);

            -- Inner loop: per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;

                output = jsonb_build_object(
                    'schema', wal ->> 'schema',
                    'table', wal ->> 'table',
                    'type', action,
                    'commit_timestamp', to_char(
                        ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    ),
                    'columns', (
                        select
                            jsonb_agg(
                                jsonb_build_object(
                                    'name', pa.attname,
                                    'type', pt.typname
                                )
                                order by pa.attnum asc
                            )
                        from
                            pg_attribute pa
                            join pg_type pt
                                on pa.atttypid = pt.oid
                            left join (
                                select unnest(conkey) as pkey_attnum
                                from pg_constraint
                                where conrelid = entity_ and contype = 'p'
                            ) pk on pk.pkey_attnum = pa.attnum
                        where
                            attrelid = entity_
                            and attnum > 0
                            and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
                            and (working_selected_columns is null or pa.attname = any(working_selected_columns) or pk.pkey_attnum is not null)
                    )
                )
                -- Add "record" key for insert and update
                || case
                    when action in ('INSERT', 'UPDATE') then
                        jsonb_build_object(
                            'record',
                            (
                                select
                                    jsonb_object_agg(
                                        -- if unchanged toast, get column name and value from old record
                                        coalesce((c).name, (oc).name),
                                        case
                                            when (c).name is null then (oc).value
                                            else (c).value
                                        end
                                    )
                                from
                                    unnest(columns) c
                                    full outer join unnest(old_columns) oc
                                        on (c).name = (oc).name
                                where
                                    coalesce((c).is_selectable, (oc).is_selectable)
                                    and (working_selected_columns is null or coalesce((c).name, (oc).name) = any(working_selected_columns) or coalesce((c).is_pkey, (oc).is_pkey))
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            )
                        )
                    else '{}'::jsonb
                end
                -- Add "old_record" key for update and delete
                || case
                    when action = 'UPDATE' then
                        jsonb_build_object(
                                'old_record',
                                (
                                    select jsonb_object_agg((c).name, (c).value)
                                    from unnest(old_columns) c
                                    where
                                        (c).is_selectable
                                        and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                        and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                )
                            )
                    when action = 'DELETE' then
                        jsonb_build_object(
                            'old_record',
                            (
                                select jsonb_object_agg((c).name, (c).value)
                                from unnest(old_columns) c
                                where
                                    (c).is_selectable
                                    and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                    and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                            )
                        )
                    else '{}'::jsonb
                end;

                -- Filter visible_role_sub_ids to those matching the current selected_columns group
                visible_to_subscription_ids = coalesce(
                    (
                        select array_agg(s.subscription_id)
                        from unnest(subscriptions) s
                        where s.claims_role = working_role
                          and (s.selected_columns is not distinct from working_selected_columns)
                          and s.subscription_id = any(visible_role_sub_ids)
                    ),
                    '{}'::uuid[]
                );

                return next (
                    output,
                    is_rls_enabled,
                    visible_to_subscription_ids,
                    case
                        when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                        else '{}'
                    end
                )::realtime.wal_rls;
            end loop;

        end if;
    end loop;

    perform set_config('role', null, true);
end;
$$;


--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
/*
Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
*/
declare
    op_symbol text = (
        case
            when op = 'eq' then '='
            when op = 'neq' then '!='
            when op = 'lt' then '<'
            when op = 'lte' then '<='
            when op = 'gt' then '>'
            when op = 'gte' then '>='
            when op = 'in' then '= any'
            else 'UNKNOWN OP'
        end
    );
    res boolean;
begin
    execute format(
        'select %L::'|| type_::text || ' ' || op_symbol
        || ' ( %L::'
        || (
            case
                when op = 'in' then type_::text || '[]'
                else type_::text end
        )
        || ')', val_1, val_2) into res;
    return res;
end;
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
declare
    op_symbol text;
    res boolean;
begin
    -- IS DISTINCT FROM / IS NOT DISTINCT FROM: infix, both sides typed literals
    if op = 'isdistinct' then
        execute format(
            'select %L::%s %s %L::%s',
            val_1,
            type_::text,
            case when negate then 'IS NOT DISTINCT FROM' else 'IS DISTINCT FROM' end,
            val_2,
            type_::text
        ) into res;
        return res;
    end if;

    -- IS requires a keyword RHS (NULL, TRUE, FALSE, UNKNOWN), not a typed literal
    if op = 'is' then
        if val_2 not in ('null', 'true', 'false', 'unknown') then
            raise exception 'invalid value for is filter: must be null, true, false, or unknown';
        end if;
        execute format(
            'select %L::%s %s %s',
            val_1,
            type_::text,
            case when negate then 'IS NOT' else 'IS' end,
            upper(val_2)
        ) into res;
        return res;
    end if;

    op_symbol = case
        when op = 'eq'    then '='
        when op = 'neq'   then '!='
        when op = 'lt'    then '<'
        when op = 'lte'   then '<='
        when op = 'gt'    then '>'
        when op = 'gte'   then '>='
        when op = 'in'    then '= any'
        when op = 'like'   then 'LIKE'
        when op = 'ilike'  then 'ILIKE'
        when op = 'match'  then '~'
        when op = 'imatch' then '~*'
        else null
    end;

    if op_symbol is null then
        raise exception 'unsupported equality operator: %', op::text;
    end if;

    execute format(
        'select %L::%s %s (%L::%s)',
        val_1,
        type_::text,
        op_symbol,
        val_2,
        case when op = 'in' then type_::text || '[]' else type_::text end
    ) into res;

    return case when negate then not res else res end;
end;
$$;


--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    select
        filters is null
        or array_length(filters, 1) is null
        or coalesce(
            count(col.name) = count(1)
            and sum(
                realtime.check_equality_op(
                    op:=f.op,
                    type_:=coalesce(col.type_oid::regtype, col.type_name::regtype),
                    val_1:=col.value #>> '{}',
                    val_2:=f.value,
                    negate:=coalesce(f.negate, false)
                )::int
            ) filter (where col.name is not null) = count(col.name),
            false
        )
    from
        unnest(filters) f
        left join unnest(columns) col
            on f.column_name = col.name;
$$;


--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT
    realtime.wal2json_escape_identifier(nsp.nspname::text)
    || '.'
    || realtime.wal2json_escape_identifier(pc.relname::text)
  FROM pg_class pc
  JOIN pg_namespace nsp ON pc.relnamespace = nsp.oid
  WHERE pc.oid = entity
$$;


--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: send_binary(bytea, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send_binary(payload bytea, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, binary_payload, event, topic, private, extension)
    VALUES (generated_id, payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    col_names text[] = coalesce(
            array_agg(a.attname order by a.attnum),
            '{}'::text[]
        )
        from
            pg_catalog.pg_attribute a
        where
            a.attrelid = new.entity
            and a.attnum > 0
            and not a.attisdropped
            and pg_catalog.has_column_privilege(
                (new.claims ->> 'role'),
                a.attrelid,
                a.attnum,
                'SELECT'
            );
    filter realtime.user_defined_filter;
    col_type regtype;
    in_val jsonb;
    selected_col text;
begin
    for filter in select * from unnest(new.filters) loop
        if not filter.column_name = any(col_names) then
            raise exception 'invalid column for filter %', filter.column_name;
        end if;

        col_type = (
            select atttypid::regtype
            from pg_catalog.pg_attribute
            where attrelid = new.entity
                  and attname = filter.column_name
        );
        if col_type is null then
            raise exception 'failed to lookup type for column %', filter.column_name;
        end if;

        if filter.op = 'in'::realtime.equality_op then
            in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
            if coalesce(jsonb_array_length(in_val), 0) > 100 then
                raise exception 'too many values for `in` filter. Maximum 100';
            end if;
        elsif filter.op = 'is'::realtime.equality_op then
            -- `is` requires a keyword RHS rather than a typed literal
            if filter.value not in ('null', 'true', 'false', 'unknown') then
                raise exception 'invalid value for is filter: must be null, true, false, or unknown';
            end if;
            -- IS NULL works for any type, but IS TRUE/FALSE/UNKNOWN require a boolean
            -- operand. Reject the non-null keywords on non-boolean columns here so they
            -- don't abort apply_rls at WAL time.
            if filter.value <> 'null' and col_type <> 'boolean'::regtype then
                raise exception 'is % filter requires a boolean column, got %', filter.value, col_type::text;
            end if;
        elsif filter.op in ('like'::realtime.equality_op, 'ilike'::realtime.equality_op) then
            -- like/ilike apply the text pattern operator (~~); reject column types that
            -- have no such operator instead of failing at WAL time
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = '~~' and oprleft = col_type
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
        elsif filter.op in ('match'::realtime.equality_op, 'imatch'::realtime.equality_op) then
            -- match/imatch apply the regex operators ~ / ~*; reject column types that have
            -- no such operator (e.g. integer) instead of failing at WAL time, mirroring the
            -- like/ilike guard above.
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = case when filter.op = 'imatch'::realtime.equality_op then '~*' else '~' end
                  and oprleft = col_type
                  and oprright = col_type
                  and oprresult = 'boolean'::regtype
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
            -- validate the regex eagerly so a bad pattern is rejected here, not inside
            -- apply_rls where it would abort the WAL stream for the entity
            begin
                perform '' ~ filter.value;
            exception when others then
                raise exception 'invalid regular expression for % filter: %', filter.op::text, sqlerrm;
            end;
        else
            -- eq/neq/lt/lte/gt/gte: value must be coercable to the type
            perform realtime.cast(filter.value, col_type);
        end if;
    end loop;

    if new.selected_columns is not null then
        for selected_col in select * from unnest(new.selected_columns) loop
            if not selected_col = any(col_names) then
                raise exception 'invalid column for select %', selected_col;
            end if;
        end loop;
    end if;

    -- Apply consistent order to filters so the unique constraint can't be tricked by a
    -- different filter order. negate is part of the sort key.
    new.filters = coalesce(
        array_agg(f order by f.column_name, f.op, f.value, f.negate),
        '{}'
    ) from unnest(new.filters) f;

    new.selected_columns = (
        select array_agg(c order by c)
        from unnest(new.selected_columns) c
    );

    return new;
end;
$$;


--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


--
-- Name: wal2json_escape_identifier(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.wal2json_escape_identifier(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  -- Prefix `\`, `,`, `.`, and any whitespace with `\`
  SELECT regexp_replace(name, '([\\,.[:space:]])', '\\\1', 'g')
$$;


--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_claims_allowlist text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: accounts_payable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts_payable (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_name text NOT NULL,
    invoice_number text,
    expense_category text,
    sub_category text,
    description text,
    invoice_date date,
    due_date date,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(12,2) DEFAULT 0 NOT NULL,
    balance_due numeric(12,2),
    status text DEFAULT 'Outstanding'::text,
    notes text
);


--
-- Name: action_status_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_status_options (
    name text NOT NULL
);


--
-- Name: approvers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approvers (
    employee_id text NOT NULL
);


--
-- Name: asset_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_categories (
    name text NOT NULL
);


--
-- Name: asset_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_register (
    asset_id text NOT NULL,
    employee_id text,
    asset_name text NOT NULL,
    date_issued date,
    date_returned date,
    condition text
);


--
-- Name: attendance_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    staff_id text,
    employment_type text,
    project_assignment text,
    clock_in time without time zone,
    clock_out time without time zone,
    hours_worked numeric(5,2),
    overtime_hours numeric(5,2) DEFAULT 0,
    attendance_status text DEFAULT 'Present'::text NOT NULL
);


--
-- Name: capital_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capital_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    contributed_by text,
    amount numeric(12,2) NOT NULL,
    description text,
    notes text
);


--
-- Name: casual_tax_rate_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.casual_tax_rate_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    effective_date date NOT NULL,
    flat_rate numeric(5,4) NOT NULL,
    notes text
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    client_id text NOT NULL,
    client_name text NOT NULL,
    contact_person text,
    phone text,
    email text,
    address text,
    gps_location text,
    contract_number text,
    contract_start date,
    contract_end date,
    service_frequency text,
    services_provided text,
    assigned_supervisor text,
    contract_status text DEFAULT 'Active'::text,
    notes text
);


--
-- Name: complaint_priority_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_priority_options (
    name text NOT NULL
);


--
-- Name: complaint_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_register (
    complaint_no text NOT NULL,
    date_received date NOT NULL,
    client_id text,
    site_id text,
    area text,
    complaint_details text,
    priority text,
    assigned_supervisor text,
    action_taken text,
    status text DEFAULT 'Open'::text,
    resolution_date date,
    customer_satisfaction text,
    repeat_complaint boolean DEFAULT false,
    notes text
);


--
-- Name: consumables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    client_site text,
    item text NOT NULL,
    category text,
    unit text,
    opening_stock numeric(10,2),
    qty_issued numeric(10,2),
    qty_used numeric(10,2),
    remaining numeric(10,2),
    minimum_level numeric(10,2),
    stock_status text,
    recorded_by text,
    notes text
);


--
-- Name: contract_status_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_status_options (
    name text NOT NULL
);


--
-- Name: corrective_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corrective_actions (
    action_no text NOT NULL,
    related_work_order text,
    related_issue_no text,
    date_raised date NOT NULL,
    client_id text,
    issue_description text,
    responsible_person text,
    target_date date,
    status text DEFAULT 'Open'::text,
    completion_date date,
    evidence_submitted boolean DEFAULT false,
    management_approval boolean DEFAULT false,
    notes text
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    dept_code text NOT NULL,
    department_name text NOT NULL
);


--
-- Name: depreciation_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.depreciation_methods (
    name text NOT NULL
);


--
-- Name: disciplinary_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disciplinary_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    incident_date date NOT NULL,
    description text,
    action_taken text,
    warning_level text
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    employee_id text NOT NULL,
    staff_id text,
    full_name text NOT NULL,
    gender text,
    date_of_birth date,
    nationality text,
    marital_status text,
    phone text,
    email text,
    residential_address text,
    ghana_card_number text,
    ssnit_number text,
    tin_number text,
    bank_name text,
    account_number text,
    momo_number text,
    department text,
    "position" text,
    supervisor text,
    employment_type text NOT NULL,
    date_hired date,
    appointment_end_date date,
    employment_status text DEFAULT 'Active'::text NOT NULL,
    contract_project text,
    shift text,
    basic_salary numeric(12,2) DEFAULT 0 NOT NULL,
    housing_allowance numeric(12,2) DEFAULT 0 NOT NULL,
    transport_allowance numeric(12,2) DEFAULT 0 NOT NULL,
    other_allowances numeric(12,2) DEFAULT 0 NOT NULL,
    emergency_contact_name text,
    emergency_contact_address text,
    emergency_contact_phone text,
    emergency_contact_relationship text,
    data_notes text,
    assigned_site_id text,
    photo_url text
);


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    site_code text NOT NULL,
    client_id text,
    site_name text NOT NULL,
    building text,
    floor_zone text,
    area_room text,
    cleaning_frequency text,
    risk_level text,
    est_cleaning_time_min integer,
    assigned_supervisor text,
    access_instructions text,
    notes text,
    required_staff integer,
    project_id uuid
);


--
-- Name: duty_roster; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.duty_roster WITH (security_invoker='true') AS
 SELECT e.employee_id,
    e.full_name,
    e."position",
    e.shift,
    e.department,
    e.assigned_site_id AS site_id,
    s.site_name,
    s.client_id,
    e.employment_status
   FROM (public.employees e
     LEFT JOIN public.sites s ON ((s.site_code = e.assigned_site_id)))
  WHERE (e.employment_status = 'Active'::text);


--
-- Name: employee_employment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_employment_history (
    history_id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    effective_date date NOT NULL,
    employment_type text NOT NULL,
    "position" text,
    shift text,
    department text,
    rate_id uuid,
    basic_salary numeric(12,2) NOT NULL,
    housing_allowance numeric(12,2) DEFAULT 0 NOT NULL,
    transport_allowance numeric(12,2) DEFAULT 0 NOT NULL,
    other_allowances numeric(12,2) DEFAULT 0 NOT NULL,
    employee_status text DEFAULT 'Active'::text NOT NULL,
    change_reason text,
    changed_by text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_leave_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_leave_balances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    leave_type_id uuid NOT NULL,
    year integer NOT NULL,
    entitled_days numeric(8,2) DEFAULT 0 NOT NULL,
    days_used numeric(8,2) DEFAULT 0 NOT NULL,
    days_remaining numeric(8,2) GENERATED ALWAYS AS ((entitled_days - days_used)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: equipment_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_register (
    equipment_id text NOT NULL,
    equipment_name text NOT NULL,
    category text,
    serial_number text,
    assigned_to text,
    assigned_site text,
    condition text,
    purchase_date date,
    last_maintenance date,
    next_service_due date,
    current_status text DEFAULT 'Operational'::text,
    service_alert boolean DEFAULT false,
    notes text
);


--
-- Name: equipment_status_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_status_options (
    name text NOT NULL
);


--
-- Name: exit_management; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exit_management (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    exit_date date NOT NULL,
    exit_reason text,
    notice_period_days integer,
    final_settlement numeric(12,2)
);


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_categories (
    name text NOT NULL
);


--
-- Name: expense_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    expense_category text,
    sub_category text,
    description text,
    vendor text,
    price numeric(12,2),
    quantity numeric(10,2) DEFAULT 1,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    payment_method text,
    approved_by text,
    receipt_no text,
    payment_status text DEFAULT 'Unpaid'::text,
    notes text
);


--
-- Name: expense_subcategories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_subcategories (
    name text NOT NULL
);


--
-- Name: failed_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.failed_inspections (
    issue_no text NOT NULL,
    checklist_id text,
    date_identified date NOT NULL,
    client_id text,
    site_id text,
    area text,
    problem_description text,
    severity text,
    assigned_person text,
    target_date date,
    completed boolean DEFAULT false,
    date_closed date
);


--
-- Name: finished_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finished_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_code text NOT NULL,
    product_name text NOT NULL,
    unit_of_measure text NOT NULL,
    current_stock numeric(18,4) DEFAULT 0 NOT NULL,
    standard_selling_price numeric(18,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_archived boolean DEFAULT false NOT NULL
);


--
-- Name: fixed_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixed_assets (
    asset_id text NOT NULL,
    asset_name text NOT NULL,
    asset_category text,
    purchase_date date,
    original_cost numeric(12,2),
    quantity numeric(10,2) DEFAULT 1,
    total_cost numeric(12,2),
    useful_life_years numeric(5,1),
    depreciation_method text,
    annual_dep_rate_pct numeric(5,2),
    annual_depreciation numeric(12,2),
    accumulated_depreciation numeric(12,2) DEFAULT 0,
    net_book_value numeric(12,2),
    location text,
    notes text
);


--
-- Name: incident_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_register (
    incident_no text NOT NULL,
    date date NOT NULL,
    "time" time without time zone,
    client_id text,
    site_id text,
    area text,
    incident_type text,
    description text,
    severity text,
    reported_by text,
    action_taken text,
    status text DEFAULT 'Open'::text,
    date_resolved date,
    escalated_to_mgmt boolean DEFAULT false,
    notes text
);


--
-- Name: incident_type_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_type_options (
    name text NOT NULL
);


--
-- Name: income_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.income_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    invoice_no text,
    customer_name text,
    service_category text,
    description text,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    amount_received numeric(12,2) DEFAULT 0 NOT NULL,
    outstanding_balance numeric(12,2),
    payment_status text DEFAULT 'Outstanding'::text,
    due_date date,
    notes text,
    client_id text,
    entry_type public.income_entry_type DEFAULT 'service'::public.income_entry_type NOT NULL,
    product_id uuid,
    sale_quantity numeric(18,4),
    unit_price numeric(18,4),
    cogs_expense_id uuid,
    sale_status public.product_sale_status DEFAULT 'active'::public.product_sale_status NOT NULL,
    voided_at timestamp with time zone,
    cogs_reversal_expense_id uuid
);


--
-- Name: inspection_result_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_result_options (
    name text NOT NULL
);


--
-- Name: inspection_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_summary (
    checklist_id text NOT NULL,
    inspection_date date NOT NULL,
    work_order_no text,
    client_id text,
    site_id text,
    supervisor text,
    inspection_score_pct numeric(5,2),
    pass_fail text,
    critical_findings text,
    recommendations text,
    next_inspection_date date,
    status text
);


--
-- Name: internal_consumption; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.internal_consumption (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(18,4) NOT NULL,
    consumption_date date NOT NULL,
    reason text,
    recorded_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expense_register_id uuid,
    site_id text,
    CONSTRAINT internal_consumption_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: inventory_balance_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_balance_config (
    id integer DEFAULT 1 NOT NULL,
    go_live_date date NOT NULL,
    opening_inventory_value numeric(18,4) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_balance_config_id_check CHECK ((id = 1))
);


--
-- Name: leave_approver_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_approver_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    approver_user_account_id uuid NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_management; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_management (
    leave_id text NOT NULL,
    employee_id text NOT NULL,
    leave_type text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    days_requested integer,
    days_approved integer,
    approval_status text DEFAULT 'Pending'::text NOT NULL,
    leave_balance_remaining integer
);


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    leave_type_id uuid NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    days_requested numeric(8,2) NOT NULL,
    reason text,
    status public.leave_request_status DEFAULT 'Pending'::public.leave_request_status NOT NULL,
    approver_user_account_id uuid NOT NULL,
    exceeds_balance boolean DEFAULT false NOT NULL,
    decided_at timestamp with time zone,
    decision_notes text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leave_requests_check CHECK ((end_date >= start_date)),
    CONSTRAINT leave_requests_days_requested_check CHECK ((days_requested > (0)::numeric))
);


--
-- Name: leave_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type_name text NOT NULL,
    default_annual_entitlement numeric(8,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN leave_types.default_annual_entitlement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leave_types.default_annual_entitlement IS 'Days per year. NULL on Annual Leave until David confirms Ghana Labour Act entitlement.';


--
-- Name: loan_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_register (
    loan_id text NOT NULL,
    employee_id text NOT NULL,
    loan_amount numeric(12,2) NOT NULL,
    date_issued date NOT NULL,
    repayment_period_months integer,
    monthly_deduction numeric(12,2),
    total_repaid_to_date numeric(12,2) DEFAULT 0,
    outstanding_balance numeric(12,2)
);


--
-- Name: manual_financial_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manual_financial_entries (
    period_month date NOT NULL,
    cash_on_hand numeric(12,2) DEFAULT 0,
    bank_balance numeric(12,2) DEFAULT 0,
    prepayments_wht_receivable numeric(12,2) DEFAULT 0,
    inventory_consumables numeric(12,2) DEFAULT 0,
    accrued_expenses numeric(12,2) DEFAULT 0,
    withholding_tax_payable numeric(12,2) DEFAULT 0,
    vat_payable numeric(12,2) DEFAULT 0,
    bank_loans numeric(12,2) DEFAULT 0,
    other_long_term_liabilities numeric(12,2) DEFAULT 0,
    share_capital numeric(12,2) DEFAULT 0,
    retained_earnings_prior_years numeric(12,2) DEFAULT 0,
    purchase_of_fixed_assets numeric(12,2) DEFAULT 0,
    loan_proceeds numeric(12,2) DEFAULT 0,
    loan_repayments numeric(12,2) DEFAULT 0,
    opening_cash_balance numeric(12,2) DEFAULT 0,
    notes text
);


--
-- Name: month_end_close; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.month_end_close (
    month date NOT NULL,
    employees_recorded integer DEFAULT 0,
    total_net_pay numeric(14,2) DEFAULT 0,
    lock_status text DEFAULT 'Not Started'::text NOT NULL,
    notes text
);


--
-- Name: month_end_close_backup_20260713c; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.month_end_close_backup_20260713c (
    month date,
    employees_recorded integer,
    total_net_pay numeric(14,2),
    lock_status text,
    notes text
);


--
-- Name: operations_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operations_config (
    config_key text NOT NULL,
    config_value numeric(6,2) NOT NULL,
    notes text
);


--
-- Name: overtime_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.overtime_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    employee_id text NOT NULL,
    hours_worked numeric(5,2),
    overtime_hours numeric(5,2),
    overtime_rate numeric(8,2),
    overtime_amount numeric(12,2),
    approved_by text
);


--
-- Name: pay_rate_structure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pay_rate_structure (
    rate_id uuid DEFAULT gen_random_uuid() NOT NULL,
    "position" text,
    employment_type text NOT NULL,
    shift text NOT NULL,
    basic_salary numeric(12,2) NOT NULL,
    housing_allowance numeric(12,2) DEFAULT 0 NOT NULL,
    transport_allowance numeric(12,2) DEFAULT 0 NOT NULL,
    other_allowances numeric(12,2) DEFAULT 0 NOT NULL,
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text
);


--
-- Name: paye_bands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paye_bands (
    band_name text NOT NULL,
    lower_bound numeric(12,2) NOT NULL,
    upper_bound numeric(14,2) NOT NULL,
    rate numeric(5,4) NOT NULL,
    tax_year integer DEFAULT EXTRACT(year FROM CURRENT_DATE) NOT NULL
);


--
-- Name: paye_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paye_config (
    config_key text NOT NULL,
    config_value numeric(6,4) NOT NULL,
    notes text
);


--
-- Name: paye_tax_bands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paye_tax_bands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    effective_date date NOT NULL,
    band_order integer NOT NULL,
    lower_bound numeric(12,2) NOT NULL,
    upper_bound numeric(12,2),
    rate numeric(5,4) NOT NULL
);


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_methods (
    name text NOT NULL
);


--
-- Name: payroll_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payroll_month date NOT NULL,
    year integer NOT NULL,
    quarter text,
    employee_id text NOT NULL,
    department text,
    project_contract text,
    basic_salary numeric(12,2),
    housing_allowance numeric(12,2),
    transport_allowance numeric(12,2),
    other_allowances numeric(12,2),
    overtime_amount numeric(12,2) DEFAULT 0,
    bonuses numeric(12,2) DEFAULT 0,
    arrears numeric(12,2) DEFAULT 0,
    gross_pay numeric(12,2),
    employee_ssnit numeric(12,2) DEFAULT 0,
    employer_ssnit numeric(12,2) DEFAULT 0,
    tier2 numeric(12,2) DEFAULT 0,
    tier3 numeric(12,2) DEFAULT 0,
    paye_tax numeric(12,2) DEFAULT 0,
    loan_repayment numeric(12,2) DEFAULT 0,
    salary_advance numeric(12,2) DEFAULT 0,
    welfare_deduction numeric(12,2) DEFAULT 0,
    other_deductions numeric(12,2) DEFAULT 0,
    absence_deduction numeric(12,2) DEFAULT 0,
    total_deductions numeric(12,2),
    net_pay numeric(12,2),
    locked boolean DEFAULT false NOT NULL,
    locked_at timestamp with time zone
);


--
-- Name: payroll_history_backup_20260713c; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_history_backup_20260713c (
    id uuid,
    payroll_month date,
    year integer,
    quarter text,
    employee_id text,
    department text,
    project_contract text,
    basic_salary numeric(12,2),
    housing_allowance numeric(12,2),
    transport_allowance numeric(12,2),
    other_allowances numeric(12,2),
    overtime_amount numeric(12,2),
    bonuses numeric(12,2),
    arrears numeric(12,2),
    gross_pay numeric(12,2),
    employee_ssnit numeric(12,2),
    employer_ssnit numeric(12,2),
    tier2 numeric(12,2),
    tier3 numeric(12,2),
    paye_tax numeric(12,2),
    loan_repayment numeric(12,2),
    salary_advance numeric(12,2),
    welfare_deduction numeric(12,2),
    other_deductions numeric(12,2),
    absence_deduction numeric(12,2),
    total_deductions numeric(12,2),
    net_pay numeric(12,2),
    locked boolean,
    locked_at timestamp with time zone
);


--
-- Name: payroll_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_link (
    payroll_month date NOT NULL,
    employee_ssnit numeric(12,2) DEFAULT 0,
    employee_ssnit_paid boolean DEFAULT false,
    employer_ssnit numeric(12,2) DEFAULT 0,
    employer_ssnit_paid boolean DEFAULT false,
    paye_tax numeric(12,2) DEFAULT 0,
    paye_paid boolean DEFAULT false,
    notes text
);


--
-- Name: payroll_processing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_processing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payroll_month date NOT NULL,
    days_to_pay integer,
    status text DEFAULT 'Open'::text NOT NULL,
    employee_id text NOT NULL,
    department text,
    project_contract text,
    basic_salary numeric(12,2),
    housing_allowance numeric(12,2),
    transport_allowance numeric(12,2),
    other_allowances numeric(12,2),
    overtime_amount numeric(12,2) DEFAULT 0,
    bonuses numeric(12,2) DEFAULT 0,
    arrears numeric(12,2) DEFAULT 0,
    gross_pay numeric(12,2),
    employee_ssnit numeric(12,2) DEFAULT 0,
    employer_ssnit numeric(12,2) DEFAULT 0,
    tier2 numeric(12,2) DEFAULT 0,
    tier3 numeric(12,2) DEFAULT 0,
    paye_tax numeric(12,2) DEFAULT 0,
    loan_repayment numeric(12,2) DEFAULT 0,
    salary_advance numeric(12,2) DEFAULT 0,
    welfare_deduction numeric(12,2) DEFAULT 0,
    other_deductions numeric(12,2) DEFAULT 0,
    absence_deduction numeric(12,2) DEFAULT 0,
    total_deductions numeric(12,2),
    net_pay numeric(12,2),
    daily_rate numeric(10,4)
);


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    position_title text NOT NULL
);


--
-- Name: production_batch_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_batch_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    material_id uuid NOT NULL,
    quantity_used numeric(18,4) NOT NULL,
    cost_at_time numeric(18,4) NOT NULL,
    CONSTRAINT production_batch_materials_cost_at_time_check CHECK ((cost_at_time >= (0)::numeric)),
    CONSTRAINT production_batch_materials_quantity_used_check CHECK ((quantity_used > (0)::numeric))
);


--
-- Name: production_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_number text NOT NULL,
    production_date date NOT NULL,
    finished_product_id uuid NOT NULL,
    quantity_produced numeric(18,4) NOT NULL,
    cost_per_unit_produced numeric(18,4) DEFAULT 0 NOT NULL,
    total_batch_cost numeric(18,4) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_batches_quantity_produced_check CHECK ((quantity_produced > (0)::numeric))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    project_code text NOT NULL,
    project_name text NOT NULL,
    required_staff integer,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: raw_material_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raw_material_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    purchase_date date NOT NULL,
    quantity numeric(18,4) NOT NULL,
    cost_per_unit numeric(18,4) NOT NULL,
    total_cost numeric(18,4) NOT NULL,
    supplier text,
    payment_method text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accounts_payable_id uuid,
    CONSTRAINT raw_material_purchases_cost_per_unit_check CHECK ((cost_per_unit >= (0)::numeric)),
    CONSTRAINT raw_material_purchases_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: raw_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raw_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_code text NOT NULL,
    material_name text NOT NULL,
    unit_of_measure text NOT NULL,
    current_stock numeric(18,4) DEFAULT 0 NOT NULL,
    average_cost_per_unit numeric(18,4) DEFAULT 0 NOT NULL,
    reorder_level numeric(18,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_archived boolean DEFAULT false NOT NULL
);


--
-- Name: recruitment_tracker; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recruitment_tracker (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vacancy text NOT NULL,
    department text,
    candidate_name text,
    interview_date date,
    status text DEFAULT 'Open'::text,
    hired_date date
);


--
-- Name: risk_level_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_level_options (
    name text NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    code public.app_role NOT NULL,
    label text NOT NULL,
    sort_order integer NOT NULL
);


--
-- Name: roster_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_start_date date NOT NULL,
    cycle_length_days integer DEFAULT 14 NOT NULL,
    morning_time text,
    afternoon_time text,
    supervisor_time text,
    client_id text NOT NULL
);


--
-- Name: roster_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_history (
    roster_number text NOT NULL,
    rotation_number integer,
    effective_date date NOT NULL,
    end_date date,
    employee_id text,
    previous_location text,
    new_location text,
    "position" text,
    shift text,
    generated_by text,
    date_generated date DEFAULT CURRENT_DATE
);


--
-- Name: salary_rate_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salary_rate_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "position" text NOT NULL,
    employment_type text NOT NULL,
    shift text NOT NULL,
    basic_salary numeric(12,2) NOT NULL,
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    CONSTRAINT salary_rate_config_employment_type_check CHECK ((employment_type = ANY (ARRAY['Casual'::text, 'Part-Time'::text, 'Full-Time'::text]))),
    CONSTRAINT salary_rate_config_shift_check CHECK ((shift = ANY (ARRAY['Full Day'::text, 'Morning'::text, 'Afternoon'::text])))
);


--
-- Name: service_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_types (
    name text NOT NULL
);


--
-- Name: severity_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.severity_options (
    name text NOT NULL
);


--
-- Name: ssnit_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ssnit_config (
    config_key text NOT NULL,
    config_value numeric(12,2) NOT NULL,
    notes text
);


--
-- Name: ssnit_rate_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ssnit_rate_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    effective_date date NOT NULL,
    employee_rate numeric(5,4) NOT NULL,
    employer_tier1_rate numeric(5,4) NOT NULL,
    employer_tier2_rate numeric(5,4) NOT NULL,
    insurable_earnings_ceiling numeric(12,2),
    notes text
);


--
-- Name: ssnit_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ssnit_rates (
    rate_name text NOT NULL,
    rate_value numeric(6,4) NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    notes text
);


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    movement_type public.stock_movement_type NOT NULL,
    quantity numeric(18,4) NOT NULL,
    reference_id uuid,
    movement_date date NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_movements_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: todos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.todos (
    id bigint NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: todos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.todos ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.todos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_account_supervisor_sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_account_supervisor_sites (
    auth_uid uuid NOT NULL,
    site_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_accounts (
    auth_uid uuid NOT NULL,
    employee_id text,
    role public.app_role DEFAULT 'super_admin'::public.app_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    client_id text
);


--
-- Name: work_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_orders (
    work_order_no text NOT NULL,
    checklist_id text,
    ref_po_no text,
    date date NOT NULL,
    client_id text,
    site_id text,
    area text,
    service_type text,
    assigned_cleaner text,
    supervisor text,
    start_time time without time zone,
    completion_time time without time zone,
    duration_min integer,
    inspection_score_pct numeric(5,2),
    pass_fail text,
    checked_by_sup boolean DEFAULT false,
    remarks text
);


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea
)
PARTITION BY RANGE (inserted_at);


--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    selected_columns text[],
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: -
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: accounts_payable accounts_payable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_pkey PRIMARY KEY (id);


--
-- Name: action_status_options action_status_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_status_options
    ADD CONSTRAINT action_status_options_pkey PRIMARY KEY (name);


--
-- Name: approvers approvers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvers
    ADD CONSTRAINT approvers_pkey PRIMARY KEY (employee_id);


--
-- Name: asset_categories asset_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_categories
    ADD CONSTRAINT asset_categories_pkey PRIMARY KEY (name);


--
-- Name: asset_register asset_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_register
    ADD CONSTRAINT asset_register_pkey PRIMARY KEY (asset_id);


--
-- Name: attendance_register attendance_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_register
    ADD CONSTRAINT attendance_register_pkey PRIMARY KEY (id);


--
-- Name: capital_contributions capital_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_contributions
    ADD CONSTRAINT capital_contributions_pkey PRIMARY KEY (id);


--
-- Name: casual_tax_rate_config casual_tax_rate_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.casual_tax_rate_config
    ADD CONSTRAINT casual_tax_rate_config_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (client_id);


--
-- Name: complaint_priority_options complaint_priority_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_priority_options
    ADD CONSTRAINT complaint_priority_options_pkey PRIMARY KEY (name);


--
-- Name: complaint_register complaint_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_register
    ADD CONSTRAINT complaint_register_pkey PRIMARY KEY (complaint_no);


--
-- Name: consumables consumables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumables
    ADD CONSTRAINT consumables_pkey PRIMARY KEY (id);


--
-- Name: contract_status_options contract_status_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_status_options
    ADD CONSTRAINT contract_status_options_pkey PRIMARY KEY (name);


--
-- Name: corrective_actions corrective_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_pkey PRIMARY KEY (action_no);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (dept_code);


--
-- Name: depreciation_methods depreciation_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.depreciation_methods
    ADD CONSTRAINT depreciation_methods_pkey PRIMARY KEY (name);


--
-- Name: disciplinary_records disciplinary_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disciplinary_records
    ADD CONSTRAINT disciplinary_records_pkey PRIMARY KEY (id);


--
-- Name: employee_employment_history employee_employment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_employment_history
    ADD CONSTRAINT employee_employment_history_pkey PRIMARY KEY (history_id);


--
-- Name: employee_leave_balances employee_leave_balances_employee_id_leave_type_id_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leave_balances
    ADD CONSTRAINT employee_leave_balances_employee_id_leave_type_id_year_key UNIQUE (employee_id, leave_type_id, year);


--
-- Name: employee_leave_balances employee_leave_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leave_balances
    ADD CONSTRAINT employee_leave_balances_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (employee_id);


--
-- Name: employees employees_staff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_staff_id_key UNIQUE (staff_id);


--
-- Name: equipment_register equipment_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_register
    ADD CONSTRAINT equipment_register_pkey PRIMARY KEY (equipment_id);


--
-- Name: equipment_status_options equipment_status_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_status_options
    ADD CONSTRAINT equipment_status_options_pkey PRIMARY KEY (name);


--
-- Name: exit_management exit_management_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exit_management
    ADD CONSTRAINT exit_management_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (name);


--
-- Name: expense_register expense_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_register
    ADD CONSTRAINT expense_register_pkey PRIMARY KEY (id);


--
-- Name: expense_subcategories expense_subcategories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_subcategories
    ADD CONSTRAINT expense_subcategories_pkey PRIMARY KEY (name);


--
-- Name: failed_inspections failed_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_inspections
    ADD CONSTRAINT failed_inspections_pkey PRIMARY KEY (issue_no);


--
-- Name: finished_products finished_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finished_products
    ADD CONSTRAINT finished_products_pkey PRIMARY KEY (id);


--
-- Name: finished_products finished_products_product_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finished_products
    ADD CONSTRAINT finished_products_product_code_key UNIQUE (product_code);


--
-- Name: fixed_assets fixed_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_pkey PRIMARY KEY (asset_id);


--
-- Name: incident_register incident_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_register
    ADD CONSTRAINT incident_register_pkey PRIMARY KEY (incident_no);


--
-- Name: incident_type_options incident_type_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_type_options
    ADD CONSTRAINT incident_type_options_pkey PRIMARY KEY (name);


--
-- Name: income_register income_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income_register
    ADD CONSTRAINT income_register_pkey PRIMARY KEY (id);


--
-- Name: inspection_result_options inspection_result_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_result_options
    ADD CONSTRAINT inspection_result_options_pkey PRIMARY KEY (name);


--
-- Name: inspection_summary inspection_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_summary
    ADD CONSTRAINT inspection_summary_pkey PRIMARY KEY (checklist_id);


--
-- Name: internal_consumption internal_consumption_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_consumption
    ADD CONSTRAINT internal_consumption_pkey PRIMARY KEY (id);


--
-- Name: inventory_balance_config inventory_balance_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_balance_config
    ADD CONSTRAINT inventory_balance_config_pkey PRIMARY KEY (id);


--
-- Name: leave_approver_config leave_approver_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_approver_config
    ADD CONSTRAINT leave_approver_config_pkey PRIMARY KEY (id);


--
-- Name: leave_management leave_management_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_management
    ADD CONSTRAINT leave_management_pkey PRIMARY KEY (leave_id);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);


--
-- Name: leave_types leave_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_types
    ADD CONSTRAINT leave_types_pkey PRIMARY KEY (id);


--
-- Name: leave_types leave_types_type_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_types
    ADD CONSTRAINT leave_types_type_name_key UNIQUE (type_name);


--
-- Name: loan_register loan_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_register
    ADD CONSTRAINT loan_register_pkey PRIMARY KEY (loan_id);


--
-- Name: manual_financial_entries manual_financial_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_financial_entries
    ADD CONSTRAINT manual_financial_entries_pkey PRIMARY KEY (period_month);


--
-- Name: month_end_close month_end_close_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.month_end_close
    ADD CONSTRAINT month_end_close_pkey PRIMARY KEY (month);


--
-- Name: operations_config operations_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations_config
    ADD CONSTRAINT operations_config_pkey PRIMARY KEY (config_key);


--
-- Name: overtime_register overtime_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.overtime_register
    ADD CONSTRAINT overtime_register_pkey PRIMARY KEY (id);


--
-- Name: pay_rate_structure pay_rate_structure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_rate_structure
    ADD CONSTRAINT pay_rate_structure_pkey PRIMARY KEY (rate_id);


--
-- Name: pay_rate_structure pay_rate_structure_position_employment_type_shift_effective_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_rate_structure
    ADD CONSTRAINT pay_rate_structure_position_employment_type_shift_effective_key UNIQUE ("position", employment_type, shift, effective_date);


--
-- Name: paye_bands paye_bands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paye_bands
    ADD CONSTRAINT paye_bands_pkey PRIMARY KEY (band_name, tax_year);


--
-- Name: paye_config paye_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paye_config
    ADD CONSTRAINT paye_config_pkey PRIMARY KEY (config_key);


--
-- Name: paye_tax_bands paye_tax_bands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paye_tax_bands
    ADD CONSTRAINT paye_tax_bands_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (name);


--
-- Name: payroll_history payroll_history_payroll_month_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_history
    ADD CONSTRAINT payroll_history_payroll_month_employee_id_key UNIQUE (payroll_month, employee_id);


--
-- Name: payroll_history payroll_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_history
    ADD CONSTRAINT payroll_history_pkey PRIMARY KEY (id);


--
-- Name: payroll_link payroll_link_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_link
    ADD CONSTRAINT payroll_link_pkey PRIMARY KEY (payroll_month);


--
-- Name: payroll_processing payroll_processing_payroll_month_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_processing
    ADD CONSTRAINT payroll_processing_payroll_month_employee_id_key UNIQUE (payroll_month, employee_id);


--
-- Name: payroll_processing payroll_processing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_processing
    ADD CONSTRAINT payroll_processing_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (position_title);


--
-- Name: production_batch_materials production_batch_materials_batch_material_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_batch_materials
    ADD CONSTRAINT production_batch_materials_batch_material_key UNIQUE (batch_id, material_id);


--
-- Name: production_batch_materials production_batch_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_batch_materials
    ADD CONSTRAINT production_batch_materials_pkey PRIMARY KEY (id);


--
-- Name: production_batches production_batches_batch_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_batches
    ADD CONSTRAINT production_batches_batch_number_key UNIQUE (batch_number);


--
-- Name: production_batches production_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_batches
    ADD CONSTRAINT production_batches_pkey PRIMARY KEY (id);


--
-- Name: projects projects_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_id_unique UNIQUE (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (project_code);


--
-- Name: raw_material_purchases raw_material_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_material_purchases
    ADD CONSTRAINT raw_material_purchases_pkey PRIMARY KEY (id);


--
-- Name: raw_materials raw_materials_material_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_materials
    ADD CONSTRAINT raw_materials_material_code_key UNIQUE (material_code);


--
-- Name: raw_materials raw_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_materials
    ADD CONSTRAINT raw_materials_pkey PRIMARY KEY (id);


--
-- Name: recruitment_tracker recruitment_tracker_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruitment_tracker
    ADD CONSTRAINT recruitment_tracker_pkey PRIMARY KEY (id);


--
-- Name: risk_level_options risk_level_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_level_options
    ADD CONSTRAINT risk_level_options_pkey PRIMARY KEY (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (code);


--
-- Name: roster_config roster_config_client_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_config
    ADD CONSTRAINT roster_config_client_id_unique UNIQUE (client_id);


--
-- Name: roster_config roster_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_config
    ADD CONSTRAINT roster_config_pkey PRIMARY KEY (id);


--
-- Name: roster_history roster_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_history
    ADD CONSTRAINT roster_history_pkey PRIMARY KEY (roster_number);


--
-- Name: salary_rate_config salary_rate_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salary_rate_config
    ADD CONSTRAINT salary_rate_config_pkey PRIMARY KEY (id);


--
-- Name: salary_rate_config salary_rate_config_position_employment_type_shift_effective_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salary_rate_config
    ADD CONSTRAINT salary_rate_config_position_employment_type_shift_effective_key UNIQUE ("position", employment_type, shift, effective_date);


--
-- Name: service_types service_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_types
    ADD CONSTRAINT service_types_pkey PRIMARY KEY (name);


--
-- Name: severity_options severity_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.severity_options
    ADD CONSTRAINT severity_options_pkey PRIMARY KEY (name);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (site_code);


--
-- Name: ssnit_config ssnit_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssnit_config
    ADD CONSTRAINT ssnit_config_pkey PRIMARY KEY (config_key);


--
-- Name: ssnit_rate_config ssnit_rate_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssnit_rate_config
    ADD CONSTRAINT ssnit_rate_config_pkey PRIMARY KEY (id);


--
-- Name: ssnit_rates ssnit_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssnit_rates
    ADD CONSTRAINT ssnit_rates_pkey PRIMARY KEY (rate_name);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: todos todos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_pkey PRIMARY KEY (id);


--
-- Name: user_account_supervisor_sites user_account_supervisor_sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account_supervisor_sites
    ADD CONSTRAINT user_account_supervisor_sites_pkey PRIMARY KEY (auth_uid, site_code);


--
-- Name: user_accounts user_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_accounts
    ADD CONSTRAINT user_accounts_pkey PRIMARY KEY (auth_uid);


--
-- Name: work_orders work_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_pkey PRIMARY KEY (work_order_no);


--
-- Name: messages messages_payload_exclusive; Type: CHECK CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages
    ADD CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL))) NOT VALID;


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: idx_users_created_at_desc; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_created_at_desc ON auth.users USING btree (created_at DESC);


--
-- Name: idx_users_email; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_email ON auth.users USING btree (email);


--
-- Name: idx_users_last_sign_in_at_desc; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_last_sign_in_at_desc ON auth.users USING btree (last_sign_in_at DESC);


--
-- Name: idx_users_name; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_name ON auth.users USING btree (((raw_user_meta_data ->> 'name'::text))) WHERE ((raw_user_meta_data ->> 'name'::text) IS NOT NULL);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: idx_approvers_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approvers_employee_id ON public.approvers USING btree (employee_id);


--
-- Name: idx_asset_register_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_register_employee_id ON public.asset_register USING btree (employee_id);


--
-- Name: idx_attendance_staff_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_staff_date ON public.attendance_register USING btree (staff_id, date);


--
-- Name: idx_complaint_register_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaint_register_client_id ON public.complaint_register USING btree (client_id);


--
-- Name: idx_complaint_register_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaint_register_site_id ON public.complaint_register USING btree (site_id);


--
-- Name: idx_consumables_client_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumables_client_site ON public.consumables USING btree (client_site);


--
-- Name: idx_corrective_actions_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corrective_actions_client_id ON public.corrective_actions USING btree (client_id);


--
-- Name: idx_disciplinary_records_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disciplinary_records_employee_id ON public.disciplinary_records USING btree (employee_id);


--
-- Name: idx_emp_history_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_history_employee_date ON public.employee_employment_history USING btree (employee_id, effective_date DESC);


--
-- Name: idx_employee_employment_history_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_employment_history_employee_id ON public.employee_employment_history USING btree (employee_id);


--
-- Name: idx_employee_leave_balances_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_leave_balances_employee_id ON public.employee_leave_balances USING btree (employee_id);


--
-- Name: idx_employee_leave_balances_employee_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_leave_balances_employee_year ON public.employee_leave_balances USING btree (employee_id, year);


--
-- Name: idx_employees_assigned_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_assigned_site_id ON public.employees USING btree (assigned_site_id);


--
-- Name: idx_employees_contract_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_contract_project ON public.employees USING btree (contract_project);


--
-- Name: idx_equipment_register_assigned_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipment_register_assigned_site ON public.equipment_register USING btree (assigned_site);


--
-- Name: idx_exit_management_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exit_management_employee_id ON public.exit_management USING btree (employee_id);


--
-- Name: idx_failed_inspections_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_failed_inspections_client_id ON public.failed_inspections USING btree (client_id);


--
-- Name: idx_failed_inspections_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_failed_inspections_site_id ON public.failed_inspections USING btree (site_id);


--
-- Name: idx_incident_register_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_register_client_id ON public.incident_register USING btree (client_id);


--
-- Name: idx_incident_register_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_register_site_id ON public.incident_register USING btree (site_id);


--
-- Name: idx_income_register_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_income_register_client_id ON public.income_register USING btree (client_id);


--
-- Name: idx_income_register_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_income_register_product_id ON public.income_register USING btree (product_id);


--
-- Name: idx_inspection_summary_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_summary_client_id ON public.inspection_summary USING btree (client_id);


--
-- Name: idx_inspection_summary_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_summary_site_id ON public.inspection_summary USING btree (site_id);


--
-- Name: idx_internal_consumption_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_internal_consumption_product_id ON public.internal_consumption USING btree (product_id);


--
-- Name: idx_internal_consumption_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_internal_consumption_site_id ON public.internal_consumption USING btree (site_id);


--
-- Name: idx_leave_approver_config_effective_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leave_approver_config_effective_from ON public.leave_approver_config USING btree (effective_from DESC, created_at DESC);


--
-- Name: idx_leave_management_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leave_management_employee_id ON public.leave_management USING btree (employee_id);


--
-- Name: idx_leave_requests_approver_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leave_requests_approver_status ON public.leave_requests USING btree (approver_user_account_id, status);


--
-- Name: idx_leave_requests_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leave_requests_employee_id ON public.leave_requests USING btree (employee_id, submitted_at DESC);


--
-- Name: idx_loan_register_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_register_employee_id ON public.loan_register USING btree (employee_id);


--
-- Name: idx_overtime_register_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_overtime_register_employee_id ON public.overtime_register USING btree (employee_id);


--
-- Name: idx_payroll_history_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_history_employee_id ON public.payroll_history USING btree (employee_id);


--
-- Name: idx_payroll_processing_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_processing_employee_id ON public.payroll_processing USING btree (employee_id);


--
-- Name: idx_production_batches_finished_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_batches_finished_product_id ON public.production_batches USING btree (finished_product_id);


--
-- Name: idx_raw_material_purchases_material_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_raw_material_purchases_material_id ON public.raw_material_purchases USING btree (material_id);


--
-- Name: idx_roster_config_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roster_config_client_id ON public.roster_config USING btree (client_id);


--
-- Name: idx_roster_history_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roster_history_employee_id ON public.roster_history USING btree (employee_id);


--
-- Name: idx_sites_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sites_client_id ON public.sites USING btree (client_id);


--
-- Name: idx_sites_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sites_project_id ON public.sites USING btree (project_id);


--
-- Name: idx_stock_movements_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_product_id ON public.stock_movements USING btree (product_id);


--
-- Name: idx_stock_movements_reference_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_reference_id ON public.stock_movements USING btree (reference_id);


--
-- Name: idx_user_account_supervisor_sites_site_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_account_supervisor_sites_site_code ON public.user_account_supervisor_sites USING btree (site_code);


--
-- Name: idx_user_accounts_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_accounts_client_id ON public.user_accounts USING btree (client_id);


--
-- Name: idx_user_accounts_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_accounts_employee_id ON public.user_accounts USING btree (employee_id);


--
-- Name: idx_work_orders_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_client_id ON public.work_orders USING btree (client_id);


--
-- Name: idx_work_orders_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_site_id ON public.work_orders USING btree (site_id);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_selec; Type: INDEX; Schema: realtime; Owner: -
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_selec ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter, COALESCE(selected_columns, '{}'::text[]));


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: internal_consumption trg_apply_internal_consumption; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_apply_internal_consumption AFTER INSERT ON public.internal_consumption FOR EACH ROW EXECUTE FUNCTION public.apply_internal_consumption();


--
-- Name: raw_material_purchases trg_apply_raw_material_purchase; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_apply_raw_material_purchase BEFORE INSERT ON public.raw_material_purchases FOR EACH ROW EXECUTE FUNCTION public.apply_raw_material_purchase();


--
-- Name: raw_material_purchases trg_post_raw_material_purchase_finance; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_post_raw_material_purchase_finance AFTER INSERT ON public.raw_material_purchases FOR EACH ROW EXECUTE FUNCTION public.post_raw_material_purchase_finance();


--
-- Name: payroll_history trg_protect_locked_payroll; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_locked_payroll BEFORE DELETE OR UPDATE ON public.payroll_history FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_payroll_edit();


--
-- Name: roster_history trg_protect_roster_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_roster_history BEFORE DELETE OR UPDATE ON public.roster_history FOR EACH ROW EXECUTE FUNCTION public.prevent_roster_history_edit();


--
-- Name: internal_consumption trg_validate_internal_consumption; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_internal_consumption BEFORE INSERT ON public.internal_consumption FOR EACH ROW EXECUTE FUNCTION public.validate_internal_consumption();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: -
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: approvers approvers_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvers
    ADD CONSTRAINT approvers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: asset_register asset_register_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_register
    ADD CONSTRAINT asset_register_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: attendance_register attendance_register_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_register
    ADD CONSTRAINT attendance_register_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.employees(staff_id);


--
-- Name: capital_contributions capital_contributions_contributed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_contributions
    ADD CONSTRAINT capital_contributions_contributed_by_fkey FOREIGN KEY (contributed_by) REFERENCES public.employees(employee_id);


--
-- Name: clients clients_assigned_supervisor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_assigned_supervisor_fkey FOREIGN KEY (assigned_supervisor) REFERENCES public.employees(employee_id);


--
-- Name: complaint_register complaint_register_assigned_supervisor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_register
    ADD CONSTRAINT complaint_register_assigned_supervisor_fkey FOREIGN KEY (assigned_supervisor) REFERENCES public.employees(employee_id);


--
-- Name: complaint_register complaint_register_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_register
    ADD CONSTRAINT complaint_register_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


--
-- Name: complaint_register complaint_register_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_register
    ADD CONSTRAINT complaint_register_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(site_code);


--
-- Name: consumables consumables_client_site_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumables
    ADD CONSTRAINT consumables_client_site_fkey FOREIGN KEY (client_site) REFERENCES public.sites(site_code);


--
-- Name: consumables consumables_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumables
    ADD CONSTRAINT consumables_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.employees(employee_id);


--
-- Name: corrective_actions corrective_actions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


--
-- Name: corrective_actions corrective_actions_related_issue_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_related_issue_no_fkey FOREIGN KEY (related_issue_no) REFERENCES public.failed_inspections(issue_no);


--
-- Name: corrective_actions corrective_actions_related_work_order_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_related_work_order_fkey FOREIGN KEY (related_work_order) REFERENCES public.work_orders(work_order_no);


--
-- Name: corrective_actions corrective_actions_responsible_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_responsible_person_fkey FOREIGN KEY (responsible_person) REFERENCES public.employees(employee_id);


--
-- Name: disciplinary_records disciplinary_records_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disciplinary_records
    ADD CONSTRAINT disciplinary_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: employee_employment_history employee_employment_history_department_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_employment_history
    ADD CONSTRAINT employee_employment_history_department_fkey FOREIGN KEY (department) REFERENCES public.departments(dept_code);


--
-- Name: employee_employment_history employee_employment_history_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_employment_history
    ADD CONSTRAINT employee_employment_history_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: employee_employment_history employee_employment_history_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_employment_history
    ADD CONSTRAINT employee_employment_history_position_fkey FOREIGN KEY ("position") REFERENCES public.positions(position_title);


--
-- Name: employee_employment_history employee_employment_history_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_employment_history
    ADD CONSTRAINT employee_employment_history_rate_id_fkey FOREIGN KEY (rate_id) REFERENCES public.pay_rate_structure(rate_id);


--
-- Name: employee_leave_balances employee_leave_balances_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leave_balances
    ADD CONSTRAINT employee_leave_balances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id) ON DELETE CASCADE;


--
-- Name: employee_leave_balances employee_leave_balances_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leave_balances
    ADD CONSTRAINT employee_leave_balances_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES public.leave_types(id) ON DELETE CASCADE;


--
-- Name: employees employees_assigned_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_assigned_site_id_fkey FOREIGN KEY (assigned_site_id) REFERENCES public.sites(site_code);


--
-- Name: employees employees_contract_project_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_contract_project_fkey FOREIGN KEY (contract_project) REFERENCES public.projects(project_code);


--
-- Name: employees employees_department_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_department_fkey FOREIGN KEY (department) REFERENCES public.departments(dept_code);


--
-- Name: employees employees_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_position_fkey FOREIGN KEY ("position") REFERENCES public.positions(position_title);


--
-- Name: employees employees_supervisor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_supervisor_fkey FOREIGN KEY (supervisor) REFERENCES public.employees(employee_id);


--
-- Name: equipment_register equipment_register_assigned_site_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_register
    ADD CONSTRAINT equipment_register_assigned_site_fkey FOREIGN KEY (assigned_site) REFERENCES public.sites(site_code);


--
-- Name: equipment_register equipment_register_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_register
    ADD CONSTRAINT equipment_register_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.employees(employee_id);


--
-- Name: exit_management exit_management_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exit_management
    ADD CONSTRAINT exit_management_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: failed_inspections failed_inspections_assigned_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_inspections
    ADD CONSTRAINT failed_inspections_assigned_person_fkey FOREIGN KEY (assigned_person) REFERENCES public.employees(employee_id);


--
-- Name: failed_inspections failed_inspections_checklist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_inspections
    ADD CONSTRAINT failed_inspections_checklist_id_fkey FOREIGN KEY (checklist_id) REFERENCES public.inspection_summary(checklist_id);


--
-- Name: failed_inspections failed_inspections_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_inspections
    ADD CONSTRAINT failed_inspections_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


--
-- Name: failed_inspections failed_inspections_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_inspections
    ADD CONSTRAINT failed_inspections_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(site_code);


--
-- Name: incident_register incident_register_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_register
    ADD CONSTRAINT incident_register_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


--
-- Name: incident_register incident_register_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_register
    ADD CONSTRAINT incident_register_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.employees(employee_id);


--
-- Name: incident_register incident_register_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_register
    ADD CONSTRAINT incident_register_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(site_code);


--
-- Name: income_register income_register_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income_register
    ADD CONSTRAINT income_register_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


--
-- Name: income_register income_register_cogs_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income_register
    ADD CONSTRAINT income_register_cogs_expense_id_fkey FOREIGN KEY (cogs_expense_id) REFERENCES public.expense_register(id);


--
-- Name: income_register income_register_cogs_reversal_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income_register
    ADD CONSTRAINT income_register_cogs_reversal_expense_id_fkey FOREIGN KEY (cogs_reversal_expense_id) REFERENCES public.expense_register(id);


--
-- Name: income_register income_register_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income_register
    ADD CONSTRAINT income_register_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.finished_products(id);


--
-- Name: inspection_summary inspection_summary_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_summary
    ADD CONSTRAINT inspection_summary_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


--
-- Name: inspection_summary inspection_summary_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_summary
    ADD CONSTRAINT inspection_summary_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(site_code);


--
-- Name: inspection_summary inspection_summary_supervisor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_summary
    ADD CONSTRAINT inspection_summary_supervisor_fkey FOREIGN KEY (supervisor) REFERENCES public.employees(employee_id);


--
-- Name: inspection_summary inspection_summary_work_order_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_summary
    ADD CONSTRAINT inspection_summary_work_order_no_fkey FOREIGN KEY (work_order_no) REFERENCES public.work_orders(work_order_no);


--
-- Name: internal_consumption internal_consumption_expense_register_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_consumption
    ADD CONSTRAINT internal_consumption_expense_register_id_fkey FOREIGN KEY (expense_register_id) REFERENCES public.expense_register(id);


--
-- Name: internal_consumption internal_consumption_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_consumption
    ADD CONSTRAINT internal_consumption_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.finished_products(id);


--
-- Name: internal_consumption internal_consumption_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_consumption
    ADD CONSTRAINT internal_consumption_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(site_code);


--
-- Name: leave_approver_config leave_approver_config_approver_user_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_approver_config
    ADD CONSTRAINT leave_approver_config_approver_user_account_id_fkey FOREIGN KEY (approver_user_account_id) REFERENCES public.user_accounts(auth_uid) ON DELETE RESTRICT;


--
-- Name: leave_management leave_management_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_management
    ADD CONSTRAINT leave_management_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: leave_requests leave_requests_approver_user_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_approver_user_account_id_fkey FOREIGN KEY (approver_user_account_id) REFERENCES public.user_accounts(auth_uid) ON DELETE RESTRICT;


--
-- Name: leave_requests leave_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id) ON DELETE CASCADE;


--
-- Name: leave_requests leave_requests_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES public.leave_types(id) ON DELETE RESTRICT;


--
-- Name: loan_register loan_register_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_register
    ADD CONSTRAINT loan_register_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: overtime_register overtime_register_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.overtime_register
    ADD CONSTRAINT overtime_register_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: pay_rate_structure pay_rate_structure_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_rate_structure
    ADD CONSTRAINT pay_rate_structure_position_fkey FOREIGN KEY ("position") REFERENCES public.positions(position_title);


--
-- Name: payroll_history payroll_history_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_history
    ADD CONSTRAINT payroll_history_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: payroll_history payroll_history_project_contract_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_history
    ADD CONSTRAINT payroll_history_project_contract_fkey FOREIGN KEY (project_contract) REFERENCES public.projects(project_code);


--
-- Name: payroll_processing payroll_processing_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_processing
    ADD CONSTRAINT payroll_processing_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: payroll_processing payroll_processing_project_contract_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_processing
    ADD CONSTRAINT payroll_processing_project_contract_fkey FOREIGN KEY (project_contract) REFERENCES public.projects(project_code);


--
-- Name: production_batch_materials production_batch_materials_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_batch_materials
    ADD CONSTRAINT production_batch_materials_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.production_batches(id) ON DELETE CASCADE;


--
-- Name: production_batch_materials production_batch_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_batch_materials
    ADD CONSTRAINT production_batch_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.raw_materials(id);


--
-- Name: production_batches production_batches_finished_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_batches
    ADD CONSTRAINT production_batches_finished_product_id_fkey FOREIGN KEY (finished_product_id) REFERENCES public.finished_products(id);


--
-- Name: raw_material_purchases raw_material_purchases_accounts_payable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_material_purchases
    ADD CONSTRAINT raw_material_purchases_accounts_payable_id_fkey FOREIGN KEY (accounts_payable_id) REFERENCES public.accounts_payable(id);


--
-- Name: raw_material_purchases raw_material_purchases_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_material_purchases
    ADD CONSTRAINT raw_material_purchases_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.raw_materials(id);


--
-- Name: recruitment_tracker recruitment_tracker_department_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruitment_tracker
    ADD CONSTRAINT recruitment_tracker_department_fkey FOREIGN KEY (department) REFERENCES public.departments(dept_code);


--
-- Name: roster_config roster_config_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_config
    ADD CONSTRAINT roster_config_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


--
-- Name: roster_history roster_history_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_history
    ADD CONSTRAINT roster_history_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: sites sites_assigned_supervisor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_assigned_supervisor_fkey FOREIGN KEY (assigned_supervisor) REFERENCES public.employees(employee_id);


--
-- Name: sites sites_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


--
-- Name: sites sites_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id);


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.finished_products(id);


--
-- Name: user_account_supervisor_sites user_account_supervisor_sites_auth_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account_supervisor_sites
    ADD CONSTRAINT user_account_supervisor_sites_auth_uid_fkey FOREIGN KEY (auth_uid) REFERENCES public.user_accounts(auth_uid) ON DELETE CASCADE;


--
-- Name: user_account_supervisor_sites user_account_supervisor_sites_site_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account_supervisor_sites
    ADD CONSTRAINT user_account_supervisor_sites_site_code_fkey FOREIGN KEY (site_code) REFERENCES public.sites(site_code) ON DELETE CASCADE;


--
-- Name: user_accounts user_accounts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_accounts
    ADD CONSTRAINT user_accounts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id) ON DELETE SET NULL;


--
-- Name: user_accounts user_accounts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_accounts
    ADD CONSTRAINT user_accounts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id);


--
-- Name: work_orders work_orders_assigned_cleaner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_assigned_cleaner_fkey FOREIGN KEY (assigned_cleaner) REFERENCES public.employees(employee_id);


--
-- Name: work_orders work_orders_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


--
-- Name: work_orders work_orders_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(site_code);


--
-- Name: work_orders work_orders_supervisor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_supervisor_fkey FOREIGN KEY (supervisor) REFERENCES public.employees(employee_id);


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: todos Enable read access for all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable read access for all users" ON public.todos FOR SELECT USING (true);


--
-- Name: accounts_payable; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts_payable ENABLE ROW LEVEL SECURITY;

--
-- Name: action_status_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.action_status_options ENABLE ROW LEVEL SECURITY;

--
-- Name: approvers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approvers ENABLE ROW LEVEL SECURITY;

--
-- Name: asset_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: asset_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.asset_register ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_register ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_register attendance_register_hr_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_register_hr_write ON public.attendance_register TO authenticated USING (public.can_access_hr_payroll_data()) WITH CHECK (public.can_access_hr_payroll_data());


--
-- Name: attendance_register attendance_register_self_service_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_register_self_service_select ON public.attendance_register FOR SELECT TO authenticated USING ((public.can_access_hr_payroll_data() OR (staff_id = public.current_user_staff_id())));


--
-- Name: capital_contributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capital_contributions ENABLE ROW LEVEL SECURITY;

--
-- Name: casual_tax_rate_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.casual_tax_rate_config ENABLE ROW LEVEL SECURITY;

--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: clients clients_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_rbac_select ON public.clients FOR SELECT TO authenticated USING (public.can_access_client_record(client_id));


--
-- Name: clients clients_rbac_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_rbac_write ON public.clients TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: complaint_priority_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaint_priority_options ENABLE ROW LEVEL SECURITY;

--
-- Name: complaint_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaint_register ENABLE ROW LEVEL SECURITY;

--
-- Name: complaint_register complaint_register_rbac_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY complaint_register_rbac_delete ON public.complaint_register FOR DELETE TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: complaint_register complaint_register_rbac_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY complaint_register_rbac_insert ON public.complaint_register FOR INSERT TO authenticated WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: complaint_register complaint_register_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY complaint_register_rbac_select ON public.complaint_register FOR SELECT TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: complaint_register complaint_register_rbac_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY complaint_register_rbac_update ON public.complaint_register FOR UPDATE TO authenticated USING (public.can_access_operations_site(site_id)) WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: consumables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consumables ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_status_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_status_options ENABLE ROW LEVEL SECURITY;

--
-- Name: corrective_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corrective_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: corrective_actions corrective_actions_rbac_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corrective_actions_rbac_delete ON public.corrective_actions FOR DELETE TO authenticated USING (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])) OR ((public.current_user_role() = 'supervisor'::public.app_role) AND (((related_work_order IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.work_orders wo
  WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND public.can_access_operations_site(wo.site_id))))) OR ((related_issue_no IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.failed_inspections fi
  WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND public.can_access_operations_site(fi.site_id)))))))));


--
-- Name: corrective_actions corrective_actions_rbac_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corrective_actions_rbac_insert ON public.corrective_actions FOR INSERT TO authenticated WITH CHECK (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])) OR ((public.current_user_role() = 'supervisor'::public.app_role) AND (((related_work_order IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.work_orders wo
  WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND public.can_access_operations_site(wo.site_id))))) OR ((related_issue_no IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.failed_inspections fi
  WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND public.can_access_operations_site(fi.site_id)))))))));


--
-- Name: corrective_actions corrective_actions_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corrective_actions_rbac_select ON public.corrective_actions FOR SELECT TO authenticated USING (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])) OR ((public.current_user_role() = 'supervisor'::public.app_role) AND (((related_work_order IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.work_orders wo
  WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND public.can_access_operations_site(wo.site_id))))) OR ((related_issue_no IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.failed_inspections fi
  WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND public.can_access_operations_site(fi.site_id)))))))));


--
-- Name: corrective_actions corrective_actions_rbac_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corrective_actions_rbac_update ON public.corrective_actions FOR UPDATE TO authenticated USING (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])) OR ((public.current_user_role() = 'supervisor'::public.app_role) AND (((related_work_order IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.work_orders wo
  WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND public.can_access_operations_site(wo.site_id))))) OR ((related_issue_no IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.failed_inspections fi
  WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND public.can_access_operations_site(fi.site_id))))))))) WITH CHECK (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])) OR ((public.current_user_role() = 'supervisor'::public.app_role) AND (((related_work_order IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.work_orders wo
  WHERE ((wo.work_order_no = corrective_actions.related_work_order) AND public.can_access_operations_site(wo.site_id))))) OR ((related_issue_no IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.failed_inspections fi
  WHERE ((fi.issue_no = corrective_actions.related_issue_no) AND public.can_access_operations_site(fi.site_id)))))))));


--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: depreciation_methods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.depreciation_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: disciplinary_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.disciplinary_records ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_employment_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_employment_history ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_leave_balances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_leave_balances ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_leave_balances employee_leave_balances_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_leave_balances_select ON public.employee_leave_balances FOR SELECT TO authenticated USING ((public.can_manage_leave_balances() OR (employee_id = public.current_user_employee_id())));


--
-- Name: employee_leave_balances employee_leave_balances_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_leave_balances_write ON public.employee_leave_balances TO authenticated USING (public.can_manage_leave_balances()) WITH CHECK (public.can_manage_leave_balances());


--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: employees employees_rbac_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_rbac_delete ON public.employees FOR DELETE TO authenticated USING (public.can_write_employee_records());


--
-- Name: employees employees_rbac_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_rbac_insert ON public.employees FOR INSERT TO authenticated WITH CHECK (public.can_write_employee_records());


--
-- Name: employees employees_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_rbac_select ON public.employees FOR SELECT TO authenticated USING ((public.can_access_employee_record(assigned_site_id) OR (employee_id = public.current_user_employee_id())));


--
-- Name: employees employees_rbac_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_rbac_update ON public.employees FOR UPDATE TO authenticated USING (public.can_write_employee_records()) WITH CHECK (public.can_write_employee_records());


--
-- Name: equipment_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equipment_register ENABLE ROW LEVEL SECURITY;

--
-- Name: equipment_status_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equipment_status_options ENABLE ROW LEVEL SECURITY;

--
-- Name: exit_management; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exit_management ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_register ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_subcategories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_subcategories ENABLE ROW LEVEL SECURITY;

--
-- Name: failed_inspections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.failed_inspections ENABLE ROW LEVEL SECURITY;

--
-- Name: failed_inspections failed_inspections_rbac_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY failed_inspections_rbac_delete ON public.failed_inspections FOR DELETE TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: failed_inspections failed_inspections_rbac_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY failed_inspections_rbac_insert ON public.failed_inspections FOR INSERT TO authenticated WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: failed_inspections failed_inspections_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY failed_inspections_rbac_select ON public.failed_inspections FOR SELECT TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: failed_inspections failed_inspections_rbac_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY failed_inspections_rbac_update ON public.failed_inspections FOR UPDATE TO authenticated USING (public.can_access_operations_site(site_id)) WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: fixed_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_register ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_register incident_register_rbac_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_register_rbac_delete ON public.incident_register FOR DELETE TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: incident_register incident_register_rbac_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_register_rbac_insert ON public.incident_register FOR INSERT TO authenticated WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: incident_register incident_register_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_register_rbac_select ON public.incident_register FOR SELECT TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: incident_register incident_register_rbac_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_register_rbac_update ON public.incident_register FOR UPDATE TO authenticated USING (public.can_access_operations_site(site_id)) WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: incident_type_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_type_options ENABLE ROW LEVEL SECURITY;

--
-- Name: income_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.income_register ENABLE ROW LEVEL SECURITY;

--
-- Name: income_register income_register_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY income_register_select ON public.income_register FOR SELECT TO authenticated USING ((public.can_access_finance_income_data() OR ((public.current_user_role() = 'client'::public.app_role) AND (client_id = public.current_user_client_id()) AND (entry_type = 'service'::public.income_entry_type))));


--
-- Name: income_register income_register_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY income_register_write ON public.income_register TO authenticated USING (public.can_access_finance_income_data()) WITH CHECK (public.can_access_finance_income_data());


--
-- Name: inspection_result_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_result_options ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_summary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_summary ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_summary inspection_summary_rbac_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inspection_summary_rbac_delete ON public.inspection_summary FOR DELETE TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: inspection_summary inspection_summary_rbac_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inspection_summary_rbac_insert ON public.inspection_summary FOR INSERT TO authenticated WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: inspection_summary inspection_summary_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inspection_summary_rbac_select ON public.inspection_summary FOR SELECT TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: inspection_summary inspection_summary_rbac_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inspection_summary_rbac_update ON public.inspection_summary FOR UPDATE TO authenticated USING (public.can_access_operations_site(site_id)) WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: leave_approver_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_approver_config ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_approver_config leave_approver_config_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_approver_config_insert ON public.leave_approver_config FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());


--
-- Name: leave_approver_config leave_approver_config_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_approver_config_select ON public.leave_approver_config FOR SELECT TO authenticated USING (true);


--
-- Name: leave_management; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_management ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_requests leave_requests_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_requests_insert ON public.leave_requests FOR INSERT TO authenticated WITH CHECK (((public.current_user_role() = 'employee'::public.app_role) AND (employee_id = public.current_user_employee_id())));


--
-- Name: leave_requests leave_requests_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_requests_select ON public.leave_requests FOR SELECT TO authenticated USING ((public.can_manage_leave_balances() OR (employee_id = public.current_user_employee_id()) OR public.is_assigned_leave_approver(approver_user_account_id)));


--
-- Name: leave_requests leave_requests_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_requests_update ON public.leave_requests FOR UPDATE TO authenticated USING (((employee_id = public.current_user_employee_id()) OR public.is_assigned_leave_approver(approver_user_account_id) OR public.can_manage_leave_balances())) WITH CHECK (((employee_id = public.current_user_employee_id()) OR public.is_assigned_leave_approver(approver_user_account_id) OR public.can_manage_leave_balances()));


--
-- Name: leave_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;

--
-- Name: leave_types leave_types_read_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leave_types_read_authenticated ON public.leave_types FOR SELECT TO authenticated USING (true);


--
-- Name: loan_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_register ENABLE ROW LEVEL SECURITY;

--
-- Name: manual_financial_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manual_financial_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: month_end_close; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.month_end_close ENABLE ROW LEVEL SECURITY;

--
-- Name: operations_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operations_config ENABLE ROW LEVEL SECURITY;

--
-- Name: overtime_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.overtime_register ENABLE ROW LEVEL SECURITY;

--
-- Name: pay_rate_structure; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pay_rate_structure ENABLE ROW LEVEL SECURITY;

--
-- Name: paye_bands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.paye_bands ENABLE ROW LEVEL SECURITY;

--
-- Name: paye_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.paye_config ENABLE ROW LEVEL SECURITY;

--
-- Name: paye_tax_bands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.paye_tax_bands ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_methods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_history ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_history payroll_history_hr_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_history_hr_write ON public.payroll_history TO authenticated USING (public.can_access_hr_payroll_data()) WITH CHECK (public.can_access_hr_payroll_data());


--
-- Name: payroll_history payroll_history_self_service_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_history_self_service_select ON public.payroll_history FOR SELECT TO authenticated USING ((public.can_access_hr_payroll_data() OR (employee_id = public.current_user_employee_id())));


--
-- Name: payroll_link; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_link ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_processing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_processing ENABLE ROW LEVEL SECURITY;

--
-- Name: positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: projects projects_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_admin_write ON public.projects TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: projects projects_client_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_client_select ON public.projects FOR SELECT TO authenticated USING ((public.is_super_admin() OR (public.current_user_role() = ANY (ARRAY['finance'::public.app_role, 'hr'::public.app_role, 'operations_manager'::public.app_role, 'supervisor'::public.app_role])) OR public.client_can_view_roster_project(id)));


--
-- Name: recruitment_tracker; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recruitment_tracker ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_level_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_level_options ENABLE ROW LEVEL SECURITY;

--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: roles roles_read_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_read_authenticated ON public.roles FOR SELECT TO authenticated USING (true);


--
-- Name: roster_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roster_config ENABLE ROW LEVEL SECURITY;

--
-- Name: roster_config roster_config_client_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_config_client_select ON public.roster_config FOR SELECT TO authenticated USING ((public.is_super_admin() OR (public.current_user_role() = ANY (ARRAY['operations_manager'::public.app_role, 'supervisor'::public.app_role])) OR public.can_access_client_record(client_id)));


--
-- Name: roster_config roster_config_ops_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_config_ops_write ON public.roster_config TO authenticated USING ((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role]))) WITH CHECK ((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])));


--
-- Name: roster_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roster_history ENABLE ROW LEVEL SECURITY;

--
-- Name: roster_history roster_history_rbac_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_history_rbac_delete ON public.roster_history FOR DELETE TO authenticated USING ((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])));


--
-- Name: roster_history roster_history_rbac_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_history_rbac_insert ON public.roster_history FOR INSERT TO authenticated WITH CHECK (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])) OR ((public.current_user_role() = 'supervisor'::public.app_role) AND (employee_id IS NOT NULL) AND public.can_access_employee_record(( SELECT e.assigned_site_id
   FROM public.employees e
  WHERE (e.employee_id = roster_history.employee_id))))));


--
-- Name: roster_history roster_history_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_history_rbac_select ON public.roster_history FOR SELECT TO authenticated USING (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role, 'hr'::public.app_role])) OR (public.current_user_role() = 'supervisor'::public.app_role) OR (employee_id = public.current_user_employee_id())));


--
-- Name: roster_history roster_history_rbac_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_history_rbac_update ON public.roster_history FOR UPDATE TO authenticated USING (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])) OR ((public.current_user_role() = 'supervisor'::public.app_role) AND (employee_id IS NOT NULL) AND public.can_access_employee_record(( SELECT e.assigned_site_id
   FROM public.employees e
  WHERE (e.employee_id = roster_history.employee_id)))))) WITH CHECK (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])) OR ((public.current_user_role() = 'supervisor'::public.app_role) AND (employee_id IS NOT NULL) AND public.can_access_employee_record(( SELECT e.assigned_site_id
   FROM public.employees e
  WHERE (e.employee_id = roster_history.employee_id))))));


--
-- Name: salary_rate_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.salary_rate_config ENABLE ROW LEVEL SECURITY;

--
-- Name: service_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;

--
-- Name: severity_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.severity_options ENABLE ROW LEVEL SECURITY;

--
-- Name: sites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

--
-- Name: sites sites_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sites_rbac_select ON public.sites FOR SELECT TO authenticated USING (((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])) OR (public.current_user_role() = 'supervisor'::public.app_role) OR (public.current_user_role() = ANY (ARRAY['finance'::public.app_role, 'hr'::public.app_role])) OR ((public.current_user_role() = 'client'::public.app_role) AND (client_id = public.current_user_client_id()))));


--
-- Name: sites sites_rbac_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sites_rbac_write ON public.sites TO authenticated USING ((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role]))) WITH CHECK ((public.current_user_role() = ANY (ARRAY['super_admin'::public.app_role, 'operations_manager'::public.app_role])));


--
-- Name: ssnit_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ssnit_config ENABLE ROW LEVEL SECURITY;

--
-- Name: ssnit_rate_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ssnit_rate_config ENABLE ROW LEVEL SECURITY;

--
-- Name: ssnit_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ssnit_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts_payable super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.accounts_payable USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: action_status_options super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.action_status_options USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: approvers super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.approvers USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: asset_categories super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.asset_categories USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: asset_register super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.asset_register USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: attendance_register super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.attendance_register USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: capital_contributions super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.capital_contributions USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: casual_tax_rate_config super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.casual_tax_rate_config USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: clients super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.clients USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: complaint_priority_options super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.complaint_priority_options USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: complaint_register super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.complaint_register USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: consumables super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.consumables USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: contract_status_options super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.contract_status_options USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: corrective_actions super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.corrective_actions USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: departments super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.departments USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: depreciation_methods super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.depreciation_methods USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: disciplinary_records super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.disciplinary_records USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: employee_employment_history super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.employee_employment_history USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: employees super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.employees USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: equipment_register super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.equipment_register USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: equipment_status_options super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.equipment_status_options USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: exit_management super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.exit_management USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: expense_categories super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.expense_categories USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: expense_register super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.expense_register USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: expense_subcategories super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.expense_subcategories USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: failed_inspections super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.failed_inspections USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: fixed_assets super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.fixed_assets USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: incident_register super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.incident_register USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: incident_type_options super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.incident_type_options USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: income_register super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.income_register USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: inspection_result_options super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.inspection_result_options USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: inspection_summary super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.inspection_summary USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: leave_management super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.leave_management USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: loan_register super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.loan_register USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: manual_financial_entries super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.manual_financial_entries USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: month_end_close super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.month_end_close USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: operations_config super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.operations_config USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: overtime_register super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.overtime_register USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: pay_rate_structure super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.pay_rate_structure USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: paye_bands super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.paye_bands USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: paye_config super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.paye_config USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: paye_tax_bands super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.paye_tax_bands USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: payment_methods super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.payment_methods USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: payroll_history super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.payroll_history USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: payroll_link super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.payroll_link USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: payroll_processing super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.payroll_processing USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: positions super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.positions USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: projects super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.projects USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: recruitment_tracker super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.recruitment_tracker USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: risk_level_options super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.risk_level_options USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: roster_config super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.roster_config USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: roster_history super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.roster_history USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: salary_rate_config super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.salary_rate_config USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: service_types super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.service_types USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: severity_options super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.severity_options USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: sites super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.sites USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: ssnit_config super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.ssnit_config USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: ssnit_rate_config super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.ssnit_rate_config USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: ssnit_rates super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.ssnit_rates USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: todos super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.todos USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: user_accounts super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.user_accounts USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: work_orders super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.work_orders USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: user_account_supervisor_sites supervisor_sites_super_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supervisor_sites_super_admin_all ON public.user_account_supervisor_sites TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: todos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

--
-- Name: user_account_supervisor_sites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_account_supervisor_sites ENABLE ROW LEVEL SECURITY;

--
-- Name: user_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: user_accounts user_can_read_own_account; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_can_read_own_account ON public.user_accounts FOR SELECT USING ((auth_uid = auth.uid()));


--
-- Name: work_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: work_orders work_orders_rbac_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY work_orders_rbac_delete ON public.work_orders FOR DELETE TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: work_orders work_orders_rbac_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY work_orders_rbac_insert ON public.work_orders FOR INSERT TO authenticated WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: work_orders work_orders_rbac_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY work_orders_rbac_select ON public.work_orders FOR SELECT TO authenticated USING (public.can_access_operations_site(site_id));


--
-- Name: work_orders work_orders_rbac_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY work_orders_rbac_update ON public.work_orders FOR UPDATE TO authenticated USING (public.can_access_operations_site(site_id)) WITH CHECK (public.can_access_operations_site(site_id));


--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: objects authenticated_update_employee_photos; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY authenticated_update_employee_photos ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'employee-photos'::text));


--
-- Name: objects authenticated_upload_employee_photos; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY authenticated_upload_employee_photos ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'employee-photos'::text));


--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: objects public_read_employee_photos; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY public_read_employee_photos ON storage.objects FOR SELECT USING ((bucket_id = 'employee-photos'::text));


--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


--
-- PostgreSQL database dump complete
--

\unrestrict QmIQoaKLbyCc5XlDUyF43QHlyedqX3dIX5NxdCaoq25EN7eN9rZdJY79yPRwuNB

