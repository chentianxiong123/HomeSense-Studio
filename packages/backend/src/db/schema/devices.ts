import type Database from 'better-sqlite3'

/**
 * Schema module: devices
 * User devices, device capabilities, capability aliases, stopwords. App map and OpenCV are future tables owned here.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy devices into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS app_map_elements (
      id INTEGER NOT NULL,
      screen_id INTEGER NOT NULL REFERENCES app_map_screens(id) ON DELETE CASCADE,
      element_name TEXT NOT NULL,
      element_type TEXT NOT NULL DEFAULT 'button',
      bounds_json TEXT NOT NULL DEFAULT '{}',
      template_path TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 1.0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'vision' CHECK (source IN ('vision','ui_tree','manual')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS app_map_screens (
      id INTEGER NOT NULL,
      package_name TEXT NOT NULL,
      screen_id TEXT NOT NULL DEFAULT '',
      activity TEXT NOT NULL DEFAULT '',
      screenshot_path TEXT NOT NULL DEFAULT '',
      resolution TEXT NOT NULL DEFAULT '',
      embedding_json TEXT NOT NULL DEFAULT '[]',
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT),
      UNIQUE (package_name, screen_id)
    )`,
  `CREATE TABLE IF NOT EXISTS capability_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_type TEXT NOT NULL DEFAULT '',
  device_id INTEGER NULL,
  capability TEXT NOT NULL,
  ir_key TEXT NOT NULL DEFAULT '',
  alias TEXT NOT NULL,
  is_custom INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
)`,
  `CREATE TABLE IF NOT EXISTS device_apps (
      adb_ip TEXT NOT NULL,
      apps_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (adb_ip)
    )`,
  `CREATE TABLE IF NOT EXISTS device_capabilities (
      mi_did TEXT NOT NULL,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      ir_keys_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (mi_did)
    )`,
  `CREATE TABLE IF NOT EXISTS opencv_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_name TEXT NOT NULL,
      element_name TEXT NOT NULL,
      template_hash TEXT NOT NULL UNIQUE,
      template_path TEXT NOT NULL,
      bounds_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.8,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_matched_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  `CREATE TABLE IF NOT EXISTS stopwords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL UNIQUE,
      is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0,1))
    )`,
  `CREATE TABLE IF NOT EXISTS user_devices (
      id INTEGER NOT NULL, name TEXT NOT NULL,
      device_type TEXT NOT NULL CHECK (device_type IN ('television','stb','speaker','router','outlet','phone','tv_box','tablet','computer','other')) DEFAULT 'other',
      room_id INTEGER NULL REFERENCES rooms(id) ON DELETE SET NULL,
      mi_did TEXT NULL,
      adb_ip TEXT NOT NULL DEFAULT '', ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
]

export const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_app_map_elements_screen ON app_map_elements(screen_id)`,
  `CREATE INDEX IF NOT EXISTS idx_app_map_screens_package ON app_map_screens(package_name)`,
  `CREATE INDEX IF NOT EXISTS idx_aliases_alias ON capability_aliases(alias)`,
  `CREATE INDEX IF NOT EXISTS idx_aliases_device ON capability_aliases(device_id)`,
  `CREATE INDEX IF NOT EXISTS idx_opencv_templates_element ON opencv_templates(element_name)`,
  `CREATE INDEX IF NOT EXISTS idx_opencv_templates_package ON opencv_templates(package_name)`,
  `CREATE INDEX IF NOT EXISTS idx_stopwords_word ON stopwords(word)`,
  `CREATE INDEX IF NOT EXISTS idx_user_devices_mi_did ON user_devices(mi_did)`,
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for devices.
}
