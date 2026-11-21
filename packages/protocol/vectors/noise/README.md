# Noise test vectors

`noise-nk-25519-aesgcm-sha256.json` holds the published test vectors for
`Noise_NK_25519_AESGCM_SHA256`, the handshake of the relay pairing (ADR 051).

- Source: `vectors/cacophony.txt` of
  https://github.com/haskell-cryptography/cacophony, commit
  `8ee9d41e34a1a596cfa3ab12aa4069ff87dc1247`. The `source` key in the JSON
  repeats this.
- Filter: only entries whose protocol name (`protocol_name`, or `name` in
  older entries) is exactly `Noise_NK_25519_AESGCM_SHA256`. The upstream file
  has 944 entries; 1 matches. The entry is copied unchanged.
- Licence: `LICENSE` is the cacophony licence at that commit, verbatim. It is
  the Unlicense (public domain), not BSD-3-Clause as ADR 051 says.

The vectors are not made by our code. The TypeScript handshake (#754) and the
Swift handshake (#759) each run every entry.
