package workflowmatch

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	ort "github.com/shota3506/onnxruntime-purego/onnxruntime"
	"github.com/sugarme/tokenizer"
	"github.com/sugarme/tokenizer/pretrained"
)

//go:embed models/*
var modelsFS embed.FS

// Embedder handles text embedding using bge-small-zh-v1.5 ONNX model.
type Embedder struct {
	runtime   *ort.Runtime
	env       *ort.Env
	session   *ort.Session
	tok       *tokenizer.Tokenizer
	mu        sync.Mutex
	maxLen    int
	modelDir  string
}

// EmbedderConfig holds configuration for the Embedder.
type EmbedderConfig struct {
	MaxSeqLength int
	ModelDir     string
	LibPath      string
	CPUThreads   int
}

// DefaultEmbedderConfig returns default configuration.
func DefaultEmbedderConfig() *EmbedderConfig {
	return &EmbedderConfig{
		MaxSeqLength: 128,
		CPUThreads:   1,
	}
}

// NewEmbedder creates a new Embedder instance.
func NewEmbedder(cfg *EmbedderConfig) (*Embedder, error) {
	if cfg == nil {
		cfg = DefaultEmbedderConfig()
	}

	// Extract bundled model files to temp dir
	modelDir, err := extractModels()
	if err != nil {
		return nil, fmt.Errorf("extract models: %w", err)
	}
	cfg.ModelDir = modelDir

	// Determine library path
	libPath := cfg.LibPath
	if libPath == "" {
		// Try relative to executable or project root
		libPath = filepath.Join("..", "third_party", "ort", "libonnxruntime.so")
		// Also try absolute path from project root
		if _, err := os.Stat(libPath); os.IsNotExist(err) {
			libPath = filepath.Join("third_party", "ort", "libonnxruntime.so")
		}
	}

	// Load ONNX Runtime
	runtime, err := ort.NewRuntime(libPath, 23)
	if err != nil {
		return nil, fmt.Errorf("create runtime: %w", err)
	}

	// Create environment
	env, err := runtime.NewEnv("homesense-workflow-match", ort.LoggingLevelWarning)
	if err != nil {
		runtime.Close()
		return nil, fmt.Errorf("create env: %w", err)
	}

	// Load model
	session, err := runtime.NewSession(env, filepath.Join(modelDir, "model_quantized.onnx"), &ort.SessionOptions{
		IntraOpNumThreads: cfg.CPUThreads,
	})
	if err != nil {
		env.Close()
		runtime.Close()
		return nil, fmt.Errorf("load model: %w", err)
	}

	// Load tokenizer
	tok, err := pretrained.FromFile(filepath.Join(modelDir, "tokenizer.json"))
	if err != nil {
		session.Close()
		env.Close()
		runtime.Close()
		return nil, fmt.Errorf("load tokenizer: %w", err)
	}

	log.Printf("[embedder] model loaded: inputs=%v outputs=%v maxLen=%d",
		session.InputNames(), session.OutputNames(), cfg.MaxSeqLength)

	return &Embedder{
		runtime:  runtime,
		env:      env,
		session:  session,
		tok:      tok,
		maxLen:   cfg.MaxSeqLength,
		modelDir: modelDir,
	}, nil
}

// Encode produces a 512-dimensional embedding vector for the given text.
func (e *Embedder) Encode(ctx context.Context, text string) ([]float32, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	encoding, err := e.tok.EncodeSingle(text, true)
	if err != nil {
		return nil, fmt.Errorf("tokenize: %w", err)
	}

	inputIds := encoding.GetIds()
	attentionMask := encoding.GetAttentionMask()
	tokenTypeId := make([]int64, len(inputIds))

	// Pad or truncate
	if len(inputIds) > e.maxLen {
		inputIds = inputIds[:e.maxLen]
		attentionMask = attentionMask[:e.maxLen]
		tokenTypeId = tokenTypeId[:e.maxLen]
	}
	for len(inputIds) < e.maxLen {
		inputIds = append(inputIds, 0)
		attentionMask = append(attentionMask, 0)
		tokenTypeId = append(tokenTypeId, 0)
	}

	inputIds64 := make([]int64, len(inputIds))
	attentionMask64 := make([]int64, len(attentionMask))
	tokenTypeId64 := make([]int64, len(tokenTypeId))
	for i := range inputIds {
		inputIds64[i] = int64(inputIds[i])
		attentionMask64[i] = int64(attentionMask[i])
		tokenTypeId64[i] = int64(tokenTypeId[i])
	}

	inputIdsTensor, err := ort.NewTensorValue(e.runtime, inputIds64, []int64{1, int64(len(inputIds))})
	if err != nil {
		return nil, fmt.Errorf("input_ids tensor: %w", err)
	}
	defer inputIdsTensor.Close()

	attentionMaskTensor, err := ort.NewTensorValue(e.runtime, attentionMask64, []int64{1, int64(len(attentionMask))})
	if err != nil {
		return nil, fmt.Errorf("attention_mask tensor: %w", err)
	}
	defer attentionMaskTensor.Close()

	tokenTypeIdTensor, err := ort.NewTensorValue(e.runtime, tokenTypeId64, []int64{1, int64(len(tokenTypeId))})
	if err != nil {
		return nil, fmt.Errorf("token_type_ids tensor: %w", err)
	}
	defer tokenTypeIdTensor.Close()

	inputs := map[string]*ort.Value{
		"input_ids":        inputIdsTensor,
		"attention_mask":   attentionMaskTensor,
		"token_type_ids":   tokenTypeIdTensor,
	}

	start := time.Now()
	outputs, err := e.session.Run(ctx, inputs)
	_ = time.Since(start) // used for logging in production
	if err != nil {
		return nil, fmt.Errorf("inference: %w", err)
	}
	defer func() {
		for _, v := range outputs {
			v.Close()
		}
	}()

	sentenceEmbedding, ok := outputs["sentence_embedding"]
	if !ok {
		return nil, fmt.Errorf("output 'sentence_embedding' not found, got: %v", outputs)
	}
	defer sentenceEmbedding.Close()

	embedding, shape, err := ort.GetTensorData[float32](sentenceEmbedding)
	if err != nil {
		return nil, fmt.Errorf("get embedding: %w", err)
	}

	if len(embedding) != 512 {
		return nil, fmt.Errorf("bad embedding dim: got %d, want 512, shape=%v", len(embedding), shape)
	}

	return embedding, nil
}

// Close releases all resources.
func (e *Embedder) Close() {
	if e.session != nil {
		e.session.Close()
	}
	if e.env != nil {
		e.env.Close()
	}
	if e.runtime != nil {
		e.runtime.Close()
	}
}

// modelDir returns the extracted model directory.
func (e *Embedder) modelDirPath() string {
	return e.modelDir
}

// extractModels extracts bundled model files to a temp directory.
func extractModels() (string, error) {
	tmpDir, err := os.MkdirTemp("", "bge-small-zh-*")
	if err != nil {
		return "", fmt.Errorf("temp dir: %w", err)
	}

	entries, err := modelsFS.ReadDir("models")
	if err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("read models: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := modelsFS.ReadFile(filepath.Join("models", entry.Name()))
		if err != nil {
			os.RemoveAll(tmpDir)
			return "", fmt.Errorf("read %s: %w", entry.Name(), err)
		}
		if err := os.WriteFile(filepath.Join(tmpDir, entry.Name()), data, 0644); err != nil {
			os.RemoveAll(tmpDir)
			return "", fmt.Errorf("write %s: %w", entry.Name(), err)
		}
	}

	return tmpDir, nil
}


