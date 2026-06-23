#!/usr/bin/env bash
# Render the technical PDFs from their markdown sources.
#
# The sources in docs/spec/derived/ are DERIVED from docs/spec/MASTER-SPEC.md
# (the single source of truth). This script is the "N derivations" half of the
# Master Spec's "one source, N derivations — never N sources" rule: edit the
# spec, edit the affected derived .md, re-run this, commit the regenerated PDFs.
# No more orphaned binaries that silently drift on every protocol decision.
#
# Usage:
#   pnpm docs:build-pdfs            # all derived docs under docs/spec/derived/
#   pnpm docs:build-pdfs 04         # just the 04-* doc
#   pnpm docs:build-pdfs 04 10      # a subset
#
# Requirements:
#   - pandoc        (apt install pandoc | brew install pandoc)
#   - a PDF engine. Default: weasyprint (pip install weasyprint — best CSS
#     fidelity). Override with PDF_ENGINE=wkhtmltopdf | xelatex | typst | … to
#     whichever you already have. The CSS (style.css) only applies to the
#     HTML-based engines (weasyprint, wkhtmltopdf).

set -euo pipefail

PDF_ENGINE="${PDF_ENGINE:-weasyprint}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

SRC_DIR="docs/spec/derived"
OUT_DIR="docs/en"
CSS="$SRC_DIR/style.css"

if ! command -v pandoc >/dev/null 2>&1; then
  echo "✗ pandoc not found. Install:  apt install pandoc   (or: brew install pandoc)"
  exit 1
fi
if ! command -v "$PDF_ENGINE" >/dev/null 2>&1; then
  echo "✗ PDF engine '$PDF_ENGINE' not found."
  echo "  Default is weasyprint:  pip install weasyprint"
  echo "  Or pick one you have:   PDF_ENGINE=wkhtmltopdf pnpm docs:build-pdfs"
  exit 1
fi

# Collect sources: all NN-*.md, or only those whose prefix matches the args.
shopt -s nullglob
sources=()
if [[ $# -gt 0 ]]; then
  for sel in "$@"; do
    for f in "$SRC_DIR/${sel}"*.md; do sources+=("$f"); done
  done
else
  for f in "$SRC_DIR"/[0-9][0-9]-*.md; do sources+=("$f"); done
fi

if [[ ${#sources[@]} -eq 0 ]]; then
  echo "✗ No matching sources under $SRC_DIR/ (expected NN-name.md files)."
  exit 1
fi

echo "▶ Rendering ${#sources[@]} doc(s) with pandoc + $PDF_ENGINE…"
echo "  source: $SRC_DIR/   →   output: $OUT_DIR/"
echo ""

for src in "${sources[@]}"; do
  base="$(basename "$src" .md)"
  out="$OUT_DIR/${base}.pdf"
  echo "─── $base ─────────────────────────────────────────"
  pandoc "$src" \
    --from gfm \
    --pdf-engine="$PDF_ENGINE" \
    --css "$CSS" \
    --toc --toc-depth=2 \
    --standalone \
    --output "$out"
  echo "  → $out"
  echo ""
done

echo "✓ Done. Regenerated PDFs are under $OUT_DIR/ — review the diff and commit them."
