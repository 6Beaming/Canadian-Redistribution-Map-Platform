import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountMapApiService } from "./map-api-service/index.js";
import authRouter from "./routes/auth.js";
import commentsRouter from "./routes/comments.js";
import commentTagsRouter from "./routes/commentTags.js";
import workspaceRouter from "./routes/workspace.js";
import workspaceCollaborationRouter from "./routes/workspaceCollaboration.js";
import workspaceStatusRouter from "./routes/workspaceStatus.js";
import archiveRequestsRouter from "./routes/archiveRequests.js";
import submissionsRouter from "./routes/submissions.js";
import submissionListsRouter from "./routes/submissionLists.js";
import exportsRouter from "./routes/exports.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { createRealtimeHarnessRouter } from "./routes/realtimeHarness.js";
import {
  getDefaultRealtimeEventStore,
  syntheticRealtimeEnabled,
} from "./realtime/eventStore.js";


const app = express();
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(currentDirectory, "../dist");
const isProduction = process.env.NODE_ENV === "production";

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed by CORS"));
    }
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
// All submission routes require a verified session. commentsRouter applies the
// role-specific public/commissioner safeguard to each individual operation.
app.use("/api/comments", requireAuth, commentsRouter);
app.use("/api/comment-tags",requireAuth, commentTagsRouter);
app.use("/api/workspace", requireAuth, workspaceCollaborationRouter);
app.use("/api/workspace", requireAuth, workspaceStatusRouter);
app.use("/api/workspace", requireAuth, archiveRequestsRouter);
app.use("/api/workspace", requireAuth, workspaceRouter);
app.use("/api/submissions", requireAuth, submissionListsRouter);
app.use("/api/submissions", requireAuth, submissionsRouter);
app.use("/api/exports", requireAuth, exportsRouter);
if (syntheticRealtimeEnabled()) {
  app.use(
    "/api/realtime/harness",
    requireAuth,
    createRealtimeHarnessRouter(getDefaultRealtimeEventStore()),
  );
}

mountMapApiService(app);

// Docker production serves the Vite SPA and API from one same-origin service.
// Development continues to use Vite's dev server and its /api proxy instead.
if (isProduction) {
  app.use(express.static(distDirectory, {
    index: false,
    maxAge: "1h"
  }));
}

app.use((request, res) => {
  if (isProduction && request.method === "GET" && !request.path.startsWith("/api/")) {
    res.sendFile(path.join(distDirectory, "index.html"));
    return;
  }

  res.status(404).json({ error: "Route not found." });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    error: err.publicMessage || "Something went wrong. Please try again."
  });
});

export default app;
