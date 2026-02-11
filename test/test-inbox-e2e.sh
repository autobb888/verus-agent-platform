#!/bin/bash
# End-to-end inbox flow test
# Tests: buyer submits review → agent sees in inbox → can copy updateidentity command

set -e

API="http://localhost:3000"
AGENT_VERUS_ID="ari@"
BUYER_VERUS_ID="testbuyer@"
JOB_HASH="job_$(date +%s)"

echo "=== E2E Inbox Flow Test ==="
echo ""

# 1. Check API health
echo "1. Checking API health..."
HEALTH=$(curl -s "$API/v1/health")
echo "   $HEALTH" | head -c 100
echo ""
echo ""

# 2. Login as the agent (ari@)
echo "2. Getting challenge for $AGENT_VERUS_ID..."
CHALLENGE_RESP=$(curl -s "$API/v1/auth/challenge")
CHALLENGE=$(echo "$CHALLENGE_RESP" | grep -o '"challenge":"[^"]*"' | cut -d'"' -f4)
echo "   Challenge: ${CHALLENGE:0:40}..."
echo ""

echo "   Sign this with: verus -testnet signmessage \"$AGENT_VERUS_ID\" \"$CHALLENGE\""
echo ""
echo "   Enter signature (or 'skip' to use mock test):"
read -r SIGNATURE

if [ "$SIGNATURE" = "skip" ]; then
    echo "   Skipping login, testing public endpoints only..."
    COOKIE=""
else
    echo "3. Logging in..."
    LOGIN_RESP=$(curl -s -c cookies.txt -b cookies.txt \
        -X POST "$API/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"verusId\":\"$AGENT_VERUS_ID\",\"signature\":\"$SIGNATURE\"}")
    echo "   $LOGIN_RESP"
    COOKIE="-b cookies.txt"
fi
echo ""

# 3. Submit a review (as buyer) - this goes to inbox
echo "4. Submitting review as $BUYER_VERUS_ID..."
echo "   (This would normally require buyer signature verification)"

# For testing, we call submit-review which should put it in inbox
# Note: In prod, this needs proper buyer signature
REVIEW_RESP=$(curl -s -X POST "$API/v1/reviews" \
    -H "Content-Type: application/json" \
    -d "{
        \"agentVerusId\": \"$AGENT_VERUS_ID\",
        \"buyerVerusId\": \"$BUYER_VERUS_ID\",
        \"jobHash\": \"$JOB_HASH\",
        \"rating\": 5,
        \"message\": \"Excellent service! Fast and professional.\",
        \"signature\": \"test_signature_$(date +%s)\"
    }")
echo "   Response: $REVIEW_RESP"
echo ""

# 4. Check inbox (if logged in)
if [ -n "$COOKIE" ]; then
    echo "5. Checking inbox for $AGENT_VERUS_ID..."
    INBOX_RESP=$(curl -s $COOKIE "$API/v1/me/inbox")
    echo "   Inbox: $INBOX_RESP"
    echo ""
    
    # Get first item ID
    ITEM_ID=$(echo "$INBOX_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -n "$ITEM_ID" ]; then
        echo "6. Getting item details with updateidentity command..."
        ITEM_RESP=$(curl -s $COOKIE "$API/v1/me/inbox/$ITEM_ID")
        echo "   Item details:"
        echo "$ITEM_RESP" | python3 -m json.tool 2>/dev/null || echo "$ITEM_RESP"
    fi
fi

echo ""
echo "=== Test Complete ==="

# Cleanup
rm -f cookies.txt
