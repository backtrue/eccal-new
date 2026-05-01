import { pool } from "../db";

let schemaReady: Promise<void> | null = null;

export function ensureV2Schema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createV2Schema();
  }

  return schemaReady;
}

async function createV2Schema(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id text PRIMARY KEY,
        user_id varchar NOT NULL REFERENCES users(id),
        brand_name varchar NOT NULL,
        company_name varchar,
        website_url varchar,
        industry varchar,
        business_model varchar NOT NULL DEFAULT 'ecommerce',
        primary_market varchar NOT NULL DEFAULT 'TW',
        currency varchar NOT NULL DEFAULT 'TWD',
        language varchar NOT NULL DEFAULT 'zh-TW',
        description text,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS company_financial_profiles (
        id text PRIMARY KEY,
        company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        average_order_value numeric(12, 2),
        gross_margin_rate numeric(5, 4),
        acceptable_ad_cost_rate numeric(5, 4),
        break_even_roas numeric(8, 2),
        target_roas numeric(8, 2),
        target_cpa numeric(12, 2),
        target_cpc numeric(8, 2),
        conversion_rate numeric(8, 4),
        ltv numeric(12, 2),
        return_rate numeric(5, 4),
        shipping_cost_rate numeric(5, 4),
        payment_fee_rate numeric(5, 4),
        notes text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS company_ad_accounts (
        id text PRIMARY KEY,
        company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        platform varchar NOT NULL DEFAULT 'meta',
        ad_account_id varchar NOT NULL,
        ad_account_name varchar,
        currency varchar,
        timezone varchar,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS product_profiles (
        id text PRIMARY KEY,
        company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        sku varchar,
        product_name varchar NOT NULL,
        product_url varchar,
        catalog_id varchar,
        content_id varchar,
        price numeric(12, 2),
        gross_margin_rate numeric(5, 4),
        product_role varchar NOT NULL DEFAULT 'main_product',
        is_consumable boolean DEFAULT false,
        repurchase_cycle_days integer,
        target_persona varchar,
        core_pain_point text,
        main_benefit text,
        fabe_notes jsonb,
        related_product_ids text[],
        notes text,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS decision_rule_sets (
        id text PRIMARY KEY,
        company_id text REFERENCES companies(id) ON DELETE CASCADE,
        name varchar NOT NULL DEFAULT 'default',
        spend_rate_full_threshold numeric(5, 4) NOT NULL DEFAULT 0.95,
        initial_judgement_impressions integer NOT NULL DEFAULT 500,
        stop_loss_impressions integer NOT NULL DEFAULT 8000,
        min_active_ads_per_adset integer NOT NULL DEFAULT 3,
        cpa_warning_multiplier numeric(5, 2) NOT NULL DEFAULT 1.20,
        cpa_stop_multiplier numeric(5, 2) NOT NULL DEFAULT 1.50,
        roas_warning_ratio numeric(5, 2) NOT NULL DEFAULT 0.80,
        ctr_warning_threshold numeric(5, 2) NOT NULL DEFAULT 1.00,
        budget_increase_ratio numeric(5, 2) NOT NULL DEFAULT 0.20,
        budget_decrease_ratio numeric(5, 2) NOT NULL DEFAULT 0.20,
        observation_window_days integer NOT NULL DEFAULT 3,
        protect_learning_phase boolean NOT NULL DEFAULT true,
        avoid_editing_existing_ads boolean NOT NULL DEFAULT true,
        notes text,
        is_default boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ad_action_recommendations (
        id text PRIMARY KEY,
        user_id varchar NOT NULL REFERENCES users(id),
        company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        plan_result_id text REFERENCES plan_results(id),
        ad_account_id varchar NOT NULL,
        recommendation_date timestamp NOT NULL DEFAULT now(),
        decision_mode varchar NOT NULL,
        overall_status varchar NOT NULL,
        priority varchar NOT NULL DEFAULT 'medium',
        action_type varchar NOT NULL,
        target_level varchar NOT NULL,
        target_id varchar,
        target_name varchar,
        reason_summary text NOT NULL,
        detailed_reason text,
        recommended_action text NOT NULL,
        risk_note text,
        metrics_snapshot jsonb NOT NULL,
        rule_snapshot jsonb NOT NULL,
        context_snapshot jsonb,
        approval_status varchar NOT NULL DEFAULT 'pending',
        approved_at timestamp,
        executed_at timestamp,
        rejected_at timestamp,
        operator_note text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ad_action_logs (
        id text PRIMARY KEY,
        recommendation_id text NOT NULL REFERENCES ad_action_recommendations(id) ON DELETE CASCADE,
        user_id varchar NOT NULL REFERENCES users(id),
        company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        action varchar NOT NULL,
        note text,
        metadata jsonb,
        created_at timestamp DEFAULT now()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS companies_user_id_idx ON companies(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS company_ad_accounts_company_id_idx ON company_ad_accounts(company_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ad_action_recommendations_user_company_idx
      ON ad_action_recommendations(user_id, company_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ad_action_logs_recommendation_id_idx
      ON ad_action_logs(recommendation_id)
    `);

    await client.query("COMMIT");
    console.log("[V2_SCHEMA] V2 tables are ready");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[V2_SCHEMA] Failed to prepare V2 tables:", error);
    throw error;
  } finally {
    client.release();
  }
}
