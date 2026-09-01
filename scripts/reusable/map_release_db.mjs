import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export function loadLocalRelease({ mapRoot = "src/data/map", releaseId } = {}) {
  const root = path.resolve(mapRoot);
  const pointer = JSON.parse(fs.readFileSync(path.join(root, "current-release.json"), "utf8"));
  const selectedReleaseId = releaseId ?? pointer.releaseId;
  const releaseRoot = path.join(root, "releases", selectedReleaseId);
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseRoot, "release.json"), "utf8"));
  if (manifest.releaseId !== selectedReleaseId) {
    throw new Error("Local release manifest identity does not match its directory.");
  }
  if (selectedReleaseId === pointer.releaseId && pointer.manifestSha256 !== manifest.manifestSha256) {
    throw new Error("current-release.json does not match the selected manifest.");
  }
  return {
    root: releaseRoot,
    manifest,
    dguids: JSON.parse(fs.readFileSync(path.join(releaseRoot, "indexes", "dguids.json"), "utf8")).items,
    sharedArcs: JSON.parse(fs.readFileSync(path.join(releaseRoot, "topology", "shared-arcs.index.json"), "utf8")).items,
  };
}

export function requireAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalPair(first, second) {
  const pair = [String(first ?? "").trim(), String(second ?? "").trim()].sort();
  if (!pair[0] || !pair[1] || pair[0] === pair[1]) {
    throw new Error("Two distinct DGUIDs are required.");
  }
  return pair;
}

export function readRangeJson(release, descriptor) {
  const filePath = path.resolve(release.root, descriptor.shard);
  if (!filePath.startsWith(`${path.resolve(release.root)}${path.sep}`)) {
    throw new Error("Release index contains an unsafe shard path.");
  }
  const file = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(descriptor.length);
    const count = fs.readSync(file, buffer, 0, descriptor.length, descriptor.offset);
    if (count !== descriptor.length) {
      throw new Error("Release index byte range is incomplete.");
    }
    return JSON.parse(buffer.toString("utf8").trim());
  } finally {
    fs.closeSync(file);
  }
}

export function redactError(error) {
  return String(error?.message ?? error ?? "unknown error").replace(/[\r\n]+/g, " ").slice(0, 300);
}

