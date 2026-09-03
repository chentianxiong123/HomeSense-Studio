package workflowmatch

import (
	"crypto/sha256"
	"fmt"
	"strconv"
)

// ComputeFingerprint returns the SHA256 fingerprint of the given text.
func ComputeFingerprint(text string) string {
	h := sha256.New()
	h.Write([]byte(text))
	return fmt.Sprintf("%x", h.Sum(nil))
}

// FingerprintResult holds the result of a fingerprint lookup.
type FingerprintResult struct {
	ChainID string
	Matched bool
}

// FingerprintMatch looks up a fingerprint in the intent cache.
func FingerprintMatch(fingerprint string, cache map[string]FingerprintResult) (FingerprintResult, bool) {
	result, ok := cache[fingerprint]
	return result, ok
}

// FingerprintFromIntentText generates a fingerprint from intent text.
func FingerprintFromIntentText(intentText string) string {
	return ComputeFingerprint(intentText)
}

// String returns the fingerprint as a human-readable string.
func (r FingerprintResult) String() string {
	if !r.Matched {
		return "no match"
	}
	return fmt.Sprintf("chain_id=%s", r.ChainID)
}

// ConfidenceThreshold is the minimum confidence for a positive match.
const ConfidenceThreshold = 0.65

// ParseConfidence parses a confidence value from a string.
func ParseConfidence(s string) (float32, error) {
	f, err := strconv.ParseFloat(s, 32)
	if err != nil {
		return 0, fmt.Errorf("parse confidence: %w", err)
	}
	return float32(f), nil
}

// FormatConfidence formats a confidence value to a string.
func FormatConfidence(c float32) string {
	return strconv.FormatFloat(float64(c), 'f', 4, 32)
}
