import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const voiceTables = ['voice_quotas', 'voice_reservations', 'voice_login_codes', 'voice_sessions'];
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function location(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('POSTGRES_URL_REQUIRED');
  const host = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? 'localhost' : url.hostname.toLowerCase().replace('-pooler.', '.');
  return `${host}:${url.port || '5432'}${url.pathname}`;
}
export function databaseConnection(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || (url.hostname === 'helium' && url.searchParams.get('sslmode') === 'disable');
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
  return { connectionString: url.href, ssl: local ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 10000, query_timeout: 30000 };
}
export async function migrationSql() {
  const sql = (await Promise.all(['0004_voice_quotas.sql', '0005_voice_login.sql'].map(name => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')))).join('\n');
  const statements = sql.split(';').map(value => value.trim()).filter(Boolean);
  for (const statement of statements) {
    if (!/^CREATE (?:TABLE IF NOT EXISTS voice_(?:quotas|reservations|login_codes|sessions)\s*\(|(?:UNIQUE )?INDEX IF NOT EXISTS voice_[a-z_]+ ON voice_(?:quotas|reservations|login_codes|sessions)\s*\()/i.test(statement) || /\b(?:DROP|ALTER|DELETE|UPDATE|INSERT|TRUNCATE|GRANT|REVOKE)\b/i.test(statement)) fail('NON_ADDITIVE_MIGRATION');
  }
  return sql;
}
async function snapshot(client) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
  const data = {}, rows = {}, structure = {};
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) AS digest FROM public.${quote(table)} t`);
    data[table] = result.rows[0];
    if (!voiceTables.includes(table)) continue;
    rows[table] = (await client.query(`SELECT to_jsonb(t) AS value FROM public.${quote(table)} t ORDER BY to_jsonb(t)::text`)).rows.map(row => row.value);
    const columns = (await client.query("SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required, pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", ['public.' + quote(table)])).rows;
    const constraints = (await client.query('SELECT conname AS name, pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname', ['public.' + quote(table)])).rows;
    const indexes = (await client.query("SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname", [table])).rows;
    structure[table] = { columns, constraints, indexes };
  }
  return { tables, data, rows, structure };
}
function unchanged(before, after) {
  for (const table of before.tables) if (digest(before.data[table]) !== digest(after.data[table])) fail('EXISTING_DATA_CHANGED');
}

export async function productionManifest(productionUrl) {
  const client = new pg.Client(databaseConnection(productionUrl));
  try {
    await client.connect();
    await client.query("SET default_transaction_read_only=on; SET search_path=public; SET TIME ZONE 'UTC'");
    const source = await snapshot(client);
    if (voiceTables.some(table => !source.tables.includes(table))) fail('PRODUCTION_VOICE_TABLE_MISSING');
    return { migrationSha256: createHash('sha256').update(await migrationSql()).digest('hex'), structureDigests: Object.fromEntries(voiceTables.map(table => [table, digest(source.structure[table])])) };
  } finally { await client.end(); }
}

export async function syncDevelopmentVoiceSchema({ developmentUrl, manifest, apply = false, backupFile }) {
  const sql = await migrationSql();
  if (manifest?.migrationSha256 !== createHash('sha256').update(sql).digest('hex') || voiceTables.some(table => !/^[a-f0-9]{64}$/.test(manifest?.structureDigests?.[table] ?? ''))) fail('INVALID_PRODUCTION_MANIFEST');
  const client = new pg.Client(databaseConnection(developmentUrl));
  let transaction = false;
  try {
    await client.connect();
    await client.query("SET search_path=public; SET TIME ZONE 'UTC'");
    const before = await snapshot(client);
    for (const table of voiceTables.filter(table => before.tables.includes(table))) if (digest(before.structure[table]) !== manifest.structureDigests[table]) fail('EXISTING_VOICE_SCHEMA_MISMATCH');
    const missingTables = voiceTables.filter(table => !before.tables.includes(table));
    const report = { observedAt: new Date().toISOString(), mode: apply ? 'development-apply' : 'development-plan', missingTables, migrationSha256: manifest.migrationSha256, developmentDataBefore: before.data, applied: false };
    if (!apply || !missingTables.length) return report;
    if (!backupFile) fail('BACKUP_FILE_REQUIRED');
    await writeFile(backupFile, JSON.stringify({ capturedAt: report.observedAt, developmentVoiceRows: before.rows, developmentData: before.data, developmentStructure: before.structure }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await client.query('BEGIN'); transaction = true;
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query(sql);
    const after = await snapshot(client); unchanged(before, after);
    for (const table of voiceTables) if (digest(after.structure[table]) !== manifest.structureDigests[table]) fail('RESULTING_SCHEMA_MISMATCH');
    await client.query('COMMIT'); transaction = false;
    return { ...report, applied: true, backupCreated: true, developmentDataAfter: after.data, existingDevelopmentDataUnchanged: true };
  } finally {
    let rollbackFailed = false;
    if (transaction) await client.query('ROLLBACK').catch(() => { rollbackFailed = true; });
    await client.end();
    if (rollbackFailed) fail('DEVELOPMENT_ROLLBACK_FAILED');
  }
}

export async function syncVoiceSchema({ developmentUrl, productionUrl, apply = false, backupFile }) {
  if (location(developmentUrl) === location(productionUrl)) fail('SAME_DATABASE_FORBIDDEN');
  const sql = await migrationSql();
  const development = new pg.Client(databaseConnection(developmentUrl));
  const production = new pg.Client(databaseConnection(productionUrl));
  let transaction = false;
  try {
    await production.connect();
    await production.query("SET default_transaction_read_only=on; SET search_path=public; SET TIME ZONE 'UTC'");
    await development.connect();
    await development.query("SET search_path=public; SET TIME ZONE 'UTC'");
    const identitySql = "SELECT current_database() AS database, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid, pg_postmaster_start_time()::text AS server_started_at";
    const productionIdentity = (await production.query(identitySql)).rows[0];
    const developmentIdentity = (await development.query(identitySql)).rows[0];
    if (digest(productionIdentity) === digest(developmentIdentity)) fail('SAME_DATABASE_FORBIDDEN');
    const source = await snapshot(production), before = await snapshot(development);
    if (voiceTables.some(table => !source.tables.includes(table))) fail('PRODUCTION_VOICE_TABLE_MISSING');
    for (const table of voiceTables.filter(table => before.tables.includes(table))) {
      if (digest(source.structure[table]) !== digest(before.structure[table])) fail('EXISTING_VOICE_SCHEMA_MISMATCH');
    }
    const missingTables = voiceTables.filter(table => !before.tables.includes(table));
    const report = { observedAt: new Date().toISOString(), mode: apply ? 'apply' : 'plan', missingTables, migrationSha256: createHash('sha256').update(sql).digest('hex'), productionData: source.data, developmentDataBefore: before.data, productionReadOnly: true, applied: false };
    if (!apply || !missingTables.length) return report;
    if (!backupFile) fail('BACKUP_FILE_REQUIRED');
    await writeFile(backupFile, JSON.stringify({ capturedAt: report.observedAt, productionVoiceRows: source.rows, developmentVoiceRows: before.rows, productionData: source.data, developmentData: before.data, productionStructure: source.structure }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    report.backupCreated = true;
    await development.query('BEGIN'); transaction = true;
    await development.query("SET LOCAL lock_timeout='5s'");
    await development.query(sql);
    const after = await snapshot(development);
    unchanged(before, after);
    for (const table of voiceTables) if (digest(source.structure[table]) !== digest(after.structure[table])) fail('RESULTING_SCHEMA_MISMATCH');
    const sourceAfter = await snapshot(production); unchanged(source, sourceAfter);
    await development.query('COMMIT'); transaction = false;
    report.applied = true; report.developmentDataAfter = after.data; report.productionDataUnchanged = true; report.existingDevelopmentDataUnchanged = true;
    return report;
  } finally {
    let rollbackFailed = false;
    if (transaction) await development.query('ROLLBACK').catch(() => { rollbackFailed = true; });
    await Promise.allSettled([development.end(), production.end()]);
    if (rollbackFailed) fail('DEVELOPMENT_ROLLBACK_FAILED');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [file, mode, backupFile] = process.argv.slice(2);
    if (!file || !['plan', 'apply', 'production-manifest', 'development-plan', 'development-apply'].includes(mode)) fail('USAGE_CONNECTION_FILE_PLAN_OR_APPLY');
    if ((await stat(file)).mode & 0o077) fail('CONNECTION_FILE_MUST_BE_PRIVATE');
    const input = JSON.parse(await readFile(file, 'utf8'));
    const result = mode === 'production-manifest'
      ? await productionManifest(input.productionDatabaseUrl)
      : mode.startsWith('development-')
        ? await syncDevelopmentVoiceSchema({ developmentUrl: process.env.DATABASE_URL, manifest: input, apply: mode === 'development-apply', backupFile })
        : await syncVoiceSchema({ developmentUrl: input.developmentDatabaseUrl, productionUrl: input.productionDatabaseUrl, apply: mode === 'apply', backupFile });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    const code = typeof error.code === 'string' && /^[A-Z_]{4,80}$/.test(error.code) ? error.code : 'DATABASE_OPERATION_FAILED';
    process.stderr.write(JSON.stringify({ error: code }) + '\n'); process.exitCode = 1;
  }
}
