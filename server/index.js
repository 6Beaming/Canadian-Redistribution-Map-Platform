import dotenv from "dotenv";

// Shell exports (e.g. from `npx supabase start`) must not override project .env.
dotenv.config({ override: true });
import http from "node:http";
import app from "./app.js";
import {
  ensureActiveMapReleaseRegistered,
  ensureSubmissionReleaseBackfill,
} from "./lib/map/mapReleaseGate.js";
import { attachRealtimeRuntime } from "./realtime/runtime.js";

const port = Number(process.env.PORT) || 3000;
const server = http.createServer(app);
attachRealtimeRuntime(server);

async function boot() {
  try {
    await ensureActiveMapReleaseRegistered();
    await ensureSubmissionReleaseBackfill();
  } catch (error) {
    console.warn(`Map release bootstrap skipped: ${error.message}`);
  }

  server.listen(port, () => {
    console.log(`CRMP API listening on port ${port}`);
  });
}

boot();
