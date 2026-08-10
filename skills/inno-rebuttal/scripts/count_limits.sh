#!/usr/bin/env bash
# count_limits.sh — Verify rebuttal length against venue limits.
#
# Usage:
#   count_limits.sh <file> [--chars|--words|--pages] [--limit N]
#
# Examples:
#   count_limits.sh rebuttal.txt --chars --limit 5000
#   count_limits.sh rebuttal.tex --words
#   count_limits.sh rebuttal.md --chars

set -euo pipefail

usage() {
    echo "Usage: $0 <file> [--chars|--words|--pages] [--limit N]"
    echo ""
    echo "Options:"
    echo "  --chars   Count characters (default)"
    echo "  --words   Count words"
    echo "  --pages   Estimate pages (assuming ~3000 chars/page)"
    echo "  --limit N Warn if count exceeds N"
    exit 1
}

if [[ $# -lt 1 ]]; then
    usage
fi

FILE="$1"
shift

if [[ ! -f "$FILE" ]]; then
    echo "Error: File not found: $FILE" >&2
    exit 1
fi

MODE="chars"
LIMIT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --chars) MODE="chars"; shift ;;
        --words) MODE="words"; shift ;;
        --pages) MODE="pages"; shift ;;
        --limit) LIMIT="$2"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; usage ;;
    esac
done

# Strip common markup for more accurate counting
strip_markup() {
    # Remove LaTeX commands, markdown headers/bold/italic, HTML tags
    sed -E \
        -e 's/\\[a-zA-Z]+\{([^}]*)\}/\1/g' \
        -e 's/\\[a-zA-Z]+//g' \
        -e 's/[#*_`~]//g' \
        -e 's/<[^>]+>//g' \
        "$1"
}

case "$MODE" in
    chars)
        COUNT=$(strip_markup "$FILE" | wc -m | tr -d ' ')
        UNIT="characters"
        ;;
    words)
        COUNT=$(strip_markup "$FILE" | wc -w | tr -d ' ')
        UNIT="words"
        ;;
    pages)
        CHAR_COUNT=$(strip_markup "$FILE" | wc -m | tr -d ' ')
        COUNT=$(echo "scale=1; $CHAR_COUNT / 3000" | bc)
        UNIT="estimated pages (~3000 chars/page)"
        ;;
esac

echo "File:  $FILE"
echo "Count: $COUNT $UNIT"

if [[ -n "$LIMIT" ]]; then
    # For pages mode, compare as decimals
    if [[ "$MODE" == "pages" ]]; then
        OVER=$(echo "$COUNT > $LIMIT" | bc -l)
    else
        OVER=$(( COUNT > LIMIT ? 1 : 0 ))
    fi

    if [[ "$OVER" -eq 1 ]]; then
        echo "WARNING: Exceeds limit of $LIMIT $UNIT"
        exit 2
    else
        echo "OK: Within limit of $LIMIT $UNIT"
    fi
fi
