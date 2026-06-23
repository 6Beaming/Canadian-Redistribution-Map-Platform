#!/usr/bin/env node
/**
 * Seed dissemination_areas (Yukon) from src/data/map/yt_da_profiles.json
 *
 * Usage (from repo root):
 *   node scripts/seed_dissemination_areas_yt.js
 *   npm run seed:dissemination-areas-yt
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

const PROFILES_PATH = path.join(ROOT, "src", "data", "map", "yt_da_profiles.json");
const PROVINCE_CODE = "YT";
const BATCH_SIZE = 50;

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

function loadProfiles() {
  const raw = fs.readFileSync(PROFILES_PATH, "utf8");
  const payload = JSON.parse(raw);
  const profiles = payload?.profiles;

  if (!profiles || typeof profiles !== "object") {
    throw new Error("yt_da_profiles.json is missing a profiles object");
  }

  return { profiles, meta: payload?._meta ?? null };
}

function sourceField(source, field) {
  if (!source || typeof source !== "object") return null;
  const value = source[field];
  return value != null && String(value).trim() ? String(value).trim() : null;
}

function buildRow(dguid, profile) {
  return {
    dguid: String(dguid).trim(),
    dauid: profile.da_code != null ? String(profile.da_code).trim() : null,
    province_code: PROVINCE_CODE,
    geo_name: profile.geo_name != null ? String(profile.geo_name).trim() : null,
    population:
      profile.population != null && !Number.isNaN(Number(profile.population))
        ? Number(profile.population)
        : null,
    community_name:
      profile.community_name != null
        ? String(profile.community_name).trim()
        : null,
    is_unorganized: profile.is_unorganized === true,
    land_area: null,
    status: profile.status != null ? String(profile.status).trim() : "ok",
    source_label: sourceField(profile.source, "label"),
    source_url: sourceField(profile.source, "url"),
  };
}

function buildRows(profiles) {
  return Object.entries(profiles).map(([dguid, profile]) =>
    buildRow(dguid, profile)
  );
}

async function seed() {
  const supabase = getSupabaseAdmin();
  const { profiles, meta } = loadProfiles();
  const rows = buildRows(profiles);

  if (rows.length === 0) {
    throw new Error("No DA profiles found in yt_da_profiles.json");
  }

  console.log(
    `Seeding ${rows.length} dissemination_areas rows for ${PROVINCE_CODE}...`
  );

  if (meta?.dguid_count != null) {
    console.log(`  Source meta: ${meta.dguid_count} DGUIDs in file`);
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("dissemination_areas")
      .upsert(batch, { onConflict: "dguid" });

    if (error) {
      throw new Error(`Batch ${i / BATCH_SIZE + 1} failed: ${error.message}`);
    }

    console.log(
      `  Upserted ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`
    );
  }

  const { count, error: countError } = await supabase
    .from("dissemination_areas")
    .select("*", { count: "exact", head: true })
    .eq("province_code", PROVINCE_CODE);

  if (countError) {
    throw new Error(`Count check failed: ${countError.message}`);
  }

  console.log(`Done. dissemination_areas (${PROVINCE_CODE}) row count: ${count}`);
}

seed().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
