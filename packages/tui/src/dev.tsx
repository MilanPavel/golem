// `just tui`: the chat screen on its own, without the golem command. It can't
// install or restart the service.
import { runTui } from "./main.tsx";

await runTui();
