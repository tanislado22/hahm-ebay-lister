import { getSql } from "@/lib/db";
import { preparePricingSettings, type PricingSettingsInput } from "@/lib/markets/guatemala-sale-advice";

let ensuring: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!ensuring) {
    ensuring = createTable().catch((error) => {
      ensuring = null;
      throw error;
    });
  }
  return ensuring;
}

async function createTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS guatemala_pricing_settings (
      client_id TEXT PRIMARY KEY,
      monthly_salary_gtq NUMERIC(12, 2) NOT NULL,
      other_monthly_expenses_gtq NUMERIC(12, 2) NOT NULL,
      expected_monthly_sales INTEGER NOT NULL,
      minimum_profit_gtq NUMERIC(12, 2) NOT NULL
    )
  `;
}

export async function readPricingSettings(clientId: string): Promise<PricingSettingsInput | null> {
  await ensureTable();
  const sql = getSql();
  const rows = await sql`
    SELECT monthly_salary_gtq::text AS monthly_salary_gtq,
      other_monthly_expenses_gtq::text AS other_monthly_expenses_gtq,
      expected_monthly_sales,
      minimum_profit_gtq::text AS minimum_profit_gtq
    FROM guatemala_pricing_settings
    WHERE client_id = ${clientId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const prepared = preparePricingSettings({
    monthlySalaryGtq: row.monthly_salary_gtq,
    otherMonthlyExpensesGtq: row.other_monthly_expenses_gtq,
    expectedMonthlySales: row.expected_monthly_sales,
    minimumProfitGtq: row.minimum_profit_gtq,
  });
  return prepared.ok ? prepared.settings : null;
}

export async function savePricingSettings(
  clientId: string,
  input: {
    monthlySalaryGtq?: unknown;
    otherMonthlyExpensesGtq?: unknown;
    expectedMonthlySales?: unknown;
    minimumProfitGtq?: unknown;
  }
): Promise<{ ok: true; settings: PricingSettingsInput } | { ok: false; error: string }> {
  const prepared = preparePricingSettings(input);
  if (!prepared.ok) return prepared;
  await ensureTable();
  const sql = getSql();
  await sql`
    INSERT INTO guatemala_pricing_settings (
      client_id, monthly_salary_gtq, other_monthly_expenses_gtq, expected_monthly_sales, minimum_profit_gtq
    )
    VALUES (
      ${clientId},
      ${prepared.settings.monthlySalaryGtq}::numeric,
      ${prepared.settings.otherMonthlyExpensesGtq}::numeric,
      ${prepared.settings.expectedMonthlySales},
      ${prepared.settings.minimumProfitGtq}::numeric
    )
    ON CONFLICT (client_id) DO UPDATE SET
      monthly_salary_gtq = EXCLUDED.monthly_salary_gtq,
      other_monthly_expenses_gtq = EXCLUDED.other_monthly_expenses_gtq,
      expected_monthly_sales = EXCLUDED.expected_monthly_sales,
      minimum_profit_gtq = EXCLUDED.minimum_profit_gtq
  `;
  return prepared;
}
