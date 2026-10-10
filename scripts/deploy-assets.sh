#!/usr/bin/env bash
# Uploads the production build to the site bucket with explicit content types and cache
# lifetimes, then invalidates the unhashed entry points. Used by .github/workflows/deploy.yml.
#
#   scripts/deploy-assets.sh <bucket> <distribution-id> [dist-dir]
set -euo pipefail
BUCKET="$1"
DIST_ID="$2"
DIR="${3:-packages/web/dist}"
IMMUTABLE="public, max-age=31536000, immutable"

# Content-hashed JS/CSS: cache for a year. Source maps stay out of production.
aws s3 sync "$DIR/assets" "s3://$BUCKET/assets" --delete \
  --exclude "*.map" --exclude "*.wasm" --cache-control "$IMMUTABLE"
# WebAssembly needs application/wasm for streaming compilation; set it explicitly rather than
# trusting the CLI's MIME table.
aws s3 sync "$DIR/assets" "s3://$BUCKET/assets" \
  --exclude "*" --include "*.wasm" --content-type "application/wasm" --cache-control "$IMMUTABLE"

# Bundled tracks: a week. Of the synthetic fixtures only the calibration click track ships.
aws s3 sync "$DIR/audio" "s3://$BUCKET/audio" --delete \
  --exclude "fixtures/*" --include "fixtures/click-120.wav" \
  --cache-control "public, max-age=604800"

# Everything else (index.html, favicon): always revalidate so a deploy is visible at once.
aws s3 sync "$DIR" "s3://$BUCKET" --delete \
  --exclude "assets/*" --exclude "audio/*" --exclude ".vite/*" --exclude "*.map" \
  --cache-control "no-cache"

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/" "/index.html" \
  --query "Invalidation.Id" --output text
