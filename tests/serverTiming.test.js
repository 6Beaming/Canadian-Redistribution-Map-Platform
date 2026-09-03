import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  createServerTiming,
  serverTimingMiddleware,
} from "../server/lib/serverTiming.js";

test("server timing middleware emits Server-Timing header", async () => {
  const timing = createServerTiming();
  const span = timing.start("db");
  span.end();
  assert.match(timing.headerValue(), /db;dur=/);
});

test("server timing middleware attaches to response end", async () => {
  const req = {};
  const res = {
    headersSent: false,
    headers: {},
    getHeader(name) {
      return this.headers[name.toLowerCase()] ?? undefined;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end() {},
  };
  const originalEnd = res.end;
  let ended = false;
  res.end = function patchedEnd(...args) {
    ended = true;
    return originalEnd.apply(this, args);
  };

  serverTimingMiddleware(req, res, () => {});
  assert.ok(req.serverTiming);
  req.serverTiming.start("serialize").end();
  res.end();
  assert.equal(ended, true);
  assert.match(res.headers["server-timing"], /total;dur=/);
});
