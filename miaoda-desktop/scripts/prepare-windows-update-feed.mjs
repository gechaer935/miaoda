import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
const version = String(packageJson.version || '').trim();

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package version: ${version || '(empty)'}`);
}

const releaseDir = path.join(projectDir, 'release');
const installerName = `Miaoda-Setup-${version}.exe`;
const installerPath = path.join(releaseDir, installerName);
const blockmapPath = `${installerPath}.blockmap`;
const updateInfoPath = path.join(releaseDir, 'latest.yml');

for (const requiredPath of [installerPath, blockmapPath, updateInfoPath]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Required update artifact is missing: ${requiredPath}`);
  }
}

const releaseBaseUrl = `https://gitee.com/OWNER/miaoda-releases/releases/download/v${version}`;
const installerUrl = `${releaseBaseUrl}/${installerName}`;
let updateInfo = fs.readFileSync(updateInfoPath, 'utf8');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const expectedReference = `(?:${escapeRegExp(installerName)}|${escapeRegExp(installerUrl)})`;
const fileUrlPattern = new RegExp(`(^\\s*-\\s+url:\\s*)["']?${expectedReference}["']?\\s*$`, 'm');
const legacyPathPattern = new RegExp(`(^path:\\s*)["']?${expectedReference}["']?\\s*$`, 'm');

if (!fileUrlPattern.test(updateInfo) || !legacyPathPattern.test(updateInfo)) {
  throw new Error('latest.yml does not reference the expected Windows installer');
}

updateInfo = updateInfo
  .replace(fileUrlPattern, `$1${installerUrl}`)
  .replace(legacyPathPattern, `$1${installerUrl}`);
fs.writeFileSync(updateInfoPath, updateInfo, 'utf8');

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex').toUpperCase();
fs.writeFileSync(`${installerPath}.sha256`, `${sha256}  ${installerName}\n`, 'utf8');

console.log(`[UpdateFeed] Prepared latest.yml for v${version}`);
console.log(`[UpdateFeed] Installer SHA-256: ${sha256}`);
