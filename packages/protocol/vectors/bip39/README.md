# BIP-39 English word list

`english.txt` is the 2048-word English list of BIP-39. The pairing confirmation (ADR 051) takes
three words from it, so the Mac and the phone must hold exactly the same list.

- Source: <https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt>, last changed in
  commit `ce1862ac6bcffa1dd20aad858380e51e66e949ea` (2014-02-07), fetched 2026-11-21.
- SHA-256: `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda`
- Licence: BIP-39 is released under the MIT licence (the licence line of the BIP's header).
  The list is data, not a package, and is not edited here.

The gateway carries the same words as `packages/gateway/src/bip39-english.ts`. A test fails when
the two differ or when this file's hash changes.
