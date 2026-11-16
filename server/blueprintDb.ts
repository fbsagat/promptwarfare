import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  EventArchetype,
  MapEventState,
  WeaponBlueprint,
} from '../src/shared/types.ts';

export type BlueprintSource = 'ai' | 'procedural' | 'seed';

export type StoredEventPayload = Pick<
  MapEventState,
  'archetype' | 'params' | 'entityBlueprint' | 'budgetUsed' | 'wasClamped'
>;

export interface CatalogWeaponSummary {
  prompt: string;
  name: string;
  budgetUsed: number;
  source: BlueprintSource;
  hitCount: number;
  primaryColor: string;
  damage: number;
  projectiles: number;
}

export interface CatalogEventSummary {
  prompt: string;
  archetype: EventArchetype;
  budgetUsed: number;
  source: BlueprintSource;
  hitCount: number;
}

export interface BlueprintCatalogResponse {
  weapons: CatalogWeaponSummary[];
  events: CatalogEventSummary[];
  stats: {
    totalWeapons: number;
    totalEvents: number;
    totalReuses: number;
  };
}

const STOP_WORDS = new Set([
  'a',
  'as',
  'o',
  'os',
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'com',
  'sem',
  'para',
  'por',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'que',
  'e',
  'the',
  'an',
  'of',
  'with',
  'for',
]);

export function normalizePrompt(prompt: string): string {
  return prompt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildCanonicalKey(prompt: string): string {
  const norm = normalizePrompt(prompt);
  if (!norm) return '';
  const tokens = Array.from(
    new Set(
      norm
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t)),
    ),
  ).sort();
  return tokens.length > 0 ? tokens.join('|') : norm;
}

interface WeaponRow {
  id: number;
  normalized_prompt: string;
  canonical_key: string;
  prompt: string;
  name: string;
  source: BlueprintSource;
  budget_used: number;
  payload_json: string;
  hit_count: number;
  created_at: number;
  last_used_at: number;
}

interface EventRow {
  id: number;
  normalized_prompt: string;
  canonical_key: string;
  prompt: string;
  archetype: EventArchetype;
  source: BlueprintSource;
  budget_used: number;
  payload_json: string;
  hit_count: number;
  created_at: number;
  last_used_at: number;
}

export class BlueprintDatabase {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const resolved =
      dbPath ??
      process.env.VOXELFORGE_DB_PATH ??
      path.resolve(process.cwd(), 'data', 'voxelforge-blueprints.db');

    if (resolved !== ':memory:') {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
    }

    this.db = new DatabaseSync(resolved);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS weapon_blueprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        normalized_prompt TEXT NOT NULL UNIQUE,
        canonical_key TEXT NOT NULL,
        prompt TEXT NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        budget_used REAL NOT NULL,
        payload_json TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_weapon_canonical ON weapon_blueprints(canonical_key);
      CREATE INDEX IF NOT EXISTS idx_weapon_hits ON weapon_blueprints(hit_count DESC, last_used_at DESC);

      CREATE TABLE IF NOT EXISTS event_blueprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        normalized_prompt TEXT NOT NULL UNIQUE,
        canonical_key TEXT NOT NULL,
        prompt TEXT NOT NULL,
        archetype TEXT NOT NULL,
        source TEXT NOT NULL,
        budget_used REAL NOT NULL,
        payload_json TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_event_canonical ON event_blueprints(canonical_key);
      CREATE INDEX IF NOT EXISTS idx_event_hits ON event_blueprints(hit_count DESC, last_used_at DESC);

      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const verRow = this.db
      .prepare("SELECT value FROM schema_meta WHERE key = 'balance_version'")
      .get() as { value: string } | undefined;
    if (verRow?.value !== '3') {
      this.db.exec("DELETE FROM weapon_blueprints WHERE source = 'procedural';");
      this.db.exec("DELETE FROM event_blueprints WHERE source = 'procedural';");
      this.db
        .prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('balance_version', '3')")
        .run();
    }
  }

  private buildWeaponLookupKeys(prompt: string, allocationKey?: string) {
    const baseNorm = normalizePrompt(prompt);
    if (!baseNorm) return { norm: '', canonical: '' };
    const baseCanonical = buildCanonicalKey(prompt);
    if (!allocationKey) {
      return { norm: baseNorm, canonical: baseCanonical };
    }
    return {
      norm: `${baseNorm}#${allocationKey}`,
      canonical: `${baseCanonical}#${allocationKey}`,
    };
  }

  findWeapon(
    prompt: string,
    allocationKey?: string,
  ): {
    blueprint: WeaponBlueprint;
    source: BlueprintSource;
    hitCount: number;
  } | null {
    const { norm, canonical } = this.buildWeaponLookupKeys(prompt, allocationKey);
    if (!norm) return null;

    let row = this.db
      .prepare(
        `SELECT * FROM weapon_blueprints
         WHERE normalized_prompt = ?
         ORDER BY CASE WHEN source = 'ai' THEN 0 ELSE 1 END, hit_count DESC
         LIMIT 1`,
      )
      .get(norm) as WeaponRow | undefined;

    if (!row && canonical) {
      row = this.db
        .prepare(
          `SELECT * FROM weapon_blueprints
           WHERE canonical_key = ?
           ORDER BY CASE WHEN source = 'ai' THEN 0 ELSE 1 END, hit_count DESC
           LIMIT 1`,
        )
        .get(canonical) as WeaponRow | undefined;
    }

    if (!row) return null;

    const now = Date.now();
    this.db
      .prepare('UPDATE weapon_blueprints SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?')
      .run(now, row.id);

    const parsed = JSON.parse(row.payload_json) as WeaponBlueprint;
    return {
      blueprint: parsed,
      source: row.source,
      hitCount: row.hit_count + 1,
    };
  }

  saveWeapon(
    prompt: string,
    blueprint: WeaponBlueprint,
    source: BlueprintSource,
    allocationKey?: string,
  ): void {
    const { norm, canonical } = this.buildWeaponLookupKeys(prompt, allocationKey);
    if (!norm) return;
    const now = Date.now();
    const cleanPayload: WeaponBlueprint = {
      ...blueprint,
      fromDatabase: undefined,
    };
    const json = JSON.stringify(cleanPayload);

    const existing = this.db
      .prepare('SELECT id, source FROM weapon_blueprints WHERE normalized_prompt = ?')
      .get(norm) as { id: number; source: BlueprintSource } | undefined;

    if (existing) {
      // Never overwrite an authentic AI-crafted item with a procedural fallback
      if (existing.source === 'ai' && source !== 'ai') {
        this.db
          .prepare('UPDATE weapon_blueprints SET last_used_at = ? WHERE id = ?')
          .run(now, existing.id);
        return;
      }
      this.db
        .prepare(
          `UPDATE weapon_blueprints
           SET canonical_key = ?, prompt = ?, name = ?, source = ?, budget_used = ?, payload_json = ?, last_used_at = ?
           WHERE id = ?`,
        )
        .run(
          canonical,
          prompt.trim().slice(0, 90),
          blueprint.name,
          source,
          blueprint.budgetUsed,
          json,
          now,
          existing.id,
        );
      return;
    }

    this.db
      .prepare(
        `INSERT INTO weapon_blueprints
         (normalized_prompt, canonical_key, prompt, name, source, budget_used, payload_json, hit_count, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        norm,
        canonical,
        prompt.trim().slice(0, 90),
        blueprint.name,
        source,
        blueprint.budgetUsed,
        json,
        now,
        now,
      );
  }

  findEvent(prompt: string): {
    payload: StoredEventPayload;
    source: BlueprintSource;
    hitCount: number;
  } | null {
    const norm = normalizePrompt(prompt);
    if (!norm) return null;
    const canonical = buildCanonicalKey(prompt);

    let row = this.db
      .prepare(
        `SELECT * FROM event_blueprints
         WHERE normalized_prompt = ?
         ORDER BY CASE WHEN source = 'ai' THEN 0 ELSE 1 END, hit_count DESC
         LIMIT 1`,
      )
      .get(norm) as EventRow | undefined;

    if (!row && canonical) {
      row = this.db
        .prepare(
          `SELECT * FROM event_blueprints
           WHERE canonical_key = ?
           ORDER BY CASE WHEN source = 'ai' THEN 0 ELSE 1 END, hit_count DESC
           LIMIT 1`,
        )
        .get(canonical) as EventRow | undefined;
    }

    if (!row) return null;

    const now = Date.now();
    this.db
      .prepare('UPDATE event_blueprints SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?')
      .run(now, row.id);

    const parsed = JSON.parse(row.payload_json) as StoredEventPayload;
    return {
      payload: parsed,
      source: row.source,
      hitCount: row.hit_count + 1,
    };
  }

  saveEvent(prompt: string, payload: StoredEventPayload, source: BlueprintSource): void {
    const norm = normalizePrompt(prompt);
    if (!norm) return;
    const canonical = buildCanonicalKey(prompt);
    const now = Date.now();
    const json = JSON.stringify(payload);

    const existing = this.db
      .prepare('SELECT id, source FROM event_blueprints WHERE normalized_prompt = ?')
      .get(norm) as { id: number; source: BlueprintSource } | undefined;

    if (existing) {
      if (existing.source === 'ai' && source !== 'ai') {
        this.db
          .prepare('UPDATE event_blueprints SET last_used_at = ? WHERE id = ?')
          .run(now, existing.id);
        return;
      }
      this.db
        .prepare(
          `UPDATE event_blueprints
           SET canonical_key = ?, prompt = ?, archetype = ?, source = ?, budget_used = ?, payload_json = ?, last_used_at = ?
           WHERE id = ?`,
        )
        .run(
          canonical,
          prompt.trim().slice(0, 90),
          payload.archetype,
          source,
          payload.budgetUsed,
          json,
          now,
          existing.id,
        );
      return;
    }

    this.db
      .prepare(
        `INSERT INTO event_blueprints
         (normalized_prompt, canonical_key, prompt, archetype, source, budget_used, payload_json, hit_count, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        norm,
        canonical,
        prompt.trim().slice(0, 90),
        payload.archetype,
        source,
        payload.budgetUsed,
        json,
        now,
        now,
      );
  }

  getCatalog(limit = 10): BlueprintCatalogResponse {
    const weaponRows = this.db
      .prepare(
        `SELECT * FROM weapon_blueprints
         ORDER BY CASE WHEN source = 'ai' THEN 0 ELSE 1 END, hit_count DESC, last_used_at DESC
         LIMIT ?`,
      )
      .all(limit) as unknown as WeaponRow[];

    const eventRows = this.db
      .prepare(
        `SELECT * FROM event_blueprints
         ORDER BY CASE WHEN source = 'ai' THEN 0 ELSE 1 END, hit_count DESC, last_used_at DESC
         LIMIT ?`,
      )
      .all(limit) as unknown as EventRow[];

    const weaponAgg = this.db
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(MAX(0, hit_count - 1)), 0) AS reuses FROM weapon_blueprints')
      .get() as { cnt: number; reuses: number };
    const eventAgg = this.db
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(MAX(0, hit_count - 1)), 0) AS reuses FROM event_blueprints')
      .get() as { cnt: number; reuses: number };

    const weapons: CatalogWeaponSummary[] = weaponRows.map((row) => {
      const parsed = JSON.parse(row.payload_json) as WeaponBlueprint;
      return {
        prompt: row.prompt,
        name: row.name,
        budgetUsed: row.budget_used,
        source: row.source,
        hitCount: row.hit_count,
        primaryColor: parsed.palette[0]?.hex || '#38bdf8',
        damage: parsed.stats.damage,
        projectiles: parsed.stats.projectiles,
      };
    });

    const events: CatalogEventSummary[] = eventRows.map((row) => ({
      prompt: row.prompt,
      archetype: row.archetype,
      budgetUsed: row.budget_used,
      source: row.source,
      hitCount: row.hit_count,
    }));

    return {
      weapons,
      events,
      stats: {
        totalWeapons: weaponAgg.cnt,
        totalEvents: eventAgg.cnt,
        totalReuses: (weaponAgg.reuses ?? 0) + (eventAgg.reuses ?? 0),
      },
    };
  }

  close(): void {
    this.db.close();
  }
}

let sharedDb: BlueprintDatabase | null = null;

export function getBlueprintDb(): BlueprintDatabase {
  if (!sharedDb) {
    sharedDb = new BlueprintDatabase();
  }
  return sharedDb;
}
