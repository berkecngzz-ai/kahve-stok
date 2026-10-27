import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Ön yüz değiştiyse sürüm etiketi de güncellenmiş olmalı; yoksa telefonlar eski dosyayı önbellekten çalıştırır.
test('ön yüz sürüm etiketi güncel', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/surum.mjs', import.meta.url)), '--kontrol'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
