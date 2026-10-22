#!/bin/sh
# Make golem's self-signed code-signing certificate, once.
#
#   sh scripts/make_signing_cert.sh <out-dir> [common name]
#
# Writes <out-dir>/golem-signing.p12 and prints the values for the GitHub
# secrets and the repository variable the release workflow reads. The same
# certificate must sign every release: the Keychain trusts the daemon by its
# certificate, so a new one makes every user approve the daemon again. Keep the
# .p12 and its password somewhere safe, then delete <out-dir>.
set -eu

out=${1:-}
name=${2:-golem release signing}
if [ -z "$out" ]; then
  printf '%s\n' "usage: sh scripts/make_signing_cert.sh <out-dir> [common name]" >&2
  exit 1
fi
mkdir -p "$out"
chmod 700 "$out"
key="$out/key.pem"
cert="$out/cert.pem"
p12="$out/golem-signing.p12"
trap 'rm -f "$key"' EXIT

# 20 years: a certificate that expires forces the same re-approval as a new one.
openssl req -x509 -newkey rsa:3072 -sha256 -days 7300 -nodes \
  -keyout "$key" -out "$cert" -subj "/CN=$name" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null

password=$(openssl rand -hex 24)
# macOS's security tool reads only the older PKCS#12 encryption. OpenSSL 3 and
# newer need -legacy for it; LibreSSL (/usr/bin/openssl) uses it by default.
if ! openssl pkcs12 -export -legacy -inkey "$key" -in "$cert" -out "$p12" \
  -passout "pass:$password" 2>/dev/null; then
  openssl pkcs12 -export -inkey "$key" -in "$cert" -out "$p12" -passout "pass:$password"
fi
chmod 600 "$p12"

sha1=$(openssl x509 -in "$cert" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')

cat <<EOF
Certificate "$name", SHA-1 $sha1, in $p12

GitHub, Settings > Secrets and variables > Actions:
  secret   MACOS_SIGN_P12_BASE64    base64 < "$p12" | pbcopy, then paste
  secret   MACOS_SIGN_P12_PASSWORD  $password
  variable MACOS_SIGN_IDENTITY      $sha1

To sign local builds with it too, so a local daemon keeps the Keychain's trust:
  security import "$p12" -k ~/Library/Keychains/login.keychain-db -P '$password' -T /usr/bin/codesign
  GOLEM_SIGN_IDENTITY=$sha1 just dist
EOF
