/**
 * PostgreSQL Row-Level Security for multi-tenant CRM.
 * Run after schema migration: psql "$DATABASE_URL" -f scripts/setup-postgres-rls.pgsql
 *
 * Application sets per-request: SELECT set_config('app.tenant_id', '<id>', true);
 */
\set ON_ERROR_STOP on

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'users', 'tags', 'clients', 'channels', 'conversations', 'deals', 'parts_stock',
    'quick_templates', 'notifications', 'tasks', 'service_schedule', 'service_appointments',
    'service_settings', 'broadcasts', 'call_logs', 'cdek_settings', 'sto_enterprises',
    'crm_settings', 'sales_documents', 'zzap_settings', 'zzap_price_lists',
    'telephony_settings', 'team_chat_groups', 'ai_proposals', 'parts_buyouts',
    'activity_log', 'payroll_roles', 'payroll_rules', 'payroll_calculations',
    'report_daily_overrides', 'sto_labor_catalog', 'sto_labor_complexes',
    'stock_receipts', 'client_advances', 'documents', 'sales_document_items',
    'subscription_plans', 'tenant_subscriptions', 'invoices', 'tenant_usage',
    'audit_logs', 'support_tickets', 'ticket_replies', 'api_keys', 'tenant_webhooks',
    'webhook_logs', 'license_offer_otps', 'deal_work_sessions', 'deal_labor_items',
    'order_items', 'vehicles', 'client_tags', 'client_comments', 'messages',
    'task_comments', 'team_chat_members', 'team_chat_messages', 'parts_categories',
    'supplier_orders', 'stock_inventory_lines', 'stock_movements', 'deal_diagnostic_items',
    'deal_notes', 'deal_audit_log', 'sto_labor_complex_items', 'payroll_calculation_lines',
    'user_login_sessions', 'user_activity_events'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'skip (no table): %', t;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      RAISE NOTICE 'skip (no tenant_id): %', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::int) '
      || 'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::int)',
      t
    );
    RAISE NOTICE 'RLS policy: %', t;
  END LOOP;
END $$;

-- Без app.tenant_id строки не видны (NULLIF → NULL comparison → false).
