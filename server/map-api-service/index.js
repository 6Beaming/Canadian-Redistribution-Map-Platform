import assetsRouter from "./assets.js";
import profilesRouter from "./profiles.js";
import assignmentsRouter from "./assignments.js";
import statisticsRouter from "./statistics.js";

/**
 * Standalone map API module. Mount once from server/app.js.
 * Serves local map data from src/data/map and persists assignment state server-side.
 */
export function mountMapApiService(app) {
  app.use("/api/map", assetsRouter);
  app.use("/api/map", profilesRouter);
  app.use("/api/map", statisticsRouter);
  app.use("/api/map", assignmentsRouter);
}
