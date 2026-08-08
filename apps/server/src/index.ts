import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createRedisClient } from "@anagrabble/redis";
import { PROTOCOL_VERSION, type HandshakeMessage } from "@anagrabble/protocol";

const PORT = Number(process.env.PORT ?? 8080);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const redis = createRedisClient({ url: REDIS_URL });

redis.on("connect", () => console.log(`[redis] connected to ${REDIS_URL}`));
redis.on("error", (err) => console.error("[redis] connection error", err));

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    redis
      .ping()
      .then(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", redis: "ok" }));
      })
      .catch((err) => {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "degraded", redis: "error", error: String(err) }));
      });
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  console.log("[ws] client connected");

  const handshake: HandshakeMessage = { type: "Handshake", protocolVersion: PROTOCOL_VERSION };
  socket.send(JSON.stringify(handshake));
  socket.send(JSON.stringify({ type: "hello", message: "hello from anagrabble server" }));

  socket.on("message", (data) => {
    console.log("[ws] received", data.toString());
  });

  socket.on("close", () => console.log("[ws] client disconnected"));
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
