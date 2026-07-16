#!/usr/bin/env bash
# One-time setup for issue tracking on this repo.
# Requires GitHub Issues to be enabled first (Settings -> Features -> Issues,
# or: gh api -X PATCH repos/frankville/node-zklib -F has_issues=true  [needs admin]).
#
# Run from an account with push access:  bash .github/setup-tracker.sh
set -euo pipefail

REPO="frankville/node-zklib"

echo "Ensuring labels..."
ensure_label() { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null; }
ensure_label "protocol"        "5319e7" "Packet format / device behavior on the wire"
ensure_label "needs-hardware"  "d93f0b" "Blocked on confirmation with a physical device"
ensure_label "enhancement"     "a2eeef" "New feature or improvement"
ensure_label "bug"             "d73a4a" "Something isn't working"
ensure_label "good first issue" "7057ff" "Good for newcomers"

echo "Creating issues..."
gh issue create --repo "$REPO" \
  --title "[protocol] Confirm meaning of realtime verif_state=135 (0x87) on ZEM760" \
  --label "protocol,needs-hardware" \
  --body "$(cat <<'EOF'
Realtime EF_ATTLOG (event_type=1) frames on the ZEM760 (fw 6.60) surface a
stable verif_state of 135 (0x87 = 0x80 | 7). Stored attendance records only
ever carry a status byte of 0 or 7, so 135 looks like "state 7 with the high
bit set" — plausibly a denied/failed flag, and it started appearing during
group-access denial testing.

Unconfirmed. Needs a controlled capture:
- Capture raw realtime frames while punching UID 1 (a) DENIED (group not in any
  unlock combination) and (b) GRANTED (group added to a combination).
- Compare the byte at the verif_state offset across both cases.
- If 0x80 marks denial, decode it into a semantic flag (e.g. `denied: true` +
  base state) instead of exposing a raw 135.

See `decodeCompactTCPRealTimeAttendance` in utils.js and the Realtime Events
section of AGENTS.md. Related: attendance status byte meaning.
EOF
)"

gh issue create --repo "$REPO" \
  --title "[protocol] Determine stored-attendance status byte meaning (0 vs 7) on ZEM760" \
  --label "protocol,needs-hardware" \
  --body "$(cat <<'EOF'
The 16-byte compact attendance record carries a status byte at offset 8 that is
only ever 0 or 7 in captures so far. `getAttendances()` now surfaces it as
`status`, but its meaning (verify method vs in/out punch state) is unconfirmed
for this firmware.

Needs a labeled punch: record known check-in vs check-out (or different verify
methods) at the panel and correlate with the byte. Likely resolvable in the
same session as the realtime verif_state=135 capture, since it may be the same
field.

See `decodeAttendanceData` in utils.js and the Stored Attendance Logs section
of AGENTS.md.
EOF
)"

gh issue create --repo "$REPO" \
  --title "[protocol] Locate the holiday flag in compact20 group-timezone records" \
  --label "protocol,needs-hardware" \
  --body "$(cat <<'EOF'
The compact20 group-timezone write layout (confirmed on ZEM760 fw 6.60) is
group(u32) | valid(u32) | tz1(u32) | tz2(u32) | tz3(u32). Word 2 is a
record-valid flag (0 deletes the record), NOT the holiday flag. Where the
"valid on holidays" bit is stored on this firmware is unknown.

Needs hardware: capture a ZKAccess group sync with "Válido en días festivos"
toggled on vs off and diff the CMD_GRPTZ_WRQ payload (and/or any GVS<group>
option). Then wire it into `encodeGroupTimezoneInfo`/`decodeGroupTimezoneInfo`.

See the Group Timezone format notes in AGENTS.md.
EOF
)"

gh issue create --repo "$REPO" \
  --title "[protocol] Verify multi-group (AND) unlock combinations on ZEM760" \
  --label "protocol,needs-hardware" \
  --body "$(cat <<'EOF'
Single-group-per-combination unlock writes are hardware-verified (ASCII form,
e.g. `1:2::::::::`). Multiple groups within one combination (e.g. slot `1,2`)
are documented as a multi-user AND rule but have NOT been confirmed on this
firmware — the ASCII multi-group write and its access semantics are untested.

Needs hardware: write a combination with two groups, verify readback, and test
whether it enforces AND (both groups must present a member) at the panel.
Restore the original config afterward.

See `helpers/unlockGroups.js` and the Unlock Groups section of AGENTS.md.
EOF
)"

echo "Done. Open issues: gh issue list --repo $REPO"
