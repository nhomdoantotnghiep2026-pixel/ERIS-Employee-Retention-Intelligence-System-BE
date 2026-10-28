const { isDeepStrictEqual } = require('node:util');
const tables = new Set(['employees', 'departments', 'positions', 'employee_educations', 'employee_work_experiences', 'surveys']);

async function snapshot(client, table, id, lock = false) {
  if (!tables.has(table)) throw new Error('Unsupported audit entity');
  const { rows } = await client.query(`SELECT to_jsonb(entity) AS data FROM ${table} entity WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return rows[0]?.data || null;
}

async function writeAudit(client, { actorId, entityType, entityId = null, action, oldValue = null, newValue = null }) {
  if (!Number.isSafeInteger(Number(actorId)) || Number(actorId) < 1) throw new Error('Audit requires an actor ID');
  await client.query(`INSERT INTO audit_logs (user_id,entity_type,entity_id,action,old_value,new_value)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
  [actorId, entityType, entityId, action, oldValue === null ? null : JSON.stringify(oldValue), newValue === null ? null : JSON.stringify(newValue)]);
}

async function recordChange(client, actorId, table, id, action, before, after) {
  if (!after) return;
  if (action === 'CREATE') return writeAudit(client, { actorId, entityType: table, entityId: id, action, newValue: after });
  const oldValue = {}, newValue = {};
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after)])) {
    if (['created_at', 'updated_at'].includes(key)) continue;
    if (!isDeepStrictEqual(before?.[key], after[key])) {
      oldValue[key] = before?.[key] ?? null; newValue[key] = after[key] ?? null;
    }
  }
  if (Object.keys(newValue).length) {
    // Keep ownership with the changed fields for education/experience records.
    if (after.employee_id !== undefined) { oldValue.employee_id = after.employee_id; newValue.employee_id = after.employee_id; }
    await writeAudit(client, { actorId, entityType: table, entityId: id, action, oldValue, newValue });
  }
}

async function auditMutation(client, { actorId, table, id, action }, work) {
  const before = id == null ? null : await snapshot(client, table, id, true);
  const result = await work();
  if (!result) return result;
  const entityId = id ?? result.id;
  await recordChange(client, actorId, table, entityId, action, before, await snapshot(client, table, entityId));
  return result;
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

// Called only by education/experience methods on the client already opened by their HR transaction.
function auditChildMethods(Repository, specs) {
  for (const [method, spec] of Object.entries(specs)) {
    const original = Repository.prototype[method];
    Repository.prototype[method] = async function (...args) {
      // Initial employee backgrounds are covered by the parent CREATE audit.
      if (this.auditActorId == null) return original.apply(this, args);
      return auditMutation(this.pool, { actorId: this.auditActorId, table: spec.table,
        id: spec.idIndex === undefined ? null : args[spec.idIndex], action: spec.action }, () => original.apply(this, args));
    };
  }
}
module.exports = { snapshot, writeAudit, recordChange, auditMutation, transaction, auditChildMethods };
