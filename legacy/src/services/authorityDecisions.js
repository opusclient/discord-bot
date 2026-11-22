import { createHash } from 'node:crypto';

const normalizeIds = values => [...new Set((values ?? []).map(String))].sort();
const encode = value => JSON.stringify(value);
const validLevel = level => level === 2 || level === 3;

export function planRoleRestoration(incident, currentRoles, { conflictRoleIds = [] } = {}) {
  const original = new Set(incident.beforeRoles);
  const observed = new Set(incident.afterRoles);
  const current = new Set(normalizeIds(currentRoles));
  const conflicts = new Set(conflictRoleIds);
  const changedIds = [...new Set([...original, ...observed])]
    .filter(id => original.has(id) !== observed.has(id));
  for (const id of changedIds) {
    if (conflicts.has(id)) throw new Error('Later authorized changes conflict with restoration: ' + id);
    if (current.has(id) !== observed.has(id)) throw new Error('Observed role drift conflicts with restoration: ' + id);
  }
  for (const id of changedIds) {
    if (original.has(id)) current.add(id);
    else current.delete(id);
  }
  return normalizeIds([...current]);
}

export class AuthorityDecisionStore {
  constructor(database) {
    this.db = database;
    this.active = new Set();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS authority_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        incident_key TEXT NOT NULL,
        level INTEGER NOT NULL,
        status TEXT NOT NULL,
        executor_id TEXT,
        target_id TEXT,
        beneficiary_id TEXT,
        before_roles TEXT NOT NULL,
        after_roles TEXT NOT NULL,
        context_json TEXT NOT NULL,
        decision_actor_id TEXT,
        decision_at INTEGER,
        restoration_actor_id TEXT,
        restoration_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (guild_id, incident_key)
      );
      CREATE INDEX IF NOT EXISTS idx_authority_incidents_status ON authority_incidents (guild_id, status);
      CREATE TABLE IF NOT EXISTS authority_decision_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        incident_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_id TEXT,
        payload_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_authority_journal_guild ON authority_decision_journal (guild_id, id);
    `);
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM authority_incidents WHERE id = ?').get(id);
    return row ? this.decode(row) : null;
  }

  decode(row) {
    return {
      ...row,
      beforeRoles: JSON.parse(row.before_roles),
      afterRoles: JSON.parse(row.after_roles),
      context: JSON.parse(row.context_json)
    };
  }

  journal(guildId, incidentId) {
    return this.db.prepare('SELECT * FROM authority_decision_journal WHERE guild_id = ? AND incident_id = ? ORDER BY id').all(guildId, incidentId)
      .map(row => ({ ...row, payload: JSON.parse(row.payload_json) }));
  }

  appendJournal(guildId, incidentId, eventType, actorId, payload, createdAt = Date.now()) {
    const last = this.db.prepare('SELECT entry_hash FROM authority_decision_journal WHERE guild_id = ? ORDER BY id DESC LIMIT 1').get(guildId);
    const previousHash = last?.entry_hash ?? 'GENESIS';
    const payloadJson = encode(payload);
    const hash = createHash('sha256')
      .update(encode([guildId, incidentId, eventType, actorId, payloadJson, previousHash, createdAt]))
      .digest('hex');
    this.db.prepare('INSERT INTO authority_decision_journal (guild_id,incident_id,event_type,actor_id,payload_json,previous_hash,entry_hash,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(guildId, incidentId, eventType, actorId ?? null, payloadJson, previousHash, hash, createdAt);
    return hash;
  }

  verifyJournal(guildId) {
    const rows = this.db.prepare('SELECT * FROM authority_decision_journal WHERE guild_id = ? ORDER BY id').all(guildId);
    let previousHash = 'GENESIS';
    for (const row of rows) {
      const computed = createHash('sha256')
        .update(encode([row.guild_id, row.incident_id, row.event_type, row.actor_id, row.payload_json, previousHash, row.created_at]))
        .digest('hex');
      if (previousHash !== row.previous_hash || computed !== row.entry_hash) return false;
      previousHash = computed;
    }
    return true;
  }

  open({ guildId, incidentKey, level, executorId = null, targetId = null,
    beneficiaryId = null, beforeRoles = [], afterRoles = [], context = {} }) {
    if (!guildId || !incidentKey || !validLevel(level)) throw new Error('Invalid authority incident');
    const now = Date.now();
    const before = normalizeIds(beforeRoles);
    const after = normalizeIds(afterRoles);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const inserted = this.db.prepare('INSERT OR IGNORE INTO authority_incidents (guild_id,incident_key,level,status,executor_id,target_id,beneficiary_id,before_roles,after_roles,context_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(guildId, incidentKey, level, 'pending', executorId, targetId, beneficiaryId, encode(before), encode(after), encode(context), now, now);
      const row = this.db.prepare('SELECT * FROM authority_incidents WHERE guild_id = ? AND incident_key = ?').get(guildId, incidentKey);
      if (inserted.changes) this.appendJournal(guildId, Number(row.id), 'incident_opened', executorId, { level, before, after, targetId, beneficiaryId, context }, now);
      this.db.exec('COMMIT');
      return this.decode(row);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  updateWithJournal(incident, patch, eventType, actorId, payload = {}) {
    const now = Date.now();
    const names = Object.keys(patch);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('UPDATE authority_incidents SET ' + names.map(name => name + ' = ?').join(', ') +
        ', updated_at = ? WHERE id = ? AND status = ?')
        .run(...names.map(name => patch[name]), now, incident.id, incident.status);
      if (result.changes !== 1) throw new Error('Concurrent incident decision');
      this.appendJournal(incident.guild_id, incident.id, eventType, actorId, payload, now);
      this.db.exec('COMMIT');
      return this.get(incident.id);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async decide({ incidentId, actorId, ownerId, actorIsManager = false, action, restore }) {
    if (!['keep', 'restore'].includes(action)) throw new Error('Invalid authority decision');
    if (this.active.has(incidentId)) throw new Error('Incident is already being processed');
    this.active.add(incidentId);
    try {
      const incident = this.get(incidentId);
      if (!incident) throw new Error('Incident not found');
      const isFounder = actorId === ownerId;
      const involved = [incident.executor_id, incident.target_id, incident.beneficiary_id,
        ...(incident.context.involvedUserIds ?? [])].filter(Boolean).includes(actorId);
      if (!isFounder && (!actorIsManager || involved)) {
        throw new Error(involved ? 'Manager involved in incident cannot review it' : 'Only Founder or unrelated Manager may review');
      }
      if (action === 'keep') {
        if (incident.status !== 'pending') throw new Error('Only pending incidents can be kept');
        return this.updateWithJournal(incident, {
          status: isFounder ? 'kept_founder' : 'kept_manager',
          decision_actor_id: actorId,
          decision_at: Date.now()
        }, isFounder ? 'founder_keep' : 'manager_keep', actorId, { previousStatus: incident.status });
      }
      if (!['pending', 'kept_manager', 'kept_founder', 'restore_failed'].includes(incident.status)) {
        throw new Error('Incident cannot be restored in this state');
      }
      if (!isFounder && incident.status !== 'pending') {
        throw new Error('Only Founder may override an earlier decision');
      }
      if (typeof restore !== 'function') throw new Error('Restoration callback is required');
      const override = incident.status === 'kept_manager' && isFounder;
      const waiting = this.updateWithJournal(incident, {
        status: 'restore_pending',
        restoration_actor_id: actorId,
        last_error: null
      }, override ? 'founder_veto_requested' : 'restore_requested', actorId, { previousStatus: incident.status });
      try {
        const result = await restore(waiting);
        if (result?.verified !== true) throw new Error('Restoration was not verified');
        return this.updateWithJournal(waiting, {
          status: override ? 'founder_revoked' : 'restored',
          restoration_at: Date.now()
        }, override ? 'founder_veto_applied' : 'restore_verified', actorId, { verified: true });
      } catch (error) {
        this.updateWithJournal(waiting, {
          status: 'restore_failed',
          last_error: String(error.message).slice(0, 500)
        }, 'restore_failed', actorId, { error: String(error.message).slice(0, 500) });
        throw error;
      }
    } finally {
      this.active.delete(incidentId);
    }
  }

  async autoRestore({ incidentId, botId, restore }) {
    if (!botId || typeof restore !== 'function') throw new Error('Automated restoration requires bot identity and callback');
    if (this.active.has(incidentId)) throw new Error('Incident is already being processed');
    this.active.add(incidentId);
    try {
      const incident = this.get(incidentId);
      if (!incident || incident.status !== 'pending') throw new Error('Only pending incidents can be auto-restored');
      const waiting = this.updateWithJournal(incident, {
        status: 'restore_pending',
        restoration_actor_id: botId,
        last_error: null
      }, 'automatic_restore_requested', botId);
      try {
        const result = await restore(waiting);
        if (result?.verified !== true) throw new Error('Restoration was not verified');
        return this.updateWithJournal(waiting, {
          status: 'restored',
          restoration_at: Date.now()
        }, 'automatic_restore_verified', botId, { verified: true });
      } catch (error) {
        this.updateWithJournal(waiting, {
          status: 'restore_failed',
          last_error: String(error.message).slice(0, 500)
        }, 'automatic_restore_failed', botId, { error: String(error.message).slice(0, 500) });
        throw error;
      }
    } finally {
      this.active.delete(incidentId);
    }
  }

  pendingRestores(guildId) {
    return this.db.prepare("SELECT * FROM authority_incidents WHERE guild_id = ? AND status IN ('restore_pending','restore_failed') ORDER BY id").all(guildId)
      .map(row => this.decode(row));
  }
}
