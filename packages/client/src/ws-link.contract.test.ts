import { linkContract } from "./link-contract.ts";
import { startWsServer } from "./ws-test-server.ts";

linkContract("ws link", () => startWsServer());
