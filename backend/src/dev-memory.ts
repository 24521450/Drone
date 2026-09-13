import { MongoMemoryServer } from "mongodb-memory-server";

const database = await MongoMemoryServer.create();
process.env.MONGODB_URI = database.getUri("drone_monitor");
process.env.DRONE_MEMORY = "1";

console.log("Temporary MongoDB is ready");
const { shutdown: shutdownServer } = await import("./server.js");
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  await shutdownServer(signal);
  await database.stop();
};
process.once("SIGINT", () => { void shutdown("SIGINT").finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown("SIGTERM").finally(() => process.exit(0)); });
