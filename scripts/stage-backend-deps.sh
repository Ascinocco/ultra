#!/bin/bash
# Stages backend dependencies for electron-builder packaging.
# pnpm uses symlinks which electron-builder copies as-is (broken in .app).
# This script resolves them into a flat directory.

set -e

ULTRA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_ROOT="$ULTRA_ROOT/apps/backend"
STAGE_DIR="$ULTRA_ROOT/apps/desktop/.stage/backend-deps"

echo "[stage] Cleaning staging directory..."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

echo "[stage] Copying backend node_modules (dereferencing symlinks)..."
# Use cp -RLf to follow symlinks and copy actual files
cp -RLf "$BACKEND_ROOT/node_modules/" "$STAGE_DIR/node_modules/" 2>/dev/null || true

# Remove unnecessary large directories to reduce bundle size
rm -rf "$STAGE_DIR/node_modules/.cache" 2>/dev/null || true
rm -rf "$STAGE_DIR/node_modules/.vite" 2>/dev/null || true
rm -rf "$STAGE_DIR/node_modules/@types" 2>/dev/null || true

echo "[stage] Copying backend dist..."
cp -R "$BACKEND_ROOT/dist/" "$STAGE_DIR/dist/"

echo "[stage] Copying backend package.json..."
cp "$BACKEND_ROOT/package.json" "$STAGE_DIR/package.json"

SIZE=$(du -sh "$STAGE_DIR" | awk '{print $1}')
echo "[stage] Done. Staged backend: $SIZE"
