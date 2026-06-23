#!/usr/bin/env node
/**
 * Seed fed_districts from scripts/data/fed_names_2023.json
 *
 * Usage (from repo root):
 *   node scripts/seed_fed_districts.js
 *   npm run seed:fed-districts
 *
 * Requires .env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

dotenv.config({ path: path.join(ROOT, ".env") });

const FED_NAMES_PATH = path.join(ROOT, "scripts", "data", "fed_names_2023.json");
const BATCH_SIZE = 100;
const REP_ORDER = 2023;

const FED_PREFIX_TO_PROVINCE = {
  "10": "NL",
  "11": "PE",
  "12": "NS",
  "13": "NB",
  "24": "QC",
  "35": "ON",
  "46": "MB",
  "47": "SK",
  "48": "AB",
  "59": "BC",
  "60": "YT",
  "61": "NT",
  "62": "NU",
};

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env"
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function loadFedNames() {
  const raw = fs.readFileSync(FED_NAMES_PATH, "utf8");
  const payload = JSON.parse(raw);

  if (typeof payload === "object" && payload !== null && payload.names) {
    return payload.names;
  }

  return payload;
}

function provinceCodeFromFedNum(fedNum) {
  const prefix = String(fedNum).padStart(5, "0").slice(0, 2);
  return FED_PREFIX_TO_PROVINCE[prefix] ?? null;
}

function buildRows(fedNames) {
  return Object.entries(fedNames).map(([fedNum, nameEn]) => ({
    fed_num: String(fedNum).trim(),
    name_en: String(nameEn).trim(),
    rep_order: REP_ORDER,
    province_code: provinceCodeFromFedNum(fedNum),
  }));
}

async function seed() {
  const supabase = getSupabaseAdmin();
  const fedNames = loadFedNames();
  const rows = buildRows(fedNames);

  if (rows.length === 0) {
    throw new Error("No rows found in fed_names_2023.json");
  }

  console.log(`Seeding ${rows.length} fed_districts rows...`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("fed_districts")
      .upsert(batch, { onConflict: "fed_num" });

    if (error) {
      throw new Error(`Batch ${i / BATCH_SIZE + 1} failed: ${error.message}`);
    }

    console.log(
      `  Upserted ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`
    );
  }

  const { count, error: countError } = await supabase
    .from("fed_districts")
    .select("*", { count: "exact", head: true });

  if (countError) {
    throw new Error(`Count check failed: ${countError.message}`);
  }

  console.log(`Done. fed_districts row count: ${count}`);
}

seed().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
