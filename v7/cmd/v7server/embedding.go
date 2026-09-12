package main

import (
	"encoding/binary"
	"math"
	"strings"
	"unicode"
)

// Embedder generates simple TF-IDF based embeddings for text.
// This is a lightweight approach that works offline without external APIs.
type Embedder struct {
	vocab    map[string]int // word -> index
	idf      map[string]float64
	dim      int
	ready    bool
	docs     int
	wordFreq map[string]int
}

// NewEmbedder creates a new embedder with a fixed vocabulary dimension.
func NewEmbedder(dim int) *Embedder {
	if dim <= 0 {
		dim = 128
	}
	return &Embedder{
		vocab:    make(map[string]int),
		idf:      make(map[string]float64),
		dim:      dim,
		wordFreq: make(map[string]int),
	}
}

// tokenize splits text into lowercase words, filtering short tokens.
func tokenize(text string) []string {
	var words []string
	var current strings.Builder
	for _, r := range strings.ToLower(text) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			current.WriteRune(r)
		} else {
			if current.Len() > 2 {
				words = append(words, current.String())
			}
			current.Reset()
		}
	}
	if current.Len() > 2 {
		words = append(words, current.String())
	}
	return words
}

// hashWord maps a word to a bucket index in [0, dim).
// Uses a simple hash to distribute words across dimensions.
func (e *Embedder) hashWord(word string) int {
	h := 0
	for _, r := range word {
		h = h*31 + int(r)
	}
	if h < 0 {
		h = -h
	}
	return h % e.dim
}

// hashWordSecondary maps a word to a second bucket for sign flipping.
func (e *Embedder) hashWordSecondary(word string) int {
	h := 0
	for _, r := range word {
		h = h*37 + int(r) + 1
	}
	if h < 0 {
		h = -h
	}
	return h % e.dim
}

// Embed generates a TF-IDF-like embedding vector for the given text.
// Returns a float32 slice of dimension e.dim, L2-normalized.
func (e *Embedder) Embed(text string) []float32 {
	vec := make([]float32, e.dim)
	words := tokenize(text)

	// Count word frequencies in this document.
	tf := make(map[string]int)
	for _, w := range words {
		tf[w]++
	}

	// Generate sparse embedding: each word contributes to 2 buckets
	// with sign determined by a secondary hash (SimHash-like).
	for word, count := range tf {
		weight := float32(count) * float32(math.Log(1+float64(count)))
		idx := e.hashWord(word)
		sign := float32(1.0)
		if e.hashWordSecondary(word)%2 == 0 {
			sign = -1.0
		}
		vec[idx] += sign * weight
	}

	// L2 normalize.
	var norm float32
	for _, v := range vec {
		norm += v * v
	}
	if norm > 0 {
		norm = float32(math.Sqrt(float64(norm)))
		for i := range vec {
			vec[i] /= norm
		}
	}
	return vec
}

// EmbedAndSerialize generates embedding and returns it as bytes for storage.
func (e *Embedder) EmbedAndSerialize(text string) []byte {
	vec := e.Embed(text)
	return Float32SliceToBytes(vec)
}

// CosineSimilarity computes cosine similarity between two vectors.
func CosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		normA += float64(a[i]) * float64(a[i])
		normB += float64(b[i]) * float64(b[i])
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

// Float32SliceToBytes converts a float32 slice to bytes for BLOB storage.
func Float32SliceToBytes(vec []float32) []byte {
	buf := make([]byte, len(vec)*4)
	for i, v := range vec {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(v))
	}
	return buf
}

// BytesToFloat32Slice converts bytes back to a float32 slice.
func BytesToFloat32Slice(data []byte) []float32 {
	if len(data)%4 != 0 {
		return nil
	}
	vec := make([]float32, len(data)/4)
	for i := range vec {
		vec[i] = math.Float32frombits(binary.LittleEndian.Uint32(data[i*4:]))
	}
	return vec
}
