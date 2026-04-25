#!/usr/bin/env node

/**
 * Postinstall script: downloads the native simulation binary for the current
 * platform from GitHub Releases. Falls back silently — the JS simulation
 * will be used if the binary is unavailable.
 */

import { createWriteStream, chmodSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get } from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, '..', 'bin');

// ─── Config ─────────────────────────────────────────────

const REPO = 'energy8platform/game-engine';
// Binary version — update this when new Go binaries are built and uploaded to GitHub Releases.
// The binary is backwards-compatible: it runs any Lua script, so it doesn't need to match
// the engine version exactly. Only bump when the Go simulate CLI itself changes.
const BINARY_VERSION = '0.13.0';

const PLATFORM_MAP = {
  'darwin-arm64': 'simulate-darwin-arm64',
  'darwin-x64': 'simulate-darwin-amd64',
  'linux-x64': 'simulate-linux-amd64',
  'linux-arm64': 'simulate-linux-arm64',
  'win32-x64': 'simulate-windows-amd64.exe',
};

// ─── Main ───────────────────────────────────────────────

async function main() {
  const key = `${process.platform}-${process.arch}`;
  const binaryName = PLATFORM_MAP[key];

  if (!binaryName) {
    console.log(`[simulate] No native binary available for ${key}, will use JS simulation.`);
    return;
  }

  const dest = join(BIN_DIR, binaryName);

  // Skip if already downloaded
  if (existsSync(dest)) {
    return;
  }

  const tag = `v${BINARY_VERSION}`;

  const url = `https://github.com/${REPO}/releases/download/${tag}/${binaryName}`;

  console.log(`[simulate] Downloading native binary for ${key}...`);

  try {
    if (!existsSync(BIN_DIR)) {
      mkdirSync(BIN_DIR, { recursive: true });
    }
    await download(url, dest);
    chmodSync(dest, 0o755);
    console.log(`[simulate] Installed ${binaryName}`);
  } catch (err) {
    // Non-fatal — JS simulation is the fallback
    console.log(`[simulate] Could not download native binary: ${err.message}`);
    console.log(`[simulate] Will use JS simulation instead.`);
  }
}

// ─── Download with redirect following ───────────────────

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) {
      return reject(new Error('Too many redirects'));
    }

    get(url, { headers: { 'User-Agent': 'game-engine-postinstall' } }, (res) => {
      // Follow redirects (GitHub sends 302 to S3)
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
