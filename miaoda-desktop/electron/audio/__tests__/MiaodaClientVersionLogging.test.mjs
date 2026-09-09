import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const authClient = readFileSync(path.join(root, 'electron/services/MiaodaAuthClient.ts'), 'utf8');

test('authenticated API requests report the packaged desktop version without making it mandatory', () => {
  assert.match(authClient, /import \{ app, safeStorage \} from 'electron'/);
  assert.match(authClient, /String\(app\.getVersion\(\) \|\| ''\)\.trim\(\)\.slice\(0, 64\)/);
  assert.match(authClient, /headers\['X-Miaoda-Client-Version'\] = version/);

  const streamStart = authClient.indexOf('public async streamInterviewAnswer');
  const streamEnd = authClient.indexOf('public async streamInterviewTranslation', streamStart);
  assert.match(authClient.slice(streamStart, streamEnd), /this\.addClientVersionHeader\(headers\)/);

  const requestStart = authClient.indexOf('private async request<T>');
  const requestEnd = authClient.indexOf('private async requestForm<T>', requestStart);
  assert.match(authClient.slice(requestStart, requestEnd), /this\.addClientVersionHeader\(headers\)/);
  assert.match(authClient, /catch \{[\s\S]*Electron has not exposed application metadata yet/);
});
