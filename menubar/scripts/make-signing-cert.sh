#!/bin/bash
# One-time setup per Mac (chunk 95, D1): a self-signed code-signing identity
# for the menu bar app, so its designated requirement stays the same across
# rebuilds and macOS keeps the Automation (Spotify) permission.
#
# Idempotent. Writes nothing under the repo: the key and the .p12 live in a
# temp folder that is deleted on exit; only the login keychain keeps them.
set -euo pipefail

NAME="Hupomnemata Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
# macOS LibreSSL on purpose: its PKCS#12 output imports cleanly into the
# keychain; OpenSSL 3's default encryption does not.
OPENSSL=/usr/bin/openssl

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "exists"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no

[dn]
CN = $NAME

[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

"$OPENSSL" req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -days 3650 -config "$TMP/cert.cnf" 2>/dev/null

PW="$("$OPENSSL" rand -hex 24)"
"$OPENSSL" pkcs12 -export -name "$NAME" \
  -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/identity.p12" -passout "pass:$PW"

security import "$TMP/identity.p12" -k "$KEYCHAIN" -P "$PW" -T /usr/bin/codesign

# Opens the macOS password dialog: trusting a certificate for code signing
# changes the user's trust settings.
security add-trusted-cert -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem"

LINE="$(security find-identity -p codesigning "$KEYCHAIN" | grep "$NAME" | head -1)"
echo "$LINE"
echo "SHA-1: $(echo "$LINE" | awk '{print $2}')"
