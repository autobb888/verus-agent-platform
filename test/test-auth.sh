#!/bin/bash
# Full auth flow test

set -e

API="http://localhost:3000"
RPC_USER="user1445741888"
RPC_PASS="pass2f0dc70dded67b9f392c0f3950a547bc6ef4d1edfa78da3a7da5b78113def067b6"
RPC_URL="http://127.0.0.1:18843/"

echo "=== Auth Flow Test ==="
echo

# 1. Get challenge
echo "1. Getting challenge..."
CHALLENGE_RESP=$(curl -s "$API/auth/challenge")
echo "Response: $CHALLENGE_RESP"
echo

# Extract fields using simple text processing
CHALLENGE_ID=$(echo "$CHALLENGE_RESP" | sed 's/.*"challengeId":"\([^"]*\)".*/\1/')
CHALLENGE_TEXT=$(echo "$CHALLENGE_RESP" | sed 's/.*"challenge":"\([^"]*\)".*/\1/')

echo "Challenge ID: $CHALLENGE_ID"
echo

# 2. Sign the challenge with ari@
echo "2. Signing challenge with ari@..."
SIGN_RESP=$(curl -s --user "$RPC_USER:$RPC_PASS" \
  -d "{\"jsonrpc\":\"1.0\",\"id\":\"test\",\"method\":\"signmessage\",\"params\":[\"ari@\",\"$CHALLENGE_TEXT\"]}" \
  -H 'content-type: application/json' \
  "$RPC_URL")
echo "Sign response: $SIGN_RESP"

SIGNATURE=$(echo "$SIGN_RESP" | sed 's/.*"signature":"\([^"]*\)".*/\1/')
echo "Signature: $SIGNATURE"
echo

# 3. Login with the signature
echo "3. Logging in..."
LOGIN_RESP=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d "{\"challengeId\":\"$CHALLENGE_ID\",\"verusId\":\"ari@\",\"signature\":\"$SIGNATURE\"}")
echo "Login response: $LOGIN_RESP"
echo

# 4. Check session
echo "4. Checking session..."
SESSION_RESP=$(curl -s "$API/auth/session" -b cookies.txt)
echo "Session response: $SESSION_RESP"
echo

# 5. Logout
echo "5. Logging out..."
LOGOUT_RESP=$(curl -s -X POST "$API/auth/logout" -b cookies.txt)
echo "Logout response: $LOGOUT_RESP"
echo

# 6. Verify session is gone
echo "6. Verifying session cleared..."
SESSION_RESP=$(curl -s "$API/auth/session" -b cookies.txt)
echo "Session response: $SESSION_RESP"

rm -f cookies.txt

echo
echo "=== Test Complete ==="
