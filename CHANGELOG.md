# Changelog

What changed in each release of golem, newest first. `just release` writes each section from the commit messages on `main` ([CONTRIBUTING.md](CONTRIBUTING.md)), and the release pull request is the place to edit it. The GitHub release shows the same section. How a release is made is in [docs/sre.md](docs/sre.md), section 5.

## [0.19.0] - 2026-11-23

### Features

- **client:** GolemKit's connection, with the relay, Noise and resume from seq ([#759](https://github.com/MilanPavel/golem/pull/759)) ([#1552](https://github.com/MilanPavel/golem/pull/1552))
- **web:** the gateway connects out to the relay and serves paired phones ([#754](https://github.com/MilanPavel/golem/pull/754)) ([#1554](https://github.com/MilanPavel/golem/pull/1554))
- **client:** GolemKit's view state for sessions, approvals and runs ([#760](https://github.com/MilanPavel/golem/pull/760)) ([#1555](https://github.com/MilanPavel/golem/pull/1555))
- **protocol:** pair a phone with golem devices pair and Settings › Devices ([#755](https://github.com/MilanPavel/golem/pull/755)) ([#1557](https://github.com/MilanPavel/golem/pull/1557))
- **client:** the iPhone app, its device key, and QR pairing ([#762](https://github.com/MilanPavel/golem/pull/762)) ([#1562](https://github.com/MilanPavel/golem/pull/1562))
- **web:** helpers are rows under the lead in view, and a fork has a tag ([#1565](https://github.com/MilanPavel/golem/pull/1565)) ([#1569](https://github.com/MilanPavel/golem/pull/1569))
- **daemon:** a finished helper is trimmed to a receipt after 7 days ([#1564](https://github.com/MilanPavel/golem/pull/1564)) ([#1570](https://github.com/MilanPavel/golem/pull/1570))
- **web:** Settings sets how long a finished helper keeps its steps ([#1567](https://github.com/MilanPavel/golem/pull/1567)) ([#1571](https://github.com/MilanPavel/golem/pull/1571))
- **web:** a helper's chat has a banner, and a trimmed helper opens as a receipt ([#1566](https://github.com/MilanPavel/golem/pull/1566)) ([#1572](https://github.com/MilanPavel/golem/pull/1572))
- **daemon:** Continue as chat turns a helper into your own chat ([#1568](https://github.com/MilanPavel/golem/pull/1568)) ([#1573](https://github.com/MilanPavel/golem/pull/1573))
- **client:** a golem://pair link opens pairing in every build ([#762](https://github.com/MilanPavel/golem/pull/762)) ([#1575](https://github.com/MilanPavel/golem/pull/1575))
- **protocol:** the agents list carries the file, its path and why an agent cannot run ([#1583](https://github.com/MilanPavel/golem/pull/1583)) ([#1588](https://github.com/MilanPavel/golem/pull/1588))
- **client:** answer approvals from the iPhone, with Face ID for Always allow ([#764](https://github.com/MilanPavel/golem/pull/764)) ([#1590](https://github.com/MilanPavel/golem/pull/1590))
- **client:** the iPhone Inbox shows what needs you, what runs, and today ([#763](https://github.com/MilanPavel/golem/pull/763)) ([#1589](https://github.com/MilanPavel/golem/pull/1589))
- **daemon:** save, copy and delete your own agent files, with a parse check first ([#1585](https://github.com/MilanPavel/golem/pull/1585)) ([#1592](https://github.com/MilanPavel/golem/pull/1592))
- **web:** Settings › Agents is a list and a detail, with the definition on screen ([#1584](https://github.com/MilanPavel/golem/pull/1584)) ([#1593](https://github.com/MilanPavel/golem/pull/1593))
- **client:** the iPhone says when it can't reach your Mac and keeps answers until it can ([#766](https://github.com/MilanPavel/golem/pull/766)) ([#1594](https://github.com/MilanPavel/golem/pull/1594))
- **web:** edit, add, copy and delete your own agents in Settings ([#1586](https://github.com/MilanPavel/golem/pull/1586)) ([#1598](https://github.com/MilanPavel/golem/pull/1598))
- **client:** read a session, reply, and start a new task from the iPhone ([#765](https://github.com/MilanPavel/golem/pull/765)) ([#1596](https://github.com/MilanPavel/golem/pull/1596))
- **tui:** /agents opens an agent to read it, and copies, edits and deletes your own ([#1587](https://github.com/MilanPavel/golem/pull/1587)) ([#1595](https://github.com/MilanPavel/golem/pull/1595))
- **web:** Settings hides the Sessions panel, and Back replaces the close button ([#1605](https://github.com/MilanPavel/golem/pull/1605))
- **daemon:** git.info and git.branches tell the page about a folder's repo ([#1616](https://github.com/MilanPavel/golem/pull/1616))
- **web:** model, folder and controls sit in one row inside the composer ([#1615](https://github.com/MilanPavel/golem/pull/1615))
- **daemon:** fs.choose_folder opens the macOS folder dialog for a page on this Mac ([#1617](https://github.com/MilanPavel/golem/pull/1617))
- **daemon:** a session knows its branch and tells its model when it changes ([#1619](https://github.com/MilanPavel/golem/pull/1619))
- **daemon:** a new session can start on another branch of its folder ([#1618](https://github.com/MilanPavel/golem/pull/1618))
- **web:** a bigger app icon, the golem carved in stone ([#1621](https://github.com/MilanPavel/golem/pull/1621))
- **web:** the folder menu offers recent folders, worktrees and the macOS dialog ([#1622](https://github.com/MilanPavel/golem/pull/1622))
- **web:** a branch chip in the composer starts a session on another branch ([#1623](https://github.com/MilanPavel/golem/pull/1623))
- **daemon:** fs.reveal opens a folder in Finder, and the folder menus offer it ([#1625](https://github.com/MilanPavel/golem/pull/1625))
- **daemon:** [agents] and [agents.<type>] set the limits of a helper, over its agent file ([#1333](https://github.com/MilanPavel/golem/pull/1333)) ([#1644](https://github.com/MilanPavel/golem/pull/1644))
- **web:** Settings gets a Chat page with what the chat shows ([#1645](https://github.com/MilanPavel/golem/pull/1645))
- **daemon:** defaults for new chats, and your instruction lines in the prompt ([#1646](https://github.com/MilanPavel/golem/pull/1646))
- **daemon:** a helper's time limit counts working time, not waiting, and survives a restart ([#1334](https://github.com/MilanPavel/golem/pull/1334)) ([#1647](https://github.com/MilanPavel/golem/pull/1647))
- **web:** MCP servers show a sign-in line, and a new token is tested before it is kept ([#1648](https://github.com/MilanPavel/golem/pull/1648))
- **daemon:** chat.prompt shows what a new chat's model reads ([#1652](https://github.com/MilanPavel/golem/pull/1652))
- **web:** Chat settings choose how far it goes alone, and Tool rules links to it ([#1653](https://github.com/MilanPavel/golem/pull/1653))
- **daemon:** a helper stops at its cost and token limits too, and says how far it got ([#1335](https://github.com/MilanPavel/golem/pull/1335)) ([#1654](https://github.com/MilanPavel/golem/pull/1654))
- **daemon:** chat.draft drafts instruction lines from your own words ([#1655](https://github.com/MilanPavel/golem/pull/1655))
- **daemon:** Ollama settings can be read and changed over the wire ([#1657](https://github.com/MilanPavel/golem/pull/1657))
- **daemon:** agents.set_limits sets the limits of a helper type, agents.list shows them ([#1656](https://github.com/MilanPavel/golem/pull/1656)) ([#1658](https://github.com/MilanPavel/golem/pull/1658))
- **web:** Chat settings has Your instructions, with what the model reads ([#1659](https://github.com/MilanPavel/golem/pull/1659))
- **daemon:** hf.search and hf.files look up GGUF models on Hugging Face and check what fits ([#1641](https://github.com/MilanPavel/golem/pull/1641)) ([#1661](https://github.com/MilanPavel/golem/pull/1661))
- **web:** Settings › Agents sets the limits of each helper type and of every helper ([#1339](https://github.com/MilanPavel/golem/pull/1339)) ([#1660](https://github.com/MilanPavel/golem/pull/1660))
- **tui:** /agents shows the limits a helper really runs with, and those of every helper ([#1340](https://github.com/MilanPavel/golem/pull/1340)) ([#1664](https://github.com/MilanPavel/golem/pull/1664))
- **daemon:** chat.suggestions suggests instruction lines from your chats and memory ([#1663](https://github.com/MilanPavel/golem/pull/1663))
- **models:** stars decide the model menu ([#1662](https://github.com/MilanPavel/golem/pull/1662))
- **daemon:** a pure policy says when a helper is worth starting, and in which shape ([#1311](https://github.com/MilanPavel/golem/pull/1311)) ([#1665](https://github.com/MilanPavel/golem/pull/1665))
- **protocol:** the "Use helpers" setting and a batch pending item old clients never see ([#1315](https://github.com/MilanPavel/golem/pull/1315)) ([#1666](https://github.com/MilanPavel/golem/pull/1666))
- **daemon:** the delegate prompt gives the reasons and a line per agent type, by tier ([#1313](https://github.com/MilanPavel/golem/pull/1313)) ([#1668](https://github.com/MilanPavel/golem/pull/1668))
- **web:** Settings › Models replaces API keys ([#1670](https://github.com/MilanPavel/golem/pull/1670))
- **web:** find and download a model from Hugging Face in Get models ([#1673](https://github.com/MilanPavel/golem/pull/1673))
- **daemon:** "Use helpers" is applied: never hides delegate, ask parks the lead first ([#1317](https://github.com/MilanPavel/golem/pull/1317)) ([#1672](https://github.com/MilanPavel/golem/pull/1672))
- **web:** browser checks for Settings › Chat, Models and MCP tokens, and a guide for them ([#1674](https://github.com/MilanPavel/golem/pull/1674))
- **daemon:** golem evals helpers measures helpers on and off in four arms ([#1319](https://github.com/MilanPavel/golem/pull/1319)) ([#1675](https://github.com/MilanPavel/golem/pull/1675))
- **web:** Settings › Agents has "Use helpers", and "Ask me first" shows a card with Run ([#1323](https://github.com/MilanPavel/golem/pull/1323)) ([#1676](https://github.com/MilanPavel/golem/pull/1676))
- **tui:** /agents sets "Use helpers", and "Ask me first" asks before helpers start ([#1324](https://github.com/MilanPavel/golem/pull/1324)) ([#1680](https://github.com/MilanPavel/golem/pull/1680))
- **web:** the composer starts taller and stops growing at 40% of the window ([#1681](https://github.com/MilanPavel/golem/pull/1681))

### Fixes

- **daemon:** a lead can name any ready hosted model for a helper, loosely written too ([#1558](https://github.com/MilanPavel/golem/pull/1558)) ([#1560](https://github.com/MilanPavel/golem/pull/1560))
- **tools:** delegate needs an agent and no longer starts an explorer by default ([#1576](https://github.com/MilanPavel/golem/pull/1576)) ([#1577](https://github.com/MilanPavel/golem/pull/1577))
- **client:** GolemKit's relay tests no longer hang ([#1556](https://github.com/MilanPavel/golem/pull/1556)) ([#1579](https://github.com/MilanPavel/golem/pull/1579))
- **sessions:** a helper's time limit fires, the manager no longer overwrites its clock ([#1578](https://github.com/MilanPavel/golem/pull/1578)) ([#1580](https://github.com/MilanPavel/golem/pull/1580))
- **client:** the iPhone app says why it asks for Face ID, so iOS does not end it ([#1597](https://github.com/MilanPavel/golem/pull/1597))
- **web:** centre the app icon's golem, and version the icon URLs so installed apps update ([#1626](https://github.com/MilanPavel/golem/pull/1626))
- **daemon:** the branch tests use a folder that is really outside a repo ([#1649](https://github.com/MilanPavel/golem/pull/1649)) ([#1650](https://github.com/MilanPavel/golem/pull/1650))

### Docs

- ADR-051 records the pairing wire settled in #755 ([#1561](https://github.com/MilanPavel/golem/pull/1561))

## [0.18.0] - 2026-11-21

### Features

- **daemon:** the lead's log names the model a helper ran on after a no ([#1520](https://github.com/MilanPavel/golem/pull/1520)) ([#1528](https://github.com/MilanPavel/golem/pull/1528))
- **daemon:** a bundled type's wish is a config key, not a copy of its file ([#1524](https://github.com/MilanPavel/golem/pull/1524)) ([#1530](https://github.com/MilanPavel/golem/pull/1530))
- **protocol:** model.routed has the reasons of a helper's pick ([#1521](https://github.com/MilanPavel/golem/pull/1521)) ([#1529](https://github.com/MilanPavel/golem/pull/1529))
- **daemon:** cost.get splits the helpers' cost by agent type ([#1522](https://github.com/MilanPavel/golem/pull/1522)) ([#1531](https://github.com/MilanPavel/golem/pull/1531))
- **daemon:** a helper's paid question says what is sent and what is not ([#1328](https://github.com/MilanPavel/golem/pull/1328)) ([#1534](https://github.com/MilanPavel/golem/pull/1534))
- **protocol:** a summary lists its pending items, and approval.respond has a batch scope ([#1325](https://github.com/MilanPavel/golem/pull/1325)) ([#1535](https://github.com/MilanPavel/golem/pull/1535))
- **client:** the Inbox model groups a lead's helper questions, with scopes and a count ([#1329](https://github.com/MilanPavel/golem/pull/1329)) ([#1537](https://github.com/MilanPavel/golem/pull/1537))
- **daemon:** a lead lists its helpers' pending questions, the same one once with a count ([#1326](https://github.com/MilanPavel/golem/pull/1326)) ([#1536](https://github.com/MilanPavel/golem/pull/1536))
- **web:** a helper's question is answered from the lead's dock and the Inbox, with scopes ([#1330](https://github.com/MilanPavel/golem/pull/1330)) ([#1538](https://github.com/MilanPavel/golem/pull/1538))
- **relay:** a container and a page to run your own relay ([#751](https://github.com/MilanPavel/golem/pull/751)) ([#1540](https://github.com/MilanPavel/golem/pull/1540))
- **daemon:** the device registry, the Mac's relay keys, and the gateway's relay methods ([#1008](https://github.com/MilanPavel/golem/pull/1008)) ([#1539](https://github.com/MilanPavel/golem/pull/1539))
- **tui:** the approval band shows a helper's question, with keys for the scopes ([#1331](https://github.com/MilanPavel/golem/pull/1331)) ([#1542](https://github.com/MilanPavel/golem/pull/1542))
- **daemon:** approval.respond with scope batch answers all helpers of a call ([#1327](https://github.com/MilanPavel/golem/pull/1327)) ([#1541](https://github.com/MilanPavel/golem/pull/1541))
- **daemon:** a helper's question notifies once, as its lead ([#1332](https://github.com/MilanPavel/golem/pull/1332)) ([#1549](https://github.com/MilanPavel/golem/pull/1549))

### Fixes

- **daemon:** a helper's step that lands after its run ended is dropped ([#1532](https://github.com/MilanPavel/golem/pull/1532)) ([#1533](https://github.com/MilanPavel/golem/pull/1533))

## [0.17.0] - 2026-11-20

### Features

- **web:** Runs list at /runs and a routine banner on a session, with run.list ([#787](https://github.com/MilanPavel/golem/pull/787)) ([#1174](https://github.com/MilanPavel/golem/pull/1174))
- **tui:** /routines and /runs list routines and what they did, in the manager style ([#1175](https://github.com/MilanPavel/golem/pull/1175))
- **web:** the session row shows a folder icon, and the time moves to the folder line ([#1176](https://github.com/MilanPavel/golem/pull/1176)) ([#1179](https://github.com/MilanPavel/golem/pull/1179))
- **web:** make and edit a file-watch routine in the web page and the terminal ([#1192](https://github.com/MilanPavel/golem/pull/1192))
- **tui:** banner and runs: N waiting segment when a routine needs you in another session ([#780](https://github.com/MilanPavel/golem/pull/780)) ([#1191](https://github.com/MilanPavel/golem/pull/1191))
- **web:** inline source chips with hover cards and a Sources list for web answers ([#1194](https://github.com/MilanPavel/golem/pull/1194))
- **protocol:** agents.list, agents.get and agent.registry.changed ([#1229](https://github.com/MilanPavel/golem/pull/1229)) ([#1292](https://github.com/MilanPavel/golem/pull/1292))
- **models:** the engine profile, with Ollama as its first instance ([#1231](https://github.com/MilanPavel/golem/pull/1231)) ([#1293](https://github.com/MilanPavel/golem/pull/1293))
- **models:** golem passes its slot count to an Ollama it owns and restarts it between calls ([#1226](https://github.com/MilanPavel/golem/pull/1226)) ([#1295](https://github.com/MilanPavel/golem/pull/1295))
- **daemon:** the memory privacy check, [memory] settings and the project key ([#1281](https://github.com/MilanPavel/golem/pull/1281)) ([#1294](https://github.com/MilanPavel/golem/pull/1294))
- **daemon:** the memory store: memory.db, records and word search ([#1280](https://github.com/MilanPavel/golem/pull/1280)) ([#1296](https://github.com/MilanPavel/golem/pull/1296))
- **protocol:** parent and agent on session.created and the session summary ([#1239](https://github.com/MilanPavel/golem/pull/1239)) ([#1299](https://github.com/MilanPavel/golem/pull/1299))
- **protocol:** the helper.* events for helper sessions ([#1241](https://github.com/MilanPavel/golem/pull/1241)) ([#1419](https://github.com/MilanPavel/golem/pull/1419))
- **models:** the dispatcher core: lines, one order, aging and a live slot count ([#1233](https://github.com/MilanPavel/golem/pull/1233)) ([#1420](https://github.com/MilanPavel/golem/pull/1420))
- **models:** every local model call takes its slot from the dispatcher ([#1236](https://github.com/MilanPavel/golem/pull/1236)) ([#1421](https://github.com/MilanPavel/golem/pull/1421))
- **daemon:** the memory service and a per-run memory access with the privacy rules ([#1283](https://github.com/MilanPavel/golem/pull/1283)) ([#1422](https://github.com/MilanPavel/golem/pull/1422))
- **daemon:** the store knows a helper session: parent, call, agent and the lead's wait ([#1242](https://github.com/MilanPavel/golem/pull/1242)) ([#1423](https://github.com/MilanPavel/golem/pull/1423))
- **protocol:** the memory.* methods and the memory.changed notification ([#1282](https://github.com/MilanPavel/golem/pull/1282)) ([#1424](https://github.com/MilanPavel/golem/pull/1424))
- **daemon:** delegate parks the lead while its helpers run and wakes it with their results ([#1245](https://github.com/MilanPavel/golem/pull/1245)) ([#1425](https://github.com/MilanPavel/golem/pull/1425))
- **client:** the rows of the agents list in the view package ([#1234](https://github.com/MilanPavel/golem/pull/1234)) ([#1426](https://github.com/MilanPavel/golem/pull/1426))
- **models:** hosted chat calls go through a provider line with a cap and a shared backoff ([#1238](https://github.com/MilanPavel/golem/pull/1238)) ([#1427](https://github.com/MilanPavel/golem/pull/1427))
- **models:** a probe that asks an external Ollama whether it runs two calls at once ([#1228](https://github.com/MilanPavel/golem/pull/1228)) ([#1428](https://github.com/MilanPavel/golem/pull/1428))
- **models:** a benchmark runner for a local model at 1 to 4 calls at once ([#1268](https://github.com/MilanPavel/golem/pull/1268)) ([#1429](https://github.com/MilanPavel/golem/pull/1429))
- **daemon:** the daemon answers memory.* and tells every connection of a change ([#1284](https://github.com/MilanPavel/golem/pull/1284)) ([#1430](https://github.com/MilanPavel/golem/pull/1430))
- **sessions:** a helper starts once as its own session, linked to its lead ([#1244](https://github.com/MilanPavel/golem/pull/1244)) ([#1431](https://github.com/MilanPavel/golem/pull/1431))
- **client:** the chat reducer folds helper.* events into the helper line ([#1251](https://github.com/MilanPavel/golem/pull/1251)) ([#1432](https://github.com/MilanPavel/golem/pull/1432))
- **models:** the window plan counts the KV cache of every slot ([#1240](https://github.com/MilanPavel/golem/pull/1240)) ([#1434](https://github.com/MilanPavel/golem/pull/1434))
- **tools:** the recall and remember tools for long-term memory ([#1285](https://github.com/MilanPavel/golem/pull/1285)) ([#1435](https://github.com/MilanPavel/golem/pull/1435))
- **protocol:** model.bench and its progress and done notifications ([#1269](https://github.com/MilanPavel/golem/pull/1269)) ([#1436](https://github.com/MilanPavel/golem/pull/1436))
- **sessions:** a helper survives a restart and a cancelled lead takes its helpers along ([#1247](https://github.com/MilanPavel/golem/pull/1247)) ([#1438](https://github.com/MilanPavel/golem/pull/1438))
- **models:** parallel takes "auto", and a resolver for how many calls fit at once ([#1243](https://github.com/MilanPavel/golem/pull/1243)) ([#1441](https://github.com/MilanPavel/golem/pull/1441))
- **protocol:** model.waiting can say why a call waits ([#1246](https://github.com/MilanPavel/golem/pull/1246)) ([#1442](https://github.com/MilanPavel/golem/pull/1442))
- **client:** the shared words of the memory screens, and a /memory command ([#1287](https://github.com/MilanPavel/golem/pull/1287)) ([#1443](https://github.com/MilanPavel/golem/pull/1443))
- **daemon:** memory reaches a live run, and a hosted call gets stubs for local notes ([#1439](https://github.com/MilanPavel/golem/pull/1439)) ([#1444](https://github.com/MilanPavel/golem/pull/1444))
- **models:** the daemon answers model.bench and sends a row for each count ([#1440](https://github.com/MilanPavel/golem/pull/1440)) ([#1445](https://github.com/MilanPavel/golem/pull/1445))
- **sessions:** a lead's trace and artifacts include its helper sessions ([#1249](https://github.com/MilanPavel/golem/pull/1249)) ([#1447](https://github.com/MilanPavel/golem/pull/1447))
- **models:** a store for benchmark results, and parallel = "auto" reads it ([#1270](https://github.com/MilanPavel/golem/pull/1270)) ([#1446](https://github.com/MilanPavel/golem/pull/1446))
- **web:** Settings › Memory lists, edits, deletes and exports every memory ([#1288](https://github.com/MilanPavel/golem/pull/1288)) ([#1451](https://github.com/MilanPavel/golem/pull/1451))
- **cli:** golem models check --parallel prints the speed at each count ([#1271](https://github.com/MilanPavel/golem/pull/1271)) ([#1450](https://github.com/MilanPavel/golem/pull/1450))
- **tui:** /memory lists, searches, edits, deletes and exports every memory ([#1289](https://github.com/MilanPavel/golem/pull/1289)) ([#1454](https://github.com/MilanPavel/golem/pull/1454))
- **models:** a finished model.bench run is saved to the store ([#1452](https://github.com/MilanPavel/golem/pull/1452)) ([#1455](https://github.com/MilanPavel/golem/pull/1455))
- **sessions:** the explorer runs as a child session, and the old child-run path is gone ([#1256](https://github.com/MilanPavel/golem/pull/1256)) ([#1453](https://github.com/MilanPavel/golem/pull/1453))
- **daemon:** the prompt has a memory section with your notes for every chat ([#1286](https://github.com/MilanPavel/golem/pull/1286)) ([#1457](https://github.com/MilanPavel/golem/pull/1457))
- **client:** a sentence for each of the seven wait reasons, for web and terminal ([#1250](https://github.com/MilanPavel/golem/pull/1250)) ([#1458](https://github.com/MilanPavel/golem/pull/1458))
- **protocol:** helper.step carries the step's one-line summary ([#1456](https://github.com/MilanPavel/golem/pull/1456)) ([#1459](https://github.com/MilanPavel/golem/pull/1459))
- **daemon:** agent types as files: parser, registry and four bundled agents ([#1227](https://github.com/MilanPavel/golem/pull/1227)) ([#1460](https://github.com/MilanPavel/golem/pull/1460))
- **daemon:** each wait is sent with its reason, line, place and holder ([#1248](https://github.com/MilanPavel/golem/pull/1248)) ([#1466](https://github.com/MilanPavel/golem/pull/1466))
- **protocol:** the session summary carries the open wait, and the list shows queued ([#1467](https://github.com/MilanPavel/golem/pull/1467)) ([#1469](https://github.com/MilanPavel/golem/pull/1469))
- **daemon:** the daemon answers agents.list and agents.get, with used and finished counts ([#1230](https://github.com/MilanPavel/golem/pull/1230)) ([#1470](https://github.com/MilanPavel/golem/pull/1470))
- **daemon:** delegate takes any registered agent type, and the explorer runs from its file ([#1232](https://github.com/MilanPavel/golem/pull/1232)) ([#1471](https://github.com/MilanPavel/golem/pull/1471))
- **tui:** /agents lists the agent types, with used and finished counts and a detail view ([#1237](https://github.com/MilanPavel/golem/pull/1237)) ([#1472](https://github.com/MilanPavel/golem/pull/1472))
- **web:** Settings › Agents lists the agent types with used and finished counts ([#1235](https://github.com/MilanPavel/golem/pull/1235)) ([#1473](https://github.com/MilanPavel/golem/pull/1473))
- **protocol:** helper.stop, and helper counts and a helper's newest step on the summary ([#1349](https://github.com/MilanPavel/golem/pull/1349)) ([#1476](https://github.com/MilanPavel/golem/pull/1476))
- **web:** helpers are not rows in the session list; the lead's row shows one square each ([#1474](https://github.com/MilanPavel/golem/pull/1474)) ([#1477](https://github.com/MilanPavel/golem/pull/1477))
- **client:** the view has a model for the helper batch card and a helper's summary ([#1341](https://github.com/MilanPavel/golem/pull/1341)) ([#1478](https://github.com/MilanPavel/golem/pull/1478))
- **daemon:** helper.stop, helper counts on the lead's summary, a helper's newest step ([#1350](https://github.com/MilanPavel/golem/pull/1350)) ([#1480](https://github.com/MilanPavel/golem/pull/1480))
- **web:** a helper opens in a panel beside the lead's chat, with Summary and Everything ([#1344](https://github.com/MilanPavel/golem/pull/1344)) ([#1481](https://github.com/MilanPavel/golem/pull/1481))
- **client:** the view has a steps list with a time bar per row ([#1342](https://github.com/MilanPavel/golem/pull/1342)) ([#1482](https://github.com/MilanPavel/golem/pull/1482))
- **web:** a batch of helpers is a card in the transcript, and a row opens its helper ([#1343](https://github.com/MilanPavel/golem/pull/1343)) ([#1483](https://github.com/MilanPavel/golem/pull/1483))
- **web:** the lead's row shows a card of its helpers, with Open, Stop and answers ([#1475](https://github.com/MilanPavel/golem/pull/1475)) ([#1484](https://github.com/MilanPavel/golem/pull/1484))
- **web:** the drawer has a Steps tab with a time bar per helper ([#1345](https://github.com/MilanPavel/golem/pull/1345)) ([#1485](https://github.com/MilanPavel/golem/pull/1485))
- **tui:** a batch of helpers is a tree under the turn ([#1347](https://github.com/MilanPavel/golem/pull/1347)) ([#1486](https://github.com/MilanPavel/golem/pull/1486))
- **tui:** /steps shows a batch's Steps full screen and a helper's chat, read-only ([#1348](https://github.com/MilanPavel/golem/pull/1348)) ([#1494](https://github.com/MilanPavel/golem/pull/1494))
- **web:** Runs shows the leads with helpers at work, each over its step list ([#1346](https://github.com/MilanPavel/golem/pull/1346)) ([#1493](https://github.com/MilanPavel/golem/pull/1493))
- **web:** Settings Info page: a hero card, health first, and where things live ([#1492](https://github.com/MilanPavel/golem/pull/1492)) ([#1496](https://github.com/MilanPavel/golem/pull/1496))
- **web:** settings has a grouped sidebar, and Setup becomes Info ([#1495](https://github.com/MilanPavel/golem/pull/1495))
- **protocol:** the paid question can name the helper and what is sent ([#1302](https://github.com/MilanPavel/golem/pull/1302)) ([#1497](https://github.com/MilanPavel/golem/pull/1497))
- **models:** a pure pick_helper turns a helper's wish into a model ([#1300](https://github.com/MilanPavel/golem/pull/1300)) ([#1498](https://github.com/MilanPavel/golem/pull/1498))
- **web:** Settings sidebar badges for what needs attention ([#1499](https://github.com/MilanPavel/golem/pull/1499))
- **web:** Settings search finds sections and the options inside them ([#1500](https://github.com/MilanPavel/golem/pull/1500))
- **protocol:** what a wish becomes, and agents.set_wish ([#1304](https://github.com/MilanPavel/golem/pull/1304)) ([#1501](https://github.com/MilanPavel/golem/pull/1501))
- **daemon:** a helper starts on the model its wish picks ([#1301](https://github.com/MilanPavel/golem/pull/1301)) ([#1502](https://github.com/MilanPavel/golem/pull/1502))
- **daemon:** a helper asks the paid question before its first paid call ([#1303](https://github.com/MilanPavel/golem/pull/1303)) ([#1509](https://github.com/MilanPavel/golem/pull/1509))
- **web:** type tokens, a Code primitive, a font-mono lint warning, and the font-sans fix ([#1510](https://github.com/MilanPavel/golem/pull/1510))
- **web:** Settings › Agents has a wish dropdown per type, and Usage shows what helpers cost ([#1306](https://github.com/MilanPavel/golem/pull/1306)) ([#1511](https://github.com/MilanPavel/golem/pull/1511))
- **daemon:** agents.set_wish, and what each agent type's wish becomes ([#1305](https://github.com/MilanPavel/golem/pull/1305)) ([#1512](https://github.com/MilanPavel/golem/pull/1512))
- **daemon:** eval routing lists the helpers and what their wish picks now ([#1309](https://github.com/MilanPavel/golem/pull/1309)) ([#1513](https://github.com/MilanPavel/golem/pull/1513))
- **tui:** /agents shows what each wish becomes ([#1307](https://github.com/MilanPavel/golem/pull/1307)) ([#1514](https://github.com/MilanPavel/golem/pull/1514))
- **web:** Settings sidebar, page head and Info page in one typographic voice ([#1515](https://github.com/MilanPavel/golem/pull/1515))
- **web:** Settings sections in one typographic voice ([#1506](https://github.com/MilanPavel/golem/pull/1506)) ([#1516](https://github.com/MilanPavel/golem/pull/1516))
- **daemon:** delegate takes an optional model for one helper ([#1487](https://github.com/MilanPavel/golem/pull/1487)) ([#1517](https://github.com/MilanPavel/golem/pull/1517))
- **web:** sidebar, shell, welcome, palette, models, routines and runs in one voice ([#1507](https://github.com/MilanPavel/golem/pull/1507)) ([#1518](https://github.com/MilanPavel/golem/pull/1518))
- **web:** chat, composer, workbench, trace, diff and approval in one voice ([#1519](https://github.com/MilanPavel/golem/pull/1519))
- **tui:** a wish can be changed in /agents ([#1523](https://github.com/MilanPavel/golem/pull/1523)) ([#1525](https://github.com/MilanPavel/golem/pull/1525))
- **web:** the sessions panel steps aside while Settings is open ([#1526](https://github.com/MilanPavel/golem/pull/1526))

### Fixes

- **daemon:** verify TLS against the OS trust store, so web_fetch works behind an intercepting proxy ([#1178](https://github.com/MilanPavel/golem/pull/1178))
- **tui:** open without crashing when the client is already connected ([#1190](https://github.com/MilanPavel/golem/pull/1190))
- **web:** a routine prompt chip moves the caret in the same render, not a later frame ([#1196](https://github.com/MilanPavel/golem/pull/1196))
- **web:** the routine editor's "On new file" test no longer races the default preview ([#1297](https://github.com/MilanPavel/golem/pull/1297)) ([#1298](https://github.com/MilanPavel/golem/pull/1298))
- **sessions:** a cancel that meets a run as it parks still ends it ([#1464](https://github.com/MilanPavel/golem/pull/1464)) ([#1465](https://github.com/MilanPavel/golem/pull/1465))
- **sessions:** a helper's summary says its lead and its agent type ([#1474](https://github.com/MilanPavel/golem/pull/1474)) ([#1479](https://github.com/MilanPavel/golem/pull/1479))

### Docs

- new demos (chat with sources, coding, routines, terminal) for the README and the docs home ([#1197](https://github.com/MilanPavel/golem/pull/1197))
- helpers are child sessions, the dispatcher, and memory (ADR-059, 060, 061) ([#1291](https://github.com/MilanPavel/golem/pull/1291))
- **docs:** what memory stores, who may write it, where it may go, and how to manage it ([#1290](https://github.com/MilanPavel/golem/pull/1290)) ([#1463](https://github.com/MilanPavel/golem/pull/1463))

## [0.16.0] - 2026-11-17

### Features

- **tui:** a finished turn ends in a row of its changes, and the status line shows Δ files ([#1053](https://github.com/MilanPavel/golem/pull/1053))
- **tui:** /undo takes back the last turn, and /changes undoes a hunk or file ([#1054](https://github.com/MilanPavel/golem/pull/1054))
- **web:** review notes on diff lines in the Changes tab ([#1055](https://github.com/MilanPavel/golem/pull/1055))
- **tools:** edit_file forgives spacing and indentation, and a miss quotes the closest lines ([#1056](https://github.com/MilanPavel/golem/pull/1056))
- **sessions:** the model is told when its changes were undone ([#1062](https://github.com/MilanPavel/golem/pull/1062))
- **web:** Commit… in the Changes tab and g in /changes commit the session's files ([#1058](https://github.com/MilanPavel/golem/pull/1058))
- **web:** the chat, the meter and the trace show when golem changes the context ([#1063](https://github.com/MilanPavel/golem/pull/1063))
- checks show under the turn, in a Checks tab, and as a question before they run ([#1057](https://github.com/MilanPavel/golem/pull/1057))
- **tools:** delegate hands a reading job to an explorer with an empty context ([#1066](https://github.com/MilanPavel/golem/pull/1066))
- **web:** the Changes tab groups changes by turn ([#1059](https://github.com/MilanPavel/golem/pull/1059))
- **web:** Plan first on screen, with a switch and a plan card ([#1060](https://github.com/MilanPavel/golem/pull/1060))
- **models:** auto asks before a turn uses a paid model ([#1065](https://github.com/MilanPavel/golem/pull/1065))
- **models:** auto asks before a turn uses a paid model ([#1065](https://github.com/MilanPavel/golem/pull/1065))
- **web:** the Files tab reads any file of the project ([#1061](https://github.com/MilanPavel/golem/pull/1061))
- **sessions:** a local model's window can grow between turns ([#1064](https://github.com/MilanPavel/golem/pull/1064))
- **web:** settings has a Routing section for routing, budget and context ([#1068](https://github.com/MilanPavel/golem/pull/1068))
- **web:** the route chip, /route, and why golem picked this model ([#1069](https://github.com/MilanPavel/golem/pull/1069))
- **web:** the ctx chip and /context offer clear, summarise, grow and a larger model ([#1082](https://github.com/MilanPavel/golem/pull/1082))
- **models:** a run on auto steps up to a stronger model when it struggles ([#1081](https://github.com/MilanPavel/golem/pull/1081))
- **web:** Settings › Routing shows the path of a turn and says what the settings mean ([#1087](https://github.com/MilanPavel/golem/pull/1087))
- **web:** undo a hunk, a file or a turn in the browser, and redo it ([#1086](https://github.com/MilanPavel/golem/pull/1086))
- **tui:** review notes in /changes go out with the next message ([#1084](https://github.com/MilanPavel/golem/pull/1084))
- **cli:** golem coding bench measures how often a model's edits apply ([#1085](https://github.com/MilanPavel/golem/pull/1085))
- **models:** a run on auto falls back to another model when a provider fails ([#1088](https://github.com/MilanPavel/golem/pull/1088))
- **web:** the resize handle works on either edge; sidebar width and open stores ([#1113](https://github.com/MilanPavel/golem/pull/1113))
- **web:** inboxItems lists what the sessions wait for, with its words ([#1112](https://github.com/MilanPavel/golem/pull/1112))
- **daemon:** a session summary says what the session waits for ([#1116](https://github.com/MilanPavel/golem/pull/1116))
- **web:** sessions can be grouped by time, in one place for the web and the terminal ([#1114](https://github.com/MilanPavel/golem/pull/1114))
- **web:** the icon rail is a component with tooltips, dots and the golem's version ([#1115](https://github.com/MilanPavel/golem/pull/1115))
- **web:** the Inbox panel shows what waits and answers it through the store ([#1117](https://github.com/MilanPavel/golem/pull/1117))
- **web:** the rail and the panel replace the sidebar ([#1125](https://github.com/MilanPavel/golem/pull/1125))
- **daemon:** a model with a small window is told when to use a helper ([#1120](https://github.com/MilanPavel/golem/pull/1120))
- **daemon:** a helper has limits you can set, and its cost shows by job ([#1123](https://github.com/MilanPavel/golem/pull/1123))
- **models:** a struggling run on auto asks before it moves to a paid model ([#1121](https://github.com/MilanPavel/golem/pull/1121))
- **cli:** golem eval routing says what recorded sessions would have cost on another route ([#1126](https://github.com/MilanPavel/golem/pull/1126))
- **web:** the Inbox is mounted in the rail, with a count and a waiting chip ([#1133](https://github.com/MilanPavel/golem/pull/1133))
- **web:** the Sessions panel groups by time, with a filter and a fixed time and menu slot ([#1135](https://github.com/MilanPavel/golem/pull/1135))
- **models:** a scoreboard from real use, and the pick skips a local model whose tool calls fail ([#1127](https://github.com/MilanPavel/golem/pull/1127))
- **web:** the side panel floats under 1100 px and the rail hides behind a menu under 760 px ([#1136](https://github.com/MilanPavel/golem/pull/1136))
- **web:** a helper shows as one line in the chat and as a nested run in the trace ([#1128](https://github.com/MilanPavel/golem/pull/1128))
- **models:** the last answer can be tried again on a stronger model ([#1134](https://github.com/MilanPavel/golem/pull/1134))
- **models:** golem models check asks a model ten tool tasks and says how reliable it is ([#1138](https://github.com/MilanPavel/golem/pull/1138))
- **web:** the Sessions list shows in a flyout when the panel is hidden ([#1144](https://github.com/MilanPavel/golem/pull/1144))
- **tui:** the session switcher marks routine sessions and the ones waiting for you ([#1159](https://github.com/MilanPavel/golem/pull/1159))
- **daemon:** routines fire on schedule as headless sessions, and routine_runs records each firing ([#1160](https://github.com/MilanPavel/golem/pull/1160))
- **web:** the words and the window bar of Settings › Context ([#1162](https://github.com/MilanPavel/golem/pull/1162))
- **cli:** golem routines lists, runs, pauses and edits routines from a shell ([#1164](https://github.com/MilanPavel/golem/pull/1164))
- **cli:** golem open --notified picks the web page or the terminal from settings ([#778](https://github.com/MilanPavel/golem/pull/778)) ([#1163](https://github.com/MilanPavel/golem/pull/1163))
- **web:** Settings › Context, and Routing links to it ([#1166](https://github.com/MilanPavel/golem/pull/1166))
- **web:** Settings › Notifications and the [notifications] keys with routine overrides ([#1167](https://github.com/MilanPavel/golem/pull/1167))
- **web:** a Routines panel lists routines, and each one's page shows its runs ([#1165](https://github.com/MilanPavel/golem/pull/1165))
- **daemon:** a routine with on = {watch, glob} fires once per new, settled file ([#1170](https://github.com/MilanPavel/golem/pull/1170))
- **web:** Settings › Context lists the window each local model gets ([#1172](https://github.com/MilanPavel/golem/pull/1172))
- **web:** make and edit a routine in the web page, with a schedule builder ([#786](https://github.com/MilanPavel/golem/pull/786)) ([#1171](https://github.com/MilanPavel/golem/pull/1171))

### Fixes

- **web:** the top bar and the panel headers have one height ([#1078](https://github.com/MilanPavel/golem/pull/1078))
- **web:** several changes can be expanded at once in the Changes tab ([#1077](https://github.com/MilanPavel/golem/pull/1077))
- **web:** the Files tab hides dot files unless a checkbox is on ([#1080](https://github.com/MilanPavel/golem/pull/1080))
- **daemon:** shell changes are recorded in a folder without git ([#1079](https://github.com/MilanPavel/golem/pull/1079))
- **tools:** file tools refuse credential folders inside the session folder ([#1076](https://github.com/MilanPavel/golem/pull/1076))
- **sessions:** a cleared tool result no longer reads as a cut prompt, proven by a 200-turn check ([#1122](https://github.com/MilanPavel/golem/pull/1122))
- **daemon:** a tool call written as JSON text is read, or counts as a struggle ([#1124](https://github.com/MilanPavel/golem/pull/1124))
- **daemon:** a tool call after a sentence, or wrapped in its own arguments, is read ([#1132](https://github.com/MilanPavel/golem/pull/1132))
- **models:** on auto a turn starts on the ladder's model, and the model chip shows it ([#1147](https://github.com/MilanPavel/golem/pull/1147))
- **web:** Settings › Routing scrolls in its pane, and Frontier offers its ready models ([#1149](https://github.com/MilanPavel/golem/pull/1149))
- **daemon:** a switch to another provider no longer breaks the next turn ([#1151](https://github.com/MilanPavel/golem/pull/1151))
- **web:** the route popover shows the ladder only on auto ([#1153](https://github.com/MilanPavel/golem/pull/1153))
- **web:** Settings › Context shows the window a model really gets ([#1168](https://github.com/MilanPavel/golem/pull/1168))

### Docs

- **web:** design page describes the sidebar as a rail and a panel ([#1111](https://github.com/MilanPavel/golem/pull/1111))
- **web:** the context settings move to Settings › Context ([#1161](https://github.com/MilanPavel/golem/pull/1161))

## [0.15.0] - 2026-11-16

### Features

- **skills:** read, write, create and disable a skill through the daemon ([#859](https://github.com/MilanPavel/golem/pull/859))
- **web:** sign in to a hosted MCP server from Settings ([#863](https://github.com/MilanPavel/golem/pull/863))
- **daemon:** headless sessions get an origin and a session.completed event ([#861](https://github.com/MilanPavel/golem/pull/861))
- **skills:** the model sees an index of the skills it may load ([#917](https://github.com/MilanPavel/golem/pull/917))
- **models:** plan the context window golem asks Ollama for ([#923](https://github.com/MilanPavel/golem/pull/923))
- **models:** a helper asks a chat model for an answer in a given shape ([#927](https://github.com/MilanPavel/golem/pull/927))
- **models:** every model call records its cost and the model it ran on ([#932](https://github.com/MilanPavel/golem/pull/932))
- **daemon:** a context view can shorten what a model call sends ([#929](https://github.com/MilanPavel/golem/pull/929))
- **web:** a reply cut at the length limit says so ([#925](https://github.com/MilanPavel/golem/pull/925))
- **client:** GolemKit, and just gen writes the Swift types ([#862](https://github.com/MilanPavel/golem/pull/862))
- **models:** every model has a tier: local, budget or frontier ([#931](https://github.com/MilanPavel/golem/pull/931))
- **tools:** an edit's old text can match when only spacing or indentation differs ([#988](https://github.com/MilanPavel/golem/pull/988))
- **web:** the details drawer is a workbench panel with tabs ([#992](https://github.com/MilanPavel/golem/pull/992))
- **daemon:** config.toml has a [coding] section, and golem finds a project's checks ([#990](https://github.com/MilanPavel/golem/pull/990))
- **tui:** a finished edit shows its diff inline in the transcript ([#993](https://github.com/MilanPavel/golem/pull/993))
- **models:** one call gives each model's routing facts ([#997](https://github.com/MilanPavel/golem/pull/997))
- **models:** one generation at a time on a local server, chat before jobs ([#996](https://github.com/MilanPavel/golem/pull/996))
- **web:** the details panel is resized by dragging its edge ([#1003](https://github.com/MilanPavel/golem/pull/1003))
- **daemon:** the daemon records each change to a file, with the text before and after ([#991](https://github.com/MilanPavel/golem/pull/991))
- **models:** each internal job has a model, and session titles use it ([#998](https://github.com/MilanPavel/golem/pull/998))
- **sessions:** every model call is recorded with its tokens and cost ([#999](https://github.com/MilanPavel/golem/pull/999))
- **models:** local models get a planned context window on every call ([#1001](https://github.com/MilanPavel/golem/pull/1001))
- **cli:** golem skills new and golem skills edit make and edit a skill from a shell ([#1005](https://github.com/MilanPavel/golem/pull/1005))
- **tools:** write_file and edit_file answer the model in one line ([#995](https://github.com/MilanPavel/golem/pull/995))
- **models:** routing rules as a pure function, and the [routing] and [budget] settings ([#1004](https://github.com/MilanPavel/golem/pull/1004))
- **daemon:** the daemon notifies you when a detached session needs you or fails ([#1010](https://github.com/MilanPavel/golem/pull/1010))
- **tui:** /skills gets actions, a new-skill form, and $EDITOR on SKILL.md ([#1012](https://github.com/MilanPavel/golem/pull/1012))
- **daemon:** every file a tool writes is recorded and sends file.changed ([#1016](https://github.com/MilanPavel/golem/pull/1016))
- **daemon:** changes.list and changes.diff tell a client what a session changed ([#1017](https://github.com/MilanPavel/golem/pull/1017))
- **models:** local calls record how long loading, reading and replying took ([#1011](https://github.com/MilanPavel/golem/pull/1011))
- **cli:** golem ask runs a prompt from the shell, and golem open returns to its session ([#1006](https://github.com/MilanPavel/golem/pull/1006))
- **web:** Settings lists, edits and creates skills, and shows where API keys are kept ([#1009](https://github.com/MilanPavel/golem/pull/1009))
- **daemon:** routines are config, and routine.list, get, update and remove read and edit them ([#1018](https://github.com/MilanPavel/golem/pull/1018))
- **daemon:** golem runs the project's checks after a turn that changed files ([#1015](https://github.com/MilanPavel/golem/pull/1015))
- **tools:** a tool result the model reads is sized to its context window ([#1013](https://github.com/MilanPavel/golem/pull/1013))
- **sessions:** old tool results are sent as one line once the history fills the window ([#1014](https://github.com/MilanPavel/golem/pull/1014))
- **daemon:** tool.writing says how far the model is with a file it is writing ([#1019](https://github.com/MilanPavel/golem/pull/1019))
- **sessions:** old turns are summarised once the history still fills the window ([#1023](https://github.com/MilanPavel/golem/pull/1023))
- **web:** the trace says how many tool results were cleared at the selected call ([#1022](https://github.com/MilanPavel/golem/pull/1022))
- **web:** each answer shows its model, tier, tokens and cost ([#1026](https://github.com/MilanPavel/golem/pull/1026))
- **sessions:** a session has a route mode, and each turn can pick its model ([#1024](https://github.com/MilanPavel/golem/pull/1024))
- **models:** a chat call that waits for the local model says so ([#1025](https://github.com/MilanPavel/golem/pull/1025))
- **tui:** /changes reviews the files a session changed, in the terminal ([#1027](https://github.com/MilanPavel/golem/pull/1027))
- **web:** a slow file write shows its path, lines and seconds, in the web and the terminal ([#1028](https://github.com/MilanPavel/golem/pull/1028))
- **daemon:** changes.revert takes back a change, a file, a hunk or a run ([#1031](https://github.com/MilanPavel/golem/pull/1031))
- **sessions:** a prompt that will not fit is shrunk before it is sent ([#1039](https://github.com/MilanPavel/golem/pull/1039))
- **web:** an edit in the chat is a card that opens the file's change ([#1030](https://github.com/MilanPavel/golem/pull/1030))
- **daemon:** a failed check goes back to the model, at most fix_rounds times a turn ([#1035](https://github.com/MilanPavel/golem/pull/1035))
- **web:** the Changes tab lists the files a session changed, with their diffs ([#1040](https://github.com/MilanPavel/golem/pull/1040))
- **daemon:** files a shell command changed in a git repository are recorded ([#1041](https://github.com/MilanPavel/golem/pull/1041))
- **web:** the API keys page groups model and MCP keys, with their marks ([#1042](https://github.com/MilanPavel/golem/pull/1042))
- **daemon:** file.read and file.list give a client the files of the session folder ([#1029](https://github.com/MilanPavel/golem/pull/1029))
- **daemon:** plan first, a read-only run that ends in a proposed plan ([#1032](https://github.com/MilanPavel/golem/pull/1032))
- **web:** the Skills and Config file editors fill the settings panel ([#1044](https://github.com/MilanPavel/golem/pull/1044))
- **daemon:** changes.commit commits a session's files with the user's git, and suggests the message ([#1033](https://github.com/MilanPavel/golem/pull/1033))
- the shared view folds file.changed into the files each turn changed ([#1046](https://github.com/MilanPavel/golem/pull/1046))
- **daemon:** shell changes in a git worktree inside the session folder are recorded ([#1047](https://github.com/MilanPavel/golem/pull/1047))
- /cost shows a usage report, and Settings has a Usage tab ([#1037](https://github.com/MilanPavel/golem/pull/1037))
- **sessions:** a budget cap stops paid calls once it is spent ([#1038](https://github.com/MilanPavel/golem/pull/1038))
- **sessions:** /compact shrinks what the next model call sends ([#1036](https://github.com/MilanPavel/golem/pull/1036))

### Fixes

- **client:** file.changed and three other events reach the screens ([#1049](https://github.com/MilanPavel/golem/pull/1049))
- **web:** opening a diff in the chat no longer scrolls the whole page ([#1051](https://github.com/MilanPavel/golem/pull/1051))

### Docs

- **models:** ADR-055 picks a model by fixed rules: three tiers, route modes, spend caps ([#921](https://github.com/MilanPavel/golem/pull/921))
- golem plans a local model's window and sends a view, never a shorter history ([#926](https://github.com/MilanPavel/golem/pull/926))
- a chapter on routing and context ([#930](https://github.com/MilanPavel/golem/pull/930))
- **web:** trace notes that on-demand MCP servers can also send a system prompt ([#922](https://github.com/MilanPavel/golem/pull/922))
- the ADR index lists 056 in the table again ([#933](https://github.com/MilanPavel/golem/pull/933))
- the TUI demo types golem tui ([#986](https://github.com/MilanPavel/golem/pull/986))
- ADR 057, golem keeps a snapshot of every file it changes ([#987](https://github.com/MilanPavel/golem/pull/987))
- a chapter on how golem records, checks and undoes an edit ([#989](https://github.com/MilanPavel/golem/pull/989))
- ADR-051 settles the relay wire, with AES-GCM Noise on native primitives ([#1007](https://github.com/MilanPavel/golem/pull/1007))
- ADR-058, a helper is a child run on its own thread, with its steps in the parent's log ([#1021](https://github.com/MilanPavel/golem/pull/1021))

## [0.14.0] - 2026-11-14

### Features

- **mcp:** sign in to a hosted server with OAuth, in the daemon ([#572](https://github.com/MilanPavel/golem/pull/572))
- **web:** Chat detail moves to Settings → Appearance ([#823](https://github.com/MilanPavel/golem/pull/823))
- **mcp:** needs_auth, mcp.login, mcp.logout, and OAuth catalog entries (1.12.19) ([#819](https://github.com/MilanPavel/golem/pull/819))
- **web:** the ctx chip opens the trace side panel on the last call ([#828](https://github.com/MilanPavel/golem/pull/828))
- **mcp:** the model turns on-demand servers on with mcp_enable ([#822](https://github.com/MilanPavel/golem/pull/822))
- **mcp:** catalog servers are on in every chat ([#826](https://github.com/MilanPavel/golem/pull/826))
- **web:** a compact Setup page that says where golem is installed ([#833](https://github.com/MilanPavel/golem/pull/833))
- **mcp:** approving mcp_enable also lets that server's tools run in the session ([#834](https://github.com/MilanPavel/golem/pull/834))
- **web:** one copy icon button everywhere, and quieter command hints ([#839](https://github.com/MilanPavel/golem/pull/839))
- **web:** provider icons on the API key chips, in one font ([#840](https://github.com/MilanPavel/golem/pull/840))
- **protocol:** Settings picks the default permission mode with permissions.set_mode (2.63) ([#848](https://github.com/MilanPavel/golem/pull/848))
- **web:** MCP servers as Installed, Catalog and Import tabs, with brand icons ([#849](https://github.com/MilanPavel/golem/pull/849))
- the relay server, with rooms, keys, and an in-memory queue ([#855](https://github.com/MilanPavel/golem/pull/855))
- **mcp:** sign in to a hosted server from the terminal and the CLI ([#856](https://github.com/MilanPavel/golem/pull/856))
- **skills:** the release build carries a bundled skill folder and the daemon reads it ([#857](https://github.com/MilanPavel/golem/pull/857))
- **cli:** **Breaking:** golem opens the web UI, and golem tui opens the terminal chat ([#851](https://github.com/MilanPavel/golem/pull/851))bare golem no longer opens the terminal chat. Run golem tui.

### Fixes

- **web:** one gallery accessibility test per section (B.15) ([#809](https://github.com/MilanPavel/golem/pull/809))
- **daemon:** close a killed command's output pipe before run returns (B.17) ([#817](https://github.com/MilanPavel/golem/pull/817))
- **daemon:** the clean-start test waits for the daemon to remove last-error (B.16) ([#816](https://github.com/MilanPavel/golem/pull/816))
- **web:** the composer chips share one height ([#824](https://github.com/MilanPavel/golem/pull/824))
- **web:** the app offer knows golem is already installed ([#825](https://github.com/MilanPavel/golem/pull/825))
- **cli:** CLI, gateway and packaging strings say golem and golem tui ([#853](https://github.com/MilanPavel/golem/pull/853))
- **web:** web, view and daemon strings say golem and golem tui ([#854](https://github.com/MilanPavel/golem/pull/854))

### Docs

- how the iPhone reaches the Mac, the relay and pairing (ADR-051) ([#820](https://github.com/MilanPavel/golem/pull/820))
- routines, headless sessions, and the run names (ADR-050) ([#818](https://github.com/MilanPavel/golem/pull/818))
- ADR-052, the iPhone app and GolemKit, and Always allow from the phone (14.1.2) ([#821](https://github.com/MilanPavel/golem/pull/821))
- ADR-050 keeps the Mac awake while a run waits, as ADR-051 does ([#832](https://github.com/MilanPavel/golem/pull/832))
- user guides say golem opens the web UI and golem tui the terminal chat ([#852](https://github.com/MilanPavel/golem/pull/852))
- contributor and architecture docs say golem opens the web UI and golem tui the chat ([#850](https://github.com/MilanPavel/golem/pull/850))

## [0.13.1] - 2026-11-12

### Fixes

- **cli:** say what golem is doing while its service starts (B.10) ([#797](https://github.com/MilanPavel/golem/pull/797))
- **web:** center the Tools step's Continue on /welcome (B.12) ([#801](https://github.com/MilanPavel/golem/pull/801))
- **daemon:** an Ollama left from a removed install is not ready (B.13) ([#803](https://github.com/MilanPavel/golem/pull/803))
- **web:** Start chatting while the model downloads; a send waits for it (B.11) ([#802](https://github.com/MilanPavel/golem/pull/802))
- **daemon:** store secrets through /usr/bin/security so upgrades don't ask (B.14) ([#805](https://github.com/MilanPavel/golem/pull/805))

### Docs

- a separate Uninstall page, and the Keychain text after #805 ([#807](https://github.com/MilanPavel/golem/pull/807))

## [0.13.0] - 2026-11-12

### Features

- **web:** web app manifest and icons (10.13.1) ([#710](https://github.com/MilanPavel/golem/pull/710))
- **mcp:** Tools panel navigation and model (1.12.13) ([#711](https://github.com/MilanPavel/golem/pull/711))
- **web:** /welcome page with Engine and Ready, opened at start (10.15.6) ([#713](https://github.com/MilanPavel/golem/pull/713))
- **web:** sign-ins survive a gateway restart (10.14.4) ([#714](https://github.com/MilanPavel/golem/pull/714))
- **web:** golem web serve, a gateway for a job, never old (10.14.1) ([#709](https://github.com/MilanPavel/golem/pull/709))
- **tui:** the Tools panel in the setup window (1.12.14) ([#719](https://github.com/MilanPavel/golem/pull/719))
- **cli:** golem install keeps the service and the web page running (10.14.2) ([#721](https://github.com/MilanPavel/golem/pull/721))
- **web:** the page shows whether its gateway is kept running (10.14.3) ([#720](https://github.com/MilanPavel/golem/pull/720))
- **web:** the Model step on /welcome (10.15.8) ([#723](https://github.com/MilanPavel/golem/pull/723))
- **web:** the Tools step on /welcome and in Settings (10.15.9) ([#722](https://github.com/MilanPavel/golem/pull/722))
- **web:** no setup dialog; a send with no model and /setup go to pages (10.15.10) ([#727](https://github.com/MilanPavel/golem/pull/727))
- **tui:** /setup offers Tools when no MCP server exists (1.12.15) ([#730](https://github.com/MilanPavel/golem/pull/730))
- **web:** offer to install the app on Ready and in Settings (10.13.3) ([#726](https://github.com/MilanPavel/golem/pull/726))
- **tui:** the Service panel names both jobs, golem install keeps both (10.14.5) ([#729](https://github.com/MilanPavel/golem/pull/729))

### Fixes

- **daemon:** test sockets fall back to a short dir in a long checkout (B.7) ([#716](https://github.com/MilanPavel/golem/pull/716))
- **web:** one gallery welcome test per state, so axe fits the timeout (B.9) ([#732](https://github.com/MilanPavel/golem/pull/732))
- **daemon:** the trusted-project MCP test waits for the user's server (B.8) ([#728](https://github.com/MilanPavel/golem/pull/728))

## [0.12.0] - 2026-11-11

### Features

- **web:** the trace summary on its own line ([#666](https://github.com/MilanPavel/golem/pull/666))
- **web:** settings as a full-width page with tabs ([#667](https://github.com/MilanPavel/golem/pull/667))
- **web:** the model dialog keeps one size ([#669](https://github.com/MilanPavel/golem/pull/669))
- **web:** MCP servers as a list and a detail side by side ([#671](https://github.com/MilanPavel/golem/pull/671))
- **web:** Tune as grouped, compact rows ([#674](https://github.com/MilanPavel/golem/pull/674))
- **web:** MCP details with status, Start, and the tools in place ([#676](https://github.com/MilanPavel/golem/pull/676))
- **web:** answers in a lighter serif ([#689](https://github.com/MilanPavel/golem/pull/689))
- **web:** the trace as an inspector beside the chat ([#692](https://github.com/MilanPavel/golem/pull/692))
- **web:** one golem and one footer per turn ([#690](https://github.com/MilanPavel/golem/pull/690))
- **web:** tool steps as one activity line, with Quiet, Normal and Verbose ([#693](https://github.com/MilanPavel/golem/pull/693))
- **daemon:** permission modes Careful, Balanced and Autopilot ([#694](https://github.com/MilanPavel/golem/pull/694))
- **web:** pick the permission mode in the composer, the TUI and Settings ([#696](https://github.com/MilanPavel/golem/pull/696))
- **web:** approvals dock above the composer and shrink to a chip ([#695](https://github.com/MilanPavel/golem/pull/695))
- **mcp:** trust a server's read-only tools ([#697](https://github.com/MilanPavel/golem/pull/697))

### Fixes

- **web:** no "on {}" for a call without arguments ([#688](https://github.com/MilanPavel/golem/pull/688))

### Docs

- rules for pages, dialogs, and Tune ([#670](https://github.com/MilanPavel/golem/pull/670))
- the chat — steps, approvals, modes, type and the trace ([#691](https://github.com/MilanPavel/golem/pull/691))

## [0.11.0] - 2026-11-10

### Features

- **tui:** show the context with /context and a ctx % in the status line ([#584](https://github.com/MilanPavel/golem/pull/584))
- **models:** add the table of Ollama options with ranges and explanations ([#594](https://github.com/MilanPavel/golem/pull/594))
- **models:** save Ollama options for each model in config.toml ([#599](https://github.com/MilanPavel/golem/pull/599))
- **protocol:** add model.options.get and set, session.set_options and model.options.changed ([#603](https://github.com/MilanPavel/golem/pull/603))
- **models:** send saved and session options to Ollama ([#606](https://github.com/MilanPavel/golem/pull/606))
- **models:** read the loaded context of an Ollama model from /api/ps ([#612](https://github.com/MilanPavel/golem/pull/612))
- **tui:** add /tune with sliders and explanations ([#616](https://github.com/MilanPavel/golem/pull/616))
- **models:** read the num_ctx a Modelfile sets for an installed model ([#613](https://github.com/MilanPavel/golem/pull/613))
- **tui:** add presets to /tune ([#617](https://github.com/MilanPavel/golem/pull/617))
- **models:** find a local model's context window from session and saved options ([#618](https://github.com/MilanPavel/golem/pull/618))
- **tui:** try the last question again with the /tune settings ([#619](https://github.com/MilanPavel/golem/pull/619))
- **models:** record on model.call.started that a window is estimated ([#621](https://github.com/MilanPavel/golem/pull/621))
- **web:** add a Tune tab to the model dialog ([#622](https://github.com/MilanPavel/golem/pull/622))
- **tui:** show how much memory num_ctx needs in /tune ([#623](https://github.com/MilanPavel/golem/pull/623))
- **tui:** show an estimated window with ≈ and a context bar in the status line ([#626](https://github.com/MilanPavel/golem/pull/626))
- **web:** open Tune from the model row, with presets and the memory gauge ([#627](https://github.com/MilanPavel/golem/pull/627))
- **tui:** show changed options in the status line and set one with /tune ([#628](https://github.com/MilanPavel/golem/pull/628))
- **tui:** show /context as a grid of cells with a legend ([#629](https://github.com/MilanPavel/golem/pull/629))
- **web:** try again in the Tune view and a changed-options chip ([#631](https://github.com/MilanPavel/golem/pull/631))
- **sessions:** show when Ollama cut a prompt that did not fit ([#636](https://github.com/MilanPavel/golem/pull/636))
- **sessions:** keep a local model's thinking and show it as one line ([#644](https://github.com/MilanPavel/golem/pull/644))
- **protocol:** mark tool calls a model wrote as text ([#647](https://github.com/MilanPavel/golem/pull/647))
- **tui:** /thinking shows or hides the thinking line ([#654](https://github.com/MilanPavel/golem/pull/654))
- **models:** a think row in Tune for local models ([#656](https://github.com/MilanPavel/golem/pull/656))
- **tools:** search the web with web_search through DuckDuckGo ([#657](https://github.com/MilanPavel/golem/pull/657))

### Fixes

- **models:** read the window Ollama used after each call ([#630](https://github.com/MilanPavel/golem/pull/630))
- **daemon:** recover tool calls a model writes as text ([#637](https://github.com/MilanPavel/golem/pull/637))
- **tools:** send a User-Agent with a contact URL from web_fetch ([#643](https://github.com/MilanPavel/golem/pull/643))
- **tools:** give a refused page's title as the reason in web_fetch ([#648](https://github.com/MilanPavel/golem/pull/648))
- **tools:** tell the model when the sandboxed shell had no network ([#655](https://github.com/MilanPavel/golem/pull/655))

### Docs

- add chapter 14 on tracing and a trace section to the web guide ([#585](https://github.com/MilanPavel/golem/pull/585))
- split sre.md into build, release, and run pages ([#602](https://github.com/MilanPavel/golem/pull/602))
- move the plan to GitHub issues ([#600](https://github.com/MilanPavel/golem/pull/600))
- publish the web gallery on the docs site ([#601](https://github.com/MilanPavel/golem/pull/601))
- nest the How golem works chapters under Overview ([#608](https://github.com/MilanPavel/golem/pull/608))
- split the vision into chapters ([#607](https://github.com/MilanPavel/golem/pull/607))
- put the gallery in the menu and retire the feature design pages ([#614](https://github.com/MilanPavel/golem/pull/614))
- find a local model's context window from what Ollama says ([#615](https://github.com/MilanPavel/golem/pull/615))
- add the preset keys to the /tune guide ([#620](https://github.com/MilanPavel/golem/pull/620))

## [0.10.0] - 2026-11-08

### Features

- **mcp:** edit every field of a server and the whole config over RPC ([#494](https://github.com/MilanPavel/golem/pull/494))
- **mcp:** test a server step by step, read its log, and try a tool ([#497](https://github.com/MilanPavel/golem/pull/497))
- **models:** add Google (Gemini) as a provider ([#499](https://github.com/MilanPavel/golem/pull/499))
- **web:** Settings page with Setup and Appearance, and a Settings button in the sidebar ([#500](https://github.com/MilanPavel/golem/pull/500))
- **models:** add DeepSeek as a provider ([#501](https://github.com/MilanPavel/golem/pull/501))
- **models:** add xAI (Grok) as a provider ([#504](https://github.com/MilanPavel/golem/pull/504))
- **web:** choose Match system, Light, or Dark in Settings, and drop the sidebar theme switch ([#505](https://github.com/MilanPavel/golem/pull/505))
- **mcp:** a catalog of servers, and Node and uv installs from the daemon ([#502](https://github.com/MilanPavel/golem/pull/502))
- **tools:** gh and git push run outside the sandbox with your credentials, after you approve ([#503](https://github.com/MilanPavel/golem/pull/503))
- **models:** add Moonshot (Kimi) as a provider ([#506](https://github.com/MilanPavel/golem/pull/506))
- **web:** tool rules in Settings, with a question before a change that loosens one ([#508](https://github.com/MilanPavel/golem/pull/508))
- **models:** setup, /login, auth, and doctor list the six providers ([#517](https://github.com/MilanPavel/golem/pull/517))
- **mcp:** add servers from the daemon's catalog in /mcp add and golem mcp add ([#521](https://github.com/MilanPavel/golem/pull/521))
- **web:** show a model download in the sidebar on every screen ([#522](https://github.com/MilanPavel/golem/pull/522))
- **models:** list current hosted models for the six providers in the catalog ([#524](https://github.com/MilanPavel/golem/pull/524))
- **web:** choose the model of a new session, and refuse an unknown one at session.create ([#525](https://github.com/MilanPavel/golem/pull/525))
- **models:** offer only catalog models by default, and never a retired one ([#526](https://github.com/MilanPavel/golem/pull/526))
- **mcp:** import servers from other apps, and export them ([#527](https://github.com/MilanPavel/golem/pull/527))
- **tui:** show all models from the picker and the web dialog ([#528](https://github.com/MilanPavel/golem/pull/528))
- **web:** browse your home folder to choose a session's folder ([#529](https://github.com/MilanPavel/golem/pull/529))
- **cli:** golem mcp list, show, test, logs, enable, restart, and tools ([#530](https://github.com/MilanPavel/golem/pull/530))
- **models:** list each model's categories, from the catalog, Ollama, and LiteLLM ([#541](https://github.com/MilanPavel/golem/pull/541))
- **web:** see and fix each part of setup in Settings → Setup, without a dialog ([#542](https://github.com/MilanPavel/golem/pull/542))
- **cli:** golem mcp edit, import, config edit, and add with env, headers, and a test ([#544](https://github.com/MilanPavel/golem/pull/544))
- **tui:** filter the model picker by category tabs, and show each model's categories ([#545](https://github.com/MilanPavel/golem/pull/545))
- **web:** filter the model dialog by category, and show each model's categories ([#546](https://github.com/MilanPavel/golem/pull/546))
- **tui:** test, read the log, hide or try a tool, and remove a server in /mcp ([#547](https://github.com/MilanPavel/golem/pull/547))
- **models:** add local models for coding, reasoning, vision, and fast at each memory size ([#548](https://github.com/MilanPavel/golem/pull/548))
- **daemon:** record each model call with its model, timing, tokens, and stop reason ([#549](https://github.com/MilanPavel/golem/pull/549))
- **daemon:** store each model call's system prompt and tool schemas by hash ([#550](https://github.com/MilanPavel/golem/pull/550))
- **web:** see and manage MCP servers in Settings, and /mcp opens it ([#551](https://github.com/MilanPavel/golem/pull/551))
- **daemon:** record how long each tool call ran ([#552](https://github.com/MilanPavel/golem/pull/552))
- **web:** test a server, read its log, hide or try a tool, and remove it in Settings ([#553](https://github.com/MilanPavel/golem/pull/553))
- **daemon:** read a session as a tree of spans, and one span in full ([#554](https://github.com/MilanPavel/golem/pull/554))
- **web:** add a server, and edit one, in Settings ([#555](https://github.com/MilanPavel/golem/pull/555))
- **web:** import servers from other apps in Settings ([#556](https://github.com/MilanPavel/golem/pull/556))
- **web:** open a session's trace as a tree with a waterfall ([#557](https://github.com/MilanPavel/golem/pull/557))
- **web:** read and edit the config file in Settings, and /config opens it ([#558](https://github.com/MilanPavel/golem/pull/558))
- **web:** read what a span took in and gave out, on the trace page ([#559](https://github.com/MilanPavel/golem/pull/559))
- **models:** recommend a local model for each category on the model picker ([#560](https://github.com/MilanPavel/golem/pull/560))
- show every duration as minutes and seconds ([#571](https://github.com/MilanPavel/golem/pull/571))
- **protocol:** record the context window and prompt sections of each model call ([#574](https://github.com/MilanPavel/golem/pull/574))
- **web:** show Chat and Trace as tabs below the session title ([#573](https://github.com/MilanPavel/golem/pull/573))
- **sessions:** break down what fills the context in trace.get and trace.span ([#575](https://github.com/MilanPavel/golem/pull/575))
- **web:** show the system prompt by section and the size of each message ([#576](https://github.com/MilanPavel/golem/pull/576))
- **web:** show how full the context is on a model span, and what the tools cost ([#577](https://github.com/MilanPavel/golem/pull/577))
- **web:** keep the session's top bar in the trace view ([#578](https://github.com/MilanPavel/golem/pull/578))
- **web:** show how much context the session has spent, in the trace header and the chat ([#579](https://github.com/MilanPavel/golem/pull/579))
- **web:** polish the trace with fill bars, run totals, rendered replies and a time axis ([#580](https://github.com/MilanPavel/golem/pull/580))

### Fixes

- **tools:** git fetch, add, and commit work in a git worktree under the sandbox ([#498](https://github.com/MilanPavel/golem/pull/498))
- **tools:** a sandbox refusal says it was the sandbox, and how to allow it ([#516](https://github.com/MilanPavel/golem/pull/516))
- **tools:** a shell command that fails is marked ✗, not ✓ ([#523](https://github.com/MilanPavel/golem/pull/523))
- **web:** give the gallery tests 60 s, so they do not time out on CI ([#581](https://github.com/MilanPavel/golem/pull/581))
- **web:** draw the Settings icon as a cog, not a sun ([#582](https://github.com/MilanPavel/golem/pull/582))

### Docs

- a picture at the top of the vision, and two sections removed ([#480](https://github.com/MilanPavel/golem/pull/480))
- new mcp plan ([#492](https://github.com/MilanPavel/golem/pull/492))
- **mcp:** ADR-037 and the screens for MCP from anywhere ([#493](https://github.com/MilanPavel/golem/pull/493))
- **web:** design downloads, new-session choices, and setup as pages ([#519](https://github.com/MilanPavel/golem/pull/519))
- rework the vision, the home page, and the demos ([#520](https://github.com/MilanPavel/golem/pull/520))

## [0.9.0] - 2026-11-05

### Features

- **web:** the setup window in the browser ([#456](https://github.com/MilanPavel/golem/pull/456))
- **mcp:** golem mcp add and golem mcp remove write the server to config.toml for you ([#458](https://github.com/MilanPavel/golem/pull/458))
- **mcp:** /mcp add picks filesystem, GitHub, fetch, or your own server from a short list ([#479](https://github.com/MilanPavel/golem/pull/479))

### Docs

- How golem works, a chapter on the terminal app ([#455](https://github.com/MilanPavel/golem/pull/455))
- a short Architecture overview, and a Settings guide ([#457](https://github.com/MilanPavel/golem/pull/457))
- How golem works, a chapter on the web UI ([#478](https://github.com/MilanPavel/golem/pull/478))

## [0.8.0] - 2026-11-04

### Features

- **web:** slash commands and their suggestions in the web composer ([#389](https://github.com/MilanPavel/golem/pull/389))
- **web:** a ⌘K command palette and a list of the page's keys ([#451](https://github.com/MilanPavel/golem/pull/451))

### Fixes

- **tui:** the compiled golem opens one setup window, and that window can install the service ([#388](https://github.com/MilanPavel/golem/pull/388))

### Docs

- How golem works, chapter 9: sessions that survive ([#390](https://github.com/MilanPavel/golem/pull/390))
- update plan with models phase 12 ([#391](https://github.com/MilanPavel/golem/pull/391))
- How golem works, chapters on the daemon and the protocol ([#392](https://github.com/MilanPavel/golem/pull/392))

## [0.7.0] - 2026-11-04

### Features

- **tui:** golem names the key while macOS asks whether it may use it from the Keychain ([#375](https://github.com/MilanPavel/golem/pull/375))
- **tui:** an empty chat lists starter prompts that fit the folder ([#379](https://github.com/MilanPavel/golem/pull/379))
- **web:** rename, fork, and close a session from the page, with forks shown as a tree ([#380](https://github.com/MilanPavel/golem/pull/380))
- **tui:** the empty composer shows one tip per session, the next one in each new session ([#381](https://github.com/MilanPavel/golem/pull/381))
- **web:** pick, download, and remove models from the session's model chip ([#384](https://github.com/MilanPavel/golem/pull/384))

### Fixes

- **tui:** setup waits for the first golem daemon install while macOS checks the app ([#374](https://github.com/MilanPavel/golem/pull/374))

### Docs

- How golem works, chapter 2: talking to models ([#362](https://github.com/MilanPavel/golem/pull/362))
- How golem works, chapter 3: tools ([#377](https://github.com/MilanPavel/golem/pull/377))
- How golem works, chapters 4 and 5: permissions and sandboxes ([#378](https://github.com/MilanPavel/golem/pull/378))
- How golem works, chapters 6 and 7: context and skills ([#382](https://github.com/MilanPavel/golem/pull/382))
- the overview's system map can be clicked, and follows one message ([#383](https://github.com/MilanPavel/golem/pull/383))
- How golem works, chapter 8: MCP ([#385](https://github.com/MilanPavel/golem/pull/385))

## [0.6.1] - 2026-11-03

### Fixes

- **tui:** setup reinstalls a launch agent launchd doesn't run, and a daemon stops if its socket goes ([#364](https://github.com/MilanPavel/golem/pull/364))

## [0.6.0] - 2026-11-03

### Features

- **web:** approvals can be answered in the browser from a card with the diff ([#349](https://github.com/MilanPavel/golem/pull/349))
- **daemon:** golem checks an API key before saving it, and installs Ollama itself ([#352](https://github.com/MilanPavel/golem/pull/352))
- **web:** a call's arguments can be edited before allowing it once ([#356](https://github.com/MilanPavel/golem/pull/356))
- **tui:** golem sets itself up in one window, and /setup shows what is broken and fixes it ([#357](https://github.com/MilanPavel/golem/pull/357))
- **web:** a drawer beside the chat shows the agent's todo list ([#358](https://github.com/MilanPavel/golem/pull/358))
- **tui:** On this Mac installs Ollama, then lists models sized for this Mac and downloads one ([#360](https://github.com/MilanPavel/golem/pull/360))
- **tui:** With an API key picks a provider, checks the key, and lists its models in setup ([#361](https://github.com/MilanPavel/golem/pull/361))

### Fixes

- **ci:** trust the tap checkout so brew audit can load the formula ([#342](https://github.com/MilanPavel/golem/pull/342))

### Docs

- hacking and contributing pages on the docs site ([#348](https://github.com/MilanPavel/golem/pull/348))
- a short README that links to the docs site ([#350](https://github.com/MilanPavel/golem/pull/350))
- How golem works, chapter 1: the agent loop ([#359](https://github.com/MilanPavel/golem/pull/359))

## [0.5.0] - 2026-11-02

### Features

- **skills:** a skill body is filled in with its arguments, its folder, and the session ID ([#148](https://github.com/MilanPavel/golem/pull/148))
- **skills:** message.send can run a skill by name, and the log says which skill and when ([#149](https://github.com/MilanPavel/golem/pull/149))
- **tui:** /name runs a skill, /skill run reaches any, and skills show in the / suggestions ([#194](https://github.com/MilanPavel/golem/pull/194))
- **web:** a web UI package that just check builds, lints, and tests ([#195](https://github.com/MilanPavel/golem/pull/195))
- **tui:** an invoked skill shows as the line you typed, and Ctrl-O shows its body ([#198](https://github.com/MilanPavel/golem/pull/198))
- **web:** golem's design tokens, with light and dark themes that follow the system ([#197](https://github.com/MilanPavel/golem/pull/197))
- **skills:** a skill the session ran can read its own files and run its own scripts ([#200](https://github.com/MilanPavel/golem/pull/200))
- **tui:** the question you are reading stays pinned at the top while its answer scrolls ([#201](https://github.com/MilanPavel/golem/pull/201))
- **client:** the client connects over a WebSocket, and stops retrying when its login is refused ([#202](https://github.com/MilanPavel/golem/pull/202))
- **web:** the web UI's building blocks, and the pixel golem with its five states ([#203](https://github.com/MilanPavel/golem/pull/203))
- **protocol:** each method says whether a browser may call it, and auth.set and auth.remove may not ([#211](https://github.com/MilanPavel/golem/pull/211))
- **daemon:** golem builds a system prompt for each model call, shown first in /debug model ([#213](https://github.com/MilanPavel/golem/pull/213))
- **web:** the gateway lets one allowed JSON request per message through to golem, and nothing else ([#215](https://github.com/MilanPavel/golem/pull/215))
- **skills:** session.set_skills pins a skill, and its body is in every model call until unpinned ([#216](https://github.com/MilanPavel/golem/pull/216))
- **tui:** /skill pin and /skill unpin keep a skill on for the chat, and the status line shows it ([#218](https://github.com/MilanPavel/golem/pull/218))
- **web:** gateway login with a token file, session cookie, and Origin and Host checks ([#219](https://github.com/MilanPavel/golem/pull/219))
- **skills:** an edited, deleted, or broken pinned skill is logged once, and the turn still runs ([#255](https://github.com/MilanPavel/golem/pull/255))
- **web:** gateway server that bridges a WebSocket to the daemon socket ([#256](https://github.com/MilanPavel/golem/pull/256))
- **cli:** golem web command that starts the gateway or reuses a running one ([#257](https://github.com/MilanPavel/golem/pull/257))
- **web:** embed the page's files in the golem binary and serve them from the gateway ([#259](https://github.com/MilanPavel/golem/pull/259))
- **cli:** golem offers to start its background service when no daemon answers ([#260](https://github.com/MilanPavel/golem/pull/260))
- **sessions:** a fork starts with its source's pinned skills and on-demand MCP servers ([#297](https://github.com/MilanPavel/golem/pull/297))
- **web:** connection store and full-screen connection states ([#298](https://github.com/MilanPavel/golem/pull/298))
- **web:** embed the built web page in the golem binary ([#299](https://github.com/MilanPavel/golem/pull/299))
- **daemon:** a daemon that can't start says why, in the TUI and golem status ([#300](https://github.com/MilanPavel/golem/pull/300))
- **cli:** commands that need the daemon say how to start it, or why it could not start ([#304](https://github.com/MilanPavel/golem/pull/304))
- **web:** session stores, the session list, a query client, and a router ([#313](https://github.com/MilanPavel/golem/pull/313))
- **web:** app shell and a sidebar of sessions grouped by folder ([#316](https://github.com/MilanPavel/golem/pull/316))
- **tui:** after brew upgrade, ctrl-r restarts golem's service from the chat ([#315](https://github.com/MilanPavel/golem/pull/315))
- **cli:** golem web offers to start golem's service before it opens the browser ([#317](https://github.com/MilanPavel/golem/pull/317))
- **web:** the transcript, with sanitized markdown and highlighted code ([#319](https://github.com/MilanPavel/golem/pull/319))
- **web:** the composer and dock, with pastes, history, and stop ([#320](https://github.com/MilanPavel/golem/pull/320))
- **web:** the favicon and tab title show what golem is doing ([#324](https://github.com/MilanPavel/golem/pull/324))
- **models:** the model list says what setup needs, and no model is a clean state ([#326](https://github.com/MilanPavel/golem/pull/326))
- **web:** tool lines open into their arguments and output ([#336](https://github.com/MilanPavel/golem/pull/336))
- **tui:** a first start shows three choices: on this Mac, with an API key, or later ([#338](https://github.com/MilanPavel/golem/pull/338))
- **web:** file changes show as unified or split diffs in the tool's tablet ([#339](https://github.com/MilanPavel/golem/pull/339))

### Fixes

- **daemon:** wait up to 60 s for ollama serve, so a fresh install's first start is not stopped ([#146](https://github.com/MilanPavel/golem/pull/146))
- **client:** the client dials through a Link, and characters split across socket reads stay whole ([#193](https://github.com/MilanPavel/golem/pull/193))
- **tui:** golem opens the newest session in the folder it was started in ([#199](https://github.com/MilanPavel/golem/pull/199))

### Docs

- a vision for web, desktop, serve mode, spawn, and iPhone golem ([#147](https://github.com/MilanPavel/golem/pull/147))
- ADR-028, a browser reaches the daemon only through a strict gateway in the golem binary ([#188](https://github.com/MilanPavel/golem/pull/188))
- ADR-029, the web UI techstack ([#190](https://github.com/MilanPavel/golem/pull/190))
- the web UI design, its tokens checked for contrast, and the approved prototype ([#192](https://github.com/MilanPavel/golem/pull/192))
- ADR-034, the docs are a VitePress site over docs/ on GitHub Pages ([#302](https://github.com/MilanPavel/golem/pull/302))
- a map of the docs and a template for the How agents work pages ([#303](https://github.com/MilanPavel/golem/pull/303))
- a VitePress site over docs/, with a side menu, search, and Mermaid ([#312](https://github.com/MilanPavel/golem/pull/312))
- the docs site uses golem's palette and type, and draws Mermaid in it ([#318](https://github.com/MilanPavel/golem/pull/318))
- the pixel golem is the docs site's logo, favicon, and 404 page ([#321](https://github.com/MilanPavel/golem/pull/321))
- **install:** brew install, then golem, is all a new user types ([#322](https://github.com/MilanPavel/golem/pull/322))
- the docs site's home page, with the pixel golem, the legend, and why golem ([#323](https://github.com/MilanPavel/golem/pull/323))
- approval, output, and concept blocks for docs pages, in the web UI's style ([#325](https://github.com/MilanPavel/golem/pull/325))
- introduction and first chat pages, the start of the user guide on the docs site ([#328](https://github.com/MilanPavel/golem/pull/328))
- models and commands pages on the docs site, with every shell and chat command ([#337](https://github.com/MilanPavel/golem/pull/337))

## [0.4.0] - 2026-10-29

### Features

- **tui:** the composer has a ❯ prompt between two thin rules, and a placeholder ([#132](https://github.com/MilanPavel/golem/pull/132))
- **tui:** short hints such as copied or Ctrl-C again to exit show on the right and go away ([#133](https://github.com/MilanPavel/golem/pull/133))
- **tui:** copies say how many characters, and over SSH they ask the terminal to copy ([#138](https://github.com/MilanPavel/golem/pull/138))
- **tui:** drag over the chat to select text, and it is copied when you let go ([#142](https://github.com/MilanPavel/golem/pull/142))
- **tui:** a long paste shows as [Pasted text #N +M lines] in the input, and sends in full ([#143](https://github.com/MilanPavel/golem/pull/143))
- **tui:** Up and Down move between the rows of a multiline draft ([#144](https://github.com/MilanPavel/golem/pull/144))

### Fixes

- **tui:** the install question goes away once Ollama answers, and stays out of the model picker ([#129](https://github.com/MilanPavel/golem/pull/129))

## [0.3.0] - 2026-10-28

### Features

- **install:** scripts/setup.sh, just setup, and a /setup skill for a fresh checkout ([#19](https://github.com/MilanPavel/golem/pull/19))
- **ci:** a /ship skill that opens a pull request, and skills in .agents/skills for any agent ([#20](https://github.com/MilanPavel/golem/pull/20))
- **skills:** find, list, and check skills, and reload them without a restart ([#55](https://github.com/MilanPavel/golem/pull/55))
- **protocol:** run.failed says which model server did not answer, and how to fix it ([#67](https://github.com/MilanPavel/golem/pull/67))
- **models:** a model server that does not answer says how to start it ([#68](https://github.com/MilanPavel/golem/pull/68))
- **tui:** the banner and the status line say which model server is down ([#70](https://github.com/MilanPavel/golem/pull/70))
- **models:** golem can start and stop a local ollama serve ([#76](https://github.com/MilanPavel/golem/pull/76))
- **models:** golem starts a local Ollama when a model call, a download, or /model needs it ([#77](https://github.com/MilanPavel/golem/pull/77))
- **protocol:** golem status and model.server.status show who runs the local model server ([#78](https://github.com/MilanPavel/golem/pull/78))
- **tui:** the meter says starting ollama while golem starts it ([#79](https://github.com/MilanPavel/golem/pull/79))
- **daemon:** golem doctor no longer asks you to start Ollama, since golem starts it ([#111](https://github.com/MilanPavel/golem/pull/111))
- **protocol:** golem says when Ollama is not installed, not only that it is down ([#117](https://github.com/MilanPavel/golem/pull/117))
- **tui:** the TUI can run brew install ollama and show its output in a band ([#118](https://github.com/MilanPavel/golem/pull/118))
- **tui:** choosing a local model without Ollama offers to install it, then downloads the model ([#119](https://github.com/MilanPavel/golem/pull/119))
- **tui:** a message that fails because Ollama is missing offers to install it and send again ([#120](https://github.com/MilanPavel/golem/pull/120))
- **daemon:** golem doctor and the install guide point to /model to install Ollama ([#121](https://github.com/MilanPavel/golem/pull/121))
- **tui:** the terminal tab shows the session title and whether golem is working ([#125](https://github.com/MilanPavel/golem/pull/125))
- **tui:** terminals that show progress show it on the tab while a run works ([#126](https://github.com/MilanPavel/golem/pull/126))
- **tui:** iTerm2 tabs show a coloured dot and the state ([#127](https://github.com/MilanPavel/golem/pull/127))

## [0.2.0] - 2026-10-24

### Features

- **release:** when signing settings are missing, say which ones and where they belong
- **cli:** golem doctor checks the install and says how to fix each problem
- **mcp:** golem runs stdio MCP servers from config.toml
- **mcp:** servers per session or project, restarts, HTTP and Keychain tokens, and a /mcp manager
- **ci:** conventional commits, checked by a commit-msg hook
- **ci:** pull requests, a PR template, and a ruleset on main ([#1](https://github.com/MilanPavel/golem/pull/1))
- **release:** CHANGELOG.md and release notes from the commits, with … ([#2](https://github.com/MilanPavel/golem/pull/2))

### Fixes

- **mcp:** the launch test finds sh in /bin first, so it passes on Linux too

### Docs

- a step-by-step guide for installing golem with Homebrew, from setup to the first chat
- a shorter, friendlier front page: the pixel golem, the legend in an old typeface, and brew install first

## [0.1.0] - 2026-10-22

The first release: a daemon that keeps your chats running, and a chat screen in the terminal that attaches to it.

### Features

- **daemon:** one daemon per user on a Unix socket, kept running by launchd. Every session event is stored in golem.db, and a chat's context survives a restart.
- **tui:** a full-terminal chat with streamed answers. Several screens can follow one chat, and a reopened screen catches up on what it missed.
- **sessions:** named sessions, `/sessions`, `/new`, `/title`, `/fork`, closing a session, and filtering the list by typing.
- **tui:** stop an answer with Ctrl-C and keep what it wrote, edit and recall messages, copy an answer, export a chat, and a `/debug` panel.
- **models:** named profiles, Ollama and hosted providers, a `/model` picker that can switch mid-conversation, and downloading and removing Ollama models.
- **secrets:** API keys in the macOS Keychain, with `golem auth` and `/login`.
- **tools:** read, list, glob, and grep inside the session folder; `write_file` and `edit_file` with a diff to approve; a sandboxed shell; `web_fetch` with host rules.
- **tools:** a permission engine with allow, ask, and deny rules, approvals that wait across a restart, and big tool output kept as artifacts.
- **tui:** a todo band above the composer, and `/todos`.
- **install:** one signed `golem` command, safe upgrades that copy the databases first, `golem daemon install | restart | uninstall`, and `brew install` from a tap.
- **release:** a version tag builds, signs, and checks golem on a clean Mac, then publishes it.
