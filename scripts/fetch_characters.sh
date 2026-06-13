#!/usr/bin/env bash
set -euo pipefail

# Usage: DNDBEYOND_TOKEN=<token> ./fetch_character.sh <id> [id ...]
# retrieve $DNDBEYOND_TOKEN from Network tab in DevTools on dndbeyond.com

CAMPAIGN_FILE="data/campaign.json"

DEFAULT_IDS=(33637295 147177664 151272538 147177611 152757358 153797062)

if [ $# -eq 0 ]; then
  set -- "${DEFAULT_IDS[@]}"
fi

if [ -z "${DNDBEYOND_TOKEN:-}" ]; then
  echo "Error: DNDBEYOND_TOKEN environment variable is not set"
  exit 1
fi

if [ ! -f "$CAMPAIGN_FILE" ]; then
  echo '{"campaign":"","characters":[]}' > "$CAMPAIGN_FILE"
fi

FAILED_IDS=()

for CHARACTER_ID in "$@"; do
  echo "Fetching character $CHARACTER_ID..."

  # Capture the body and HTTP status separately so a failed fetch reports its
  # status and skips this ID, rather than silently aborting the whole batch
  # (curl -f + pipefail + set -e would otherwise kill the script with no message).
  RESPONSE=$(curl -s -w '\n%{http_code}' "https://character-service.dndbeyond.com/character/v5/character/$CHARACTER_ID" \
    -H "Authorization: Bearer $DNDBEYOND_TOKEN") || {
    echo "  ! Skipping $CHARACTER_ID (curl failed — network/connection error)" >&2
    FAILED_IDS+=("$CHARACTER_ID")
    continue
  }
  HTTP_STATUS=${RESPONSE##*$'\n'}
  BODY=${RESPONSE%$'\n'*}

  if [ "$HTTP_STATUS" != "200" ]; then
    echo "  ! Skipping $CHARACTER_ID (HTTP $HTTP_STATUS — character may be private, or token expired)" >&2
    FAILED_IDS+=("$CHARACTER_ID")
    continue
  fi

  # jq can still fail on an unexpected payload shape; treat that as skippable too.
  if ! CHARACTER_JSON=$(echo "$BODY" | jq ".data | { name, username, race: .race.fullName, classes: (.classes | map({ name: .definition.name, level, subclassName: .subclassDefinition.name, subclassDescription: .subclassDefinition.description })), \
alignmentId, background: .background.definition.name, personalityTraits: .traits.personalityTraits, ideals: .traits.ideals, bonds: .traits.bonds, flaws: .traits.flaws, backstory: .notes.backstory, \
otherNotes: .notes.otherNotes, stats: (.stats | map({ name: ([\"STR\",\"DEX\",\"CON\",\"INT\",\"WIS\",\"CHA\"][.id - 1]), value })), feats: (.feats | map(.definition.name)), actions: (.actions.class | map(.name)), spells: (.classSpells | map(.spells | map(.definition.name))), \
equipment: (.inventory | map(select(.equipped == true) | { name: .definition.name, type: .definition.type })), age, hair, eyes, skin, height, weight, gender, avatar: .decorations.avatarUrl, backdrop: .decorations.defaultBackdrop.backdropAvatarUrl, campaign: .campaign.name }"); then
    echo "  ! Skipping $CHARACTER_ID (unexpected response shape — jq parse failed)" >&2
    FAILED_IDS+=("$CHARACTER_ID")
    continue
  fi

  CHAR_NAME=$(echo "$CHARACTER_JSON" | jq -r '.name')
  CAMPAIGN_NAME=$(echo "$CHARACTER_JSON" | jq -r '.campaign')
  echo "  -> $CHAR_NAME ($CAMPAIGN_NAME)"

  # Replace character if already present (matched by name), otherwise append.
  # Set top-level campaign name from the first non-empty value seen.
  jq --argjson char "$CHARACTER_JSON" --arg campaign "$CAMPAIGN_NAME" '
    .campaign = (if .campaign == "" then $campaign else .campaign end) |
    if any(.characters[]; .name == $char.name)
    then .characters = [.characters[] | if .name == $char.name then $char else . end]
    else .characters += [$char]
    end
  ' "$CAMPAIGN_FILE" > "$CAMPAIGN_FILE.tmp" && mv "$CAMPAIGN_FILE.tmp" "$CAMPAIGN_FILE"

  echo "  Saved to $CAMPAIGN_FILE"
done

SUCCEEDED=$(($# - ${#FAILED_IDS[@]}))
echo "Done. $CAMPAIGN_FILE updated with $SUCCEEDED of $# character(s)."
if [ ${#FAILED_IDS[@]} -gt 0 ]; then
  echo "Failed: ${FAILED_IDS[*]}" >&2
fi
