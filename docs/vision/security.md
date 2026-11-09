# Security

- **The browser and the native apps.** The browser reaches only loopback, with a token from a `0600` file, a strict cookie, and exact `Origin` and `Host` checks. The native apps are clients of the same gateway, signed and notarized, and hold no secrets of their own.
- **A stolen phone.** A phone that can approve `shell` can run code on your Mac. Its key lives in the Secure Enclave, risky approvals ask for Face ID, "always allow" is off on the phone by default, and one command revokes a device at once.
- **The relay** forwards only encrypted bytes. Someone who breaks into it learns which devices talk, and when, but not what they say.
- **Sub-agents** never get more than their parent, ask through the parent's screens, and stop at their budget, time, and depth. A child somewhere else gets tokens for one task, no Keychain, and returns a diff you review.
- **An app's users** are never trusted. Serve-mode agents get a few declared tools, never a shell. `ask` becomes `deny`, and risky steps go to an owner. Each app user's sessions and memory are kept apart.
- **A deployed golem** holds keys to model endpoints, so it gets only what it needs: no personal secrets, and keys with budgets. The models sit outside it, behind URLs it is allowed to reach.
- **Content is data.** What tools, the web, sub-agents, and app users send is never an instruction about permissions.
