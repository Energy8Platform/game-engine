#!/usr/bin/env node

/**
 * Postinstall script: downloads the e8 SpinML engine binaries (Rust) for the
 * current platform — the math runtime for games with `runtime: 'spin'` in
 * math.config.ts. Falls back silently: spin games can point E8_BINARY /
 * E8_SERVER_BINARY at a local build (casino-platform/e8/target/release).
 *
 * Delivery: GitHub Releases of THIS repo (game-engine), tag `e8-v<version>`
 * — the engine source lives in the private casino-platform repo, so the
 * binaries are published here, same discipline as the old Go simulate CLI.
 */

import { createWriteStream, chmodSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get } from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, '..', 'bin');

// ─── Config ─────────────────────────────────────────────

const REPO = process.env.E8_RELEASE_REPO || 'energy8platform/game-engine';
// e8 binary version — bump when new Rust binaries are uploaded to Releases.
// The binary is game-agnostic (it compiles any .spin), so it only needs to
// move when the engine/CLI itself changes.
const BINARY_VERSION = process.env.E8_BINARY_VERSION || '0.1.2';

// Два бинаря на платформу: e8 (математика/симуляция) и e8-server
// (дев-раунды для Vite-плагина).
const PLATFORM_MAP = {
  'darwin-arm64': ['e8-darwin-arm64', 'e8-server-darwin-arm64'],
  'darwin-x64': ['e8-darwin-amd64', 'e8-server-darwin-amd64'],
  'linux-x64': ['e8-linux-amd64', 'e8-server-linux-amd64'],
  'linux-arm64': ['e8-linux-arm64', 'e8-server-linux-arm64'],
  'win32-x64': ['e8-windows-amd64.exe', 'e8-server-windows-amd64.exe'],
};

// ─── Main ───────────────────────────────────────────────

async function main() {
  const key = `${process.platform}-${process.arch}`;
  const binaryNames = PLATFORM_MAP[key];

  if (!binaryNames) {
    console.log(`[e8] No engine binaries available for ${key}; spin-runtime math will need E8_BINARY.`);
    return;
  }

  // Префикс e8-: в этом репо теги v* заняты релизами старого Go simulate CLI.
  const tag = `e8-v${BINARY_VERSION}`;

  for (const binaryName of binaryNames) {
    const dest = join(BIN_DIR, binaryName);

    // Skip if already downloaded
    if (existsSync(dest)) {
      continue;
    }

    const url =
      process.env.E8_DOWNLOAD_BASE
        ? `${process.env.E8_DOWNLOAD_BASE}/${tag}/${binaryName}`
        : `https://github.com/${REPO}/releases/download/${tag}/${binaryName}`;

    console.log(`[e8] Downloading ${binaryName} for ${key}...`);

    try {
      if (!existsSync(BIN_DIR)) {
        mkdirSync(BIN_DIR, { recursive: true });
      }
      await download(url, dest);
      chmodSync(dest, 0o755);
      console.log(`[e8] Installed ${binaryName}`);
    } catch (err) {
      // Non-fatal — Lua games are unaffected; spin games can use
      // E8_BINARY / E8_SERVER_BINARY or a $PATH install.
      console.log(`[e8] Could not download ${binaryName}: ${err.message}`);
    }
  }
}

// ─── Download with redirect following ───────────────────

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) {
      return reject(new Error('Too many redirects'));
    }

    get(url, { headers: { 'User-Agent': 'game-engine-postinstall' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest, redirects - 1).then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

main().catch(() => {
  // Never fail the install
});
