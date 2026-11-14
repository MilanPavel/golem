import { createLogger } from "../core.ts";
import { configFromEnv } from "./config.ts";
import { startRelay } from "./server.ts";

const log = createLogger((line) => console.log(line));
const relay = startRelay({ ...configFromEnv(process.env), log });
log.event("listening", { count: relay.port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    relay.stop();
    process.exit(0);
  });
}
