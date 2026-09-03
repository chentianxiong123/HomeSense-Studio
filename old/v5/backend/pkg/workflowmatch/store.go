package workflowmatch

import (
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	
	"time"
	"unsafe"

	_ "modernc.org/sqlite"
)

// IntentRecord represents a single entry in the intent cache.
type IntentRecord struct {
	ID          int64
	ChainID     string
	IntentText  string
	Fingerprint string
	Embedding   []float32
	Confidence  float32
	CreatedAt   int64
	UpdatedAt   int64
}

// NegativeRecord is a negative example of an intent card.
type NegativeRecord struct {
	ChainID     string
	Phrase      string
	Fingerprint string
	Embedding   []float32
}

// Snapshot is the in-memory runtime view of all intent cards.
// It is (re)built once by LoadWorkflows so the hot-path matcher
// avoids touching SQLite per query.
type Snapshot struct {
	Records    []IntentRecord
	Negatives  []NegativeRecord
	Confusable map[string][]string // chain_id -> confusable chain ids
}

// Store handles SQLite persistence for intent matching.
type Store struct {
	db  *sql.DB
	snap *Snapshot
}

// StoreConfig holds configuration for the Store.
type StoreConfig struct {
	DatabasePath string
}

// DefaultStoreConfig returns default configuration.
func DefaultStoreConfig(workspaceDir string) *StoreConfig {
	return &StoreConfig{
		DatabasePath: filepath.Join(workspaceDir, "intent_cache.db"),
	}
}

// NewStore creates a new Store instance.
func NewStore(cfg *StoreConfig) (*Store, error) {
	if cfg == nil {
		cfg = DefaultStoreConfig(".")
	}
	db, err := sql.Open("sqlite", cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	store := &Store{db: db}
	if err := store.ensureSchema(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ensure schema: %w", err)
	}
	return store, nil
}

func (s *Store) ensureSchema() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS intent_cache (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			chain_id      TEXT NOT NULL,
			intent_text   TEXT NOT NULL,
			fingerprint   TEXT NOT NULL,
			embedding     BLOB,
			confidence    REAL DEFAULT 0.0,
			created_at    INTEGER NOT NULL,
			updated_at    INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS intent_negative (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			chain_id      TEXT NOT NULL,
			phrase        TEXT NOT NULL,
			fingerprint   TEXT NOT NULL,
			embedding     BLOB,
			created_at    INTEGER NOT NULL
		);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_fingerprint ON intent_cache(fingerprint);
		CREATE INDEX IF NOT EXISTS idx_chain_id ON intent_cache(chain_id);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_negative_fp ON intent_negative(chain_id, fingerprint);
	`)
	return err
}

func encodeFloat32s(data []float32) []byte {
	buf := make([]byte, len(data)*4)
	for i, v := range data {
		bits := *(*uint32)(unsafe.Pointer(&v))
		binary.LittleEndian.PutUint32(buf[i*4:], bits)
	}
	return buf
}

func decodeFloat32s(data []byte) ([]float32, error) {
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("invalid embedding size: %d bytes", len(data))
	}
	result := make([]float32, len(data)/4)
	for i := range result {
		bits := binary.LittleEndian.Uint32(data[i*4:])
		result[i] = *(*float32)(unsafe.Pointer(&bits))
	}
	return result, nil
}

// UpsertIntent inserts or updates an intent record.
func (s *Store) UpsertIntent(record IntentRecord) error {
	now := time.Now().Unix()
	record.UpdatedAt = now
	if record.CreatedAt == 0 {
		record.CreatedAt = now
	}
	embBytes := encodeFloat32s(record.Embedding)
	_, err := s.db.Exec(
		`INSERT INTO intent_cache (chain_id, intent_text, fingerprint, embedding, confidence, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(fingerprint) DO UPDATE SET
			chain_id = excluded.chain_id,
			intent_text = excluded.intent_text,
			embedding = excluded.embedding,
			confidence = excluded.confidence,
			updated_at = excluded.updated_at`,
		record.ChainID, record.IntentText, record.Fingerprint,
		embBytes, record.Confidence, record.CreatedAt, record.UpdatedAt,
	)
	return err
}

// GetByFingerprint looks up a record by fingerprint.
func (s *Store) GetByFingerprint(fingerprint string) (*IntentRecord, error) {
	var id int64
	var chainID, intentText, fp string
	var embBlob []byte
	var confidence, createdAt, updatedAt int64
	err := s.db.QueryRow(
		`SELECT id, chain_id, intent_text, fingerprint, embedding, confidence, created_at, updated_at
		 FROM intent_cache WHERE fingerprint = ?`, fingerprint,
	).Scan(&id, &chainID, &intentText, &fp, &embBlob, &confidence, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	embedding, err := decodeFloat32s(embBlob)
	if err != nil {
		return nil, err
	}
	return &IntentRecord{
		ID: id, ChainID: chainID, IntentText: intentText,
		Fingerprint: fp, Embedding: embedding, Confidence: float32(confidence),
		CreatedAt: createdAt, UpdatedAt: updatedAt,
	}, nil
}

// GetAll returns all intent records.
func (s *Store) GetAll() ([]IntentRecord, error) {
	rows, err := s.db.Query(
		`SELECT id, chain_id, intent_text, fingerprint, embedding, confidence, created_at, updated_at
		 FROM intent_cache ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []IntentRecord
	for rows.Next() {
		var r IntentRecord
		var embBlob []byte
		if err := rows.Scan(&r.ID, &r.ChainID, &r.IntentText, &r.Fingerprint,
			&embBlob, &r.Confidence, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		embedding, err := decodeFloat32s(embBlob)
		if err != nil {
			return nil, err
		}
		r.Embedding = embedding
		records = append(records, r)
	}
	return records, rows.Err()
}

// Count returns the number of records.
func (s *Store) Count() (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM intent_cache`).Scan(&count)
	return count, err
}

// UpsertNegative inserts or replaces a negative example for a chain.
func (s *Store) UpsertNegative(n NegativeRecord) error {
	embBytes := encodeFloat32s(n.Embedding)
	now := time.Now().Unix()
	_, err := s.db.Exec(
		`INSERT INTO intent_negative (chain_id, phrase, fingerprint, embedding, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(chain_id, fingerprint) DO UPDATE SET
			phrase = excluded.phrase,
			embedding = excluded.embedding`,
		n.ChainID, n.Phrase, n.Fingerprint, embBytes, now,
	)
	return err
}

// GetNegatives returns all negative examples, keyed by chain.
func (s *Store) GetNegatives() ([]NegativeRecord, error) {
	rows, err := s.db.Query(
		`SELECT chain_id, phrase, fingerprint, embedding FROM intent_negative ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NegativeRecord
	for rows.Next() {
		var n NegativeRecord
		var embBlob []byte
		if err := rows.Scan(&n.ChainID, &n.Phrase, &n.Fingerprint, &embBlob); err != nil {
			return nil, err
		}
		emb, err := decodeFloat32s(embBlob)
		if err != nil {
			return nil, err
		}
		n.Embedding = emb
		out = append(out, n)
	}
	return out, rows.Err()
}

// Snapshot returns the in-memory runtime snapshot (nil if not loaded).
func (s *Store) Snapshot() *Snapshot {
	return s.snap
}

// LoadWorkflows scans a directory for workflow JSON files and loads them.
func (s *Store) LoadWorkflows(workflowDir string, encodeFn func(text string) ([]float32, error)) error {
	entries, err := os.ReadDir(workflowDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read workflow dir: %w", err)
	}
	snap := &Snapshot{Confusable: map[string][]string{}}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(workflowDir, entry.Name()))
		if err != nil {
			continue
		}
		wf, err := parseWorkflowJSON(data)
		if err != nil {
			continue
		}
		// Each positive intent phrase is its own anchor record.
		phrases := wf.Intents
		if len(phrases) == 0 {
			phrases = []string{wf.RuleChain.Name}
		}
		for _, phrase := range phrases {
			embedding, err := encodeFn(phrase)
			if err != nil {
				return fmt.Errorf("encode %s: %w", phrase, err)
			}
			record := IntentRecord{
				ChainID: wf.RuleChain.ID, IntentText: phrase,
				Fingerprint: ComputeFingerprint(phrase), Embedding: embedding,
			}
			if err := s.UpsertIntent(record); err != nil {
				return fmt.Errorf("upsert %s: %w", phrase, err)
			}
			snap.Records = append(snap.Records, record)
		}
		// Negative examples veto false-positive matches.
		for _, neg := range wf.NegativeExamples {
			embedding, err := encodeFn(neg)
			if err != nil {
				return fmt.Errorf("encode negative %s: %w", neg, err)
			}
			n := NegativeRecord{
				ChainID: wf.RuleChain.ID, Phrase: neg,
				Fingerprint: ComputeFingerprint(neg), Embedding: embedding,
			}
			if err := s.UpsertNegative(n); err != nil {
				return fmt.Errorf("upsert negative %s: %w", neg, err)
			}
			snap.Negatives = append(snap.Negatives, n)
		}
		if len(wf.Confusable) > 0 {
			snap.Confusable[wf.RuleChain.ID] = wf.Confusable
		}
	}
	s.snap = snap
	return nil
}

// workflowDoc is the intent-card view of a workflow JSON file.
type workflowDoc struct {
	RuleChain struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"ruleChain"`
	Intents          []string `json:"intents"`
	NegativeExamples []string `json:"negative_examples"`
	Confusable       []string `json:"confusable"`
}

func parseWorkflowJSON(data []byte) (workflowDoc, error) {
	var workflow workflowDoc
	if err := json.Unmarshal(data, &workflow); err != nil {
		return workflowDoc{}, err
	}
	if workflow.RuleChain.ID == "" || workflow.RuleChain.Name == "" {
		return workflowDoc{}, fmt.Errorf("invalid workflow: missing id or name")
	}
	return workflow, nil
}
