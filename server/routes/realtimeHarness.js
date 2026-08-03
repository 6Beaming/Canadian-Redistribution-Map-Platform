import express from "express";
import { deriveRealtimeScope } from "../realtime/scope.js";

export function createRealtimeHarnessRouter(eventStore) {
  const router = express.Router();

  router.use((req, res, next) => {
    try {
      const scope = deriveRealtimeScope({ profile: req.profile, user: req.user });
      if (scope.role !== "commissioner" || !scope.pruid) {
        res.status(403).json({ error: "The realtime harness is available to Commissioners only." });
        return;
      }
      if (
        typeof eventStore.readResource !== "function"
        || typeof eventStore.commitSyntheticMutation !== "function"
      ) {
        res.status(503).json({ error: "The synthetic realtime harness is not enabled." });
        return;
      }
      req.realtimeScope = scope;
      next();
    } catch {
      res.status(403).json({ error: "Realtime scope is unavailable." });
    }
  });

  router.get("/resource", (req, res) => {
    res.json({
      resource: eventStore.readResource(req.realtimeScope.pruid),
      scope: { kind: "operating-province", pruid: req.realtimeScope.pruid },
    });
  });

  router.post("/mutations", (req, res) => {
    const commit = req.body?.commit !== false;
    const count = Number(req.body?.count ?? 1);
    if (![1, 2].includes(count)) {
      res.status(400).json({ error: "Synthetic mutation count must be 1 or 2." });
      return;
    }
    const result = eventStore.commitSyntheticMutation({
      commit,
      count,
      pruid: req.realtimeScope.pruid,
    });
    res.status(commit ? 201 : 409).json({
      committed: result.committed,
      emittedEventIds: result.events.map((event) => event.eventId),
      resource: result.resource,
    });
  });

  return router;
}

