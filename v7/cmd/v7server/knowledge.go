package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// KnowledgeStore manages the per-user knowledge database (knowledge.db).
// It stores structured knowledge entries, entities, and relations with
// FTS5 full-text search support.
type KnowledgeStore struct {
	db *sql.DB
}

const knowledgeSchema = `
CREATE TABLE IF NOT EXISTS entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT NOT NULL DEFAULT 'note',
    content    TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'agent',
    tags       TEXT DEFAULT '',
    embedding  BLOB,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    content,
    tags,
    content='entries',
    content_rowid='id',
    tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS entities (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,
    properties TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_type ON entities(name, type);

CREATE TABLE IF NOT EXISTS relations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     INTEGER NOT NULL REFERENCES entities(id),
    to_id       INTEGER NOT NULL REFERENCES entities(id),
    type        TEXT NOT NULL,
    properties  TEXT DEFAULT '{}',
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique ON relations(from_id, to_id, type);
`

// NewKnowledgeStore opens or creates the knowledge.db for a user workspace.
func NewKnowledgeStore(workspace string) (*KnowledgeStore, error) {
	dbPath := filepath.Join(workspace, "knowledge.db")
	isNew := false
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		isNew = true
	}

	db, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)")
	if err != nil {
		return nil, fmt.Errorf("knowledge: open: %w", err)
	}
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(knowledgeSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("knowledge: init schema: %w", err)
	}

	ks := &KnowledgeStore{db: db}
	if isNew {
		ks.seedFromMemory(workspace)
	}
	return ks, nil
}

// seedFromMemory imports existing MEMORY.md entries into the knowledge base.
func (ks *KnowledgeStore) seedFromMemory(workspace string) {
	memPath := filepath.Join(workspace, "memory", "MEMORY.md")
	data, err := os.ReadFile(memPath)
	if err != nil {
		return // no MEMORY.md, nothing to seed
	}
	content := string(data)
	if len(content) < 10 {
		return
	}
	now := time.Now().Unix()
	ks.db.Exec(`INSERT INTO entries (category, content, source, tags, created_at, updated_at) VALUES (?, ?, 'import', 'memory', ?, ?)`,
		"note", content, now, now)
}

// --- Entry CRUD ---

type Entry struct {
	ID        int64  `json:"id"`
	Category  string `json:"category"`
	Content   string `json:"content"`
	Source    string `json:"source"`
	Tags      string `json:"tags"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

func (ks *KnowledgeStore) AddEntry(category, content, source, tags string) (int64, error) {
	now := time.Now().Unix()
	res, err := ks.db.Exec(
		`INSERT INTO entries (category, content, source, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		category, content, source, tags, now, now,
	)
	if err != nil {
		return 0, fmt.Errorf("knowledge: add entry: %w", err)
	}
	return res.LastInsertId()
}

func (ks *KnowledgeStore) UpdateEntry(id int64, category, content, tags string) error {
	now := time.Now().Unix()
	_, err := ks.db.Exec(
		`UPDATE entries SET category=?, content=?, tags=?, updated_at=? WHERE id=?`,
		category, content, tags, now, id,
	)
	return err
}

func (ks *KnowledgeStore) DeleteEntry(id int64) error {
	_, err := ks.db.Exec(`DELETE FROM entries WHERE id=?`, id)
	return err
}

func (ks *KnowledgeStore) SearchEntries(query string, limit int) ([]Entry, error) {
	if limit <= 0 {
		limit = 10
	}
	// Rebuild FTS index.
	ks.db.Exec(`INSERT INTO entries_fts(entries_fts) VALUES('rebuild')`)

	rows, err := ks.db.Query(`
		SELECT e.id, e.category, e.content, e.source, e.tags, e.created_at, e.updated_at
		FROM entries e
		INNER JOIN entries_fts f ON e.id = f.rowid
		WHERE entries_fts MATCH ?
		ORDER BY rank
		LIMIT ?
	`, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.Category, &e.Content, &e.Source, &e.Tags, &e.CreatedAt, &e.UpdatedAt); err != nil {
			continue
		}
		results = append(results, e)
	}
	return results, nil
}

func (ks *KnowledgeStore) ListEntries(category string, limit int) ([]Entry, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows *sql.Rows
	var err error
	if category != "" {
		rows, err = ks.db.Query(`SELECT id, category, content, source, tags, created_at, updated_at FROM entries WHERE category=? ORDER BY updated_at DESC LIMIT ?`, category, limit)
	} else {
		rows, err = ks.db.Query(`SELECT id, category, content, source, tags, created_at, updated_at FROM entries ORDER BY updated_at DESC LIMIT ?`, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.Category, &e.Content, &e.Source, &e.Tags, &e.CreatedAt, &e.UpdatedAt); err != nil {
			continue
		}
		results = append(results, e)
	}
	return results, nil
}

// --- Entity CRUD ---

type Entity struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Properties string `json:"properties"`
	CreatedAt  int64  `json:"created_at"`
}

func (ks *KnowledgeStore) UpsertEntity(name, entityType, properties string) (int64, error) {
	now := time.Now().Unix()
	var id int64
	err := ks.db.QueryRow(`
		INSERT INTO entities (name, type, properties, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(name, type) DO UPDATE SET properties=excluded.properties
		RETURNING id
	`, name, entityType, properties, now).Scan(&id)
	return id, err
}

func (ks *KnowledgeStore) FindEntity(name, entityType string) (*Entity, error) {
	var e Entity
	err := ks.db.QueryRow(`SELECT id, name, type, properties, created_at FROM entities WHERE name=? AND type=?`, name, entityType).
		Scan(&e.ID, &e.Name, &e.Type, &e.Properties, &e.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (ks *KnowledgeStore) ListEntities(entityType string) ([]Entity, error) {
	var rows *sql.Rows
	var err error
	if entityType != "" {
		rows, err = ks.db.Query(`SELECT id, name, type, properties, created_at FROM entities WHERE type=? ORDER BY name`, entityType)
	} else {
		rows, err = ks.db.Query(`SELECT id, name, type, properties, created_at FROM entities ORDER BY type, name`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Entity
	for rows.Next() {
		var e Entity
		if err := rows.Scan(&e.ID, &e.Name, &e.Type, &e.Properties, &e.CreatedAt); err != nil {
			continue
		}
		results = append(results, e)
	}
	return results, nil
}

// --- Relation CRUD ---

type Relation struct {
	ID         int64  `json:"id"`
	FromID     int64  `json:"from_id"`
	ToID       int64  `json:"to_id"`
	Type       string `json:"type"`
	Properties string `json:"properties"`
	CreatedAt  int64  `json:"created_at"`
}

func (ks *KnowledgeStore) AddRelation(fromID, toID int64, relType, properties string) (int64, error) {
	now := time.Now().Unix()
	res, err := ks.db.Exec(
		`INSERT INTO relations (from_id, to_id, type, properties, created_at) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(from_id, to_id, type) DO UPDATE SET properties=excluded.properties`,
		fromID, toID, relType, properties, now,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (ks *KnowledgeStore) GetRelations(entityID int64) ([]Relation, error) {
	rows, err := ks.db.Query(`
		SELECT id, from_id, to_id, type, properties, created_at
		FROM relations WHERE from_id=? OR to_id=?
		ORDER BY created_at DESC
	`, entityID, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Relation
	for rows.Next() {
		var r Relation
		if err := rows.Scan(&r.ID, &r.FromID, &r.ToID, &r.Type, &r.Properties, &r.CreatedAt); err != nil {
			continue
		}
		results = append(results, r)
	}
	return results, nil
}

func (ks *KnowledgeStore) Close() error {
	if ks.db != nil {
		return ks.db.Close()
	}
	return nil
}

// --- Semantic Search (Embedding-based) ---

// SetEntryEmbedding stores a pre-computed embedding for an entry.
func (ks *KnowledgeStore) SetEntryEmbedding(id int64, embedding []byte) error {
	_, err := ks.db.Exec(`UPDATE entries SET embedding=? WHERE id=?`, embedding, id)
	return err
}

// GetEntryEmbeddings returns all entries with their embeddings for semantic search.
func (ks *KnowledgeStore) GetEntryEmbeddings() ([]Entry, [][]float32, error) {
	rows, err := ks.db.Query(`SELECT id, category, content, source, tags, created_at, updated_at, embedding FROM entries WHERE embedding IS NOT NULL`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var entries []Entry
	var embeddings [][]float32
	for rows.Next() {
		var e Entry
		var emb []byte
		if err := rows.Scan(&e.ID, &e.Category, &e.Content, &e.Source, &e.Tags, &e.CreatedAt, &e.UpdatedAt, &emb); err != nil {
			continue
		}
		entries = append(entries, e)
		embeddings = append(embeddings, BytesToFloat32Slice(emb))
	}
	return entries, embeddings, nil
}

// SemanticSearch finds the most similar entries to the query embedding.
func (ks *KnowledgeStore) SemanticSearch(queryEmb []float32, topK int) ([]Entry, []float64, error) {
	entries, embList, err := ks.GetEntryEmbeddings()
	if err != nil {
		return nil, nil, err
	}
	if len(entries) == 0 {
		return nil, nil, nil
	}

	type scored struct {
		idx   int
		score float64
	}
	results := make([]scored, len(entries))
	for i, emb := range embList {
		results[i] = scored{idx: i, score: CosineSimilarity(queryEmb, emb)}
	}

	// Partial sort for top-K.
	if topK > len(results) {
		topK = len(results)
	}
	for i := 0; i < topK; i++ {
		maxIdx := i
		for j := i + 1; j < len(results); j++ {
			if results[j].score > results[maxIdx].score {
				maxIdx = j
			}
		}
		results[i], results[maxIdx] = results[maxIdx], results[i]
	}

	var outEntries []Entry
	var outScores []float64
	for i := 0; i < topK; i++ {
		if results[i].score < 0.1 { // threshold
			break
		}
		outEntries = append(outEntries, entries[results[i].idx])
		outScores = append(outScores, results[i].score)
	}
	return outEntries, outScores, nil
}

// GetAllEntries returns all entries (for bulk operations like embedding rebuild).
func (ks *KnowledgeStore) GetAllEntries() ([]Entry, error) {
	return ks.ListEntries("", 10000)
}
