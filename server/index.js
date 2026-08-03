import "dotenv/config";
import http from "node:http";
import app from "./app.js";
import { attachRealtimeRuntime } from "./realtime/runtime.js";

const port = Number(process.env.PORT) || 3000;
const server = http.createServer(app);
attachRealtimeRuntime(server);

server.listen(port, () => {
  console.log(`CRMP API listening on port ${port}`);
});
