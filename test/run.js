'use strict';
// Levanta wrangler dev (D1 y R2 locales en una carpeta temporal), aplica las migraciones y ejecuta la prueba de humo.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'da-cf-'));
const port = process.env.PORT || '8799';
const wr = (args, opts = {}) => spawnSync('npx', ['wrangler', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, ...opts });

const mig = wr(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist]);
if (mig.status !== 0) { console.error(mig.stdout, mig.stderr); process.exit(1); }

const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', port, '--persist-to', persist,
  '--var', 'ADMIN_PASSWORD:clave-de-prueba-123', '--var', 'WOMPI_PUBLIC_KEY:pub_test_x', '--var', 'WOMPI_INTEGRITY_SECRET:integ_x', '--var', 'WOMPI_EVENTS_SECRET:events_x', '--var', 'ADMIN_USER:alex'],
{ cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
let log = ''; dev.stdout.on('data', (d) => { log += d; }); dev.stderr.on('data', (d) => { log += d; });
const stop = (code) => { try { process.kill(-dev.pid); } catch {} dev.kill('SIGKILL'); fs.rmSync(persist, { recursive: true, force: true }); process.exit(code); };

(async () => {
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(url + '/api/settings'); if (r.status === 200) break; } catch {}
    if (i === 89) { console.error('El Worker no arrancó:\n' + log); return stop(1); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const t = spawn('node', [path.join(__dirname, 'smoke.js')], { stdio: 'inherit', env: { ...process.env, BASE_URL: url } });
  t.on('exit', (c) => { if (c) console.error(log.slice(-3000)); stop(c || 0); });
})();
