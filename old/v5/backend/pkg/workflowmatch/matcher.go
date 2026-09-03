package workflowmatch

import (
	"context"
	"fmt"
	"math"
	"sort"
)

// CosineSimilarity computes the cosine similarity between two vectors.
func CosineSimilarity(a, b []float32) (float32, error) {
	if len(a) != len(b) {
		return 0, fmt.Errorf("dimension mismatch: %d != %d", len(a), len(b))
	}
	var dot, normA, normB float32
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA == 0 || normB == 0 {
		return 0, nil
	}
	return dot / (float32(math.Sqrt(float64(normA))) * float32(math.Sqrt(float64(normB)))), nil
}

// MatchResult holds the result of an intent match.
type MatchResult struct {
	ChainID    string  `json:"chain_id"`
	Confidence float32 `json:"confidence"`
	Method     string  `json:"method"` // "fingerprint", "bm25", "embedding" or "hybrid"
	IntentText string  `json:"intent_text,omitempty"`
}

// Matcher performs intent matching using fingerprint + BM25 + embedding
// hybrid retrieval with Reciprocal Rank Fusion and intent-card veto.
type Matcher struct {
	store     *Store
	embedder  *Embedder
	threshold float32
}

// MatcherConfig holds configuration for the Matcher.
type MatcherConfig struct {
	Threshold float32
}

// DefaultMatcherConfig returns default configuration.
func DefaultMatcherConfig() *MatcherConfig {
	return &MatcherConfig{
		Threshold: ConfidenceThreshold,
	}
}

// NewMatcher creates a new Matcher.
func NewMatcher(store *Store, embedder *Embedder, cfg *MatcherConfig) *Matcher {
	if cfg == nil {
		cfg = DefaultMatcherConfig()
	}
	return &Matcher{
		store:     store,
		embedder:  embedder,
		threshold: cfg.Threshold,
	}
}

// sc candidate wrapper holding per-record scores.
type sc struct {
	record IntentRecord
	bm25   float64 // normalized BM25 (0..1), used for ranking only
	cover  float32 // lexical coverage: fraction of query terms matched
	cos    float32
	fused  float32
	rank   int
}

// Match finds the best matching workflow for the given input text.
//
// Pipeline:
//  1. fingerprint exact match            -> immediate hit (0.1ms)
//  2. BM25 lexical overlap (bigrams)     -> ~0ms
//  3. embedding semantic similarity      -> ~33ms
//  4. RRF fusion across channels, group by chain, pick best
//  5. intent-card negative veto: a chain whose negative example scores
//     as high as its best positive is rejected (kills 反义误报)
func (m *Matcher) Match(ctx context.Context, input string) (*MatchResult, error) {
	snap := m.store.Snapshot()
	records := snap.Records

	// Step 1: fingerprint exact match
	fp := ComputeFingerprint(input)
	record, err := m.store.GetByFingerprint(fp)
	if err != nil {
		return nil, fmt.Errorf("fingerprint lookup: %w", err)
	}
	if record != nil {
		return &MatchResult{
			ChainID:    record.ChainID,
			Confidence: 1.0,
			Method:     "fingerprint",
			IntentText: record.IntentText,
		}, nil
	}

	// Step 2: BM25 lexical scores
	texts := make([]string, len(records))
	for i, r := range records {
		texts[i] = r.IntentText
	}
	idx := NewBM25Index(texts)
	bm25Scores := idx.Score(input)
	maxBM25 := 0.0
	for _, s := range bm25Scores {
		if s > maxBM25 {
			maxBM25 = s
		}
	}
	// Lexical coverage: fraction of the query's own terms that appear in each
	// document. This is an absolute 0..1 signal (unlike normalized BM25, which
	// can hit 1.0 from a single shared bigram).
	qTerms := tokenizeTerms(input)
	qTermSet := map[string]struct{}{}
	for _, t := range qTerms {
		qTermSet[t] = struct{}{}
	}
	cover := make([]float32, len(records))
	if len(qTermSet) > 0 {
		for i, r := range records {
			docTerms := map[string]struct{}{}
			for _, t := range tokenizeTerms(r.IntentText) {
				docTerms[t] = struct{}{}
			}
			shared := 0
			for t := range qTermSet {
				if _, ok := docTerms[t]; ok {
					shared++
				}
			}
			cover[i] = float32(shared) / float32(len(qTermSet))
		}
	}

	// Step 3: embedding cosine scores
	var queryEmb []float32
	if m.embedder != nil {
		queryEmb, err = m.embedder.Encode(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("encode input: %w", err)
		}
	}

	cands := make([]sc, 0, len(records))
	for i, r := range records {
		c := sc{record: r, bm25: bm25Scores[i], cover: cover[i]}
		if maxBM25 > 0 {
			c.bm25 = c.bm25 / maxBM25 // normalize to 0..1 (ranking only)
		}
		if queryEmb != nil {
			sim, cerr := CosineSimilarity(queryEmb, r.Embedding)
			if cerr == nil {
				c.cos = sim
			}
		}
		cands = append(cands, c)
	}

	// Step 4a: rank by BM25 then by embedding for RRF
	rankByBM25 := rankChannels(cands, func(c sc) float64 { return c.bm25 })
	rankByCos := rankChannels(cands, func(c sc) float64 { return float64(c.cos) })

	// RRF fusion: fused = sum over channels of 1/(k + rank)
	const rrfK = 60.0
	for i := range cands {
		rrf := 0.0
		if r := rankByBM25[i]; r > 0 {
			rrf += 1.0 / (rrfK + float64(r))
		}
		if r := rankByCos[i]; r > 0 {
			rrf += 1.0 / (rrfK + float64(r))
		}
		cands[i].fused = float32(rrf)
	}

	// Step 4b: group by chain, keep best fused per chain
	byChain := map[string]*sc{}
	for i := range cands {
		c := cands[i]
		cur, ok := byChain[c.record.ChainID]
		if !ok || c.fused > cur.fused {
			cc := c
			byChain[c.record.ChainID] = &cc
		}
	}

	// Step 4c: top-3 chains by fused score
	type chainPick struct {
		chainID string
		best    *sc
	}
	picks := make([]chainPick, 0, len(byChain))
	for id, c := range byChain {
		picks = append(picks, chainPick{chainID: id, best: c})
	}
	sort.Slice(picks, func(i, j int) bool {
		if picks[i].best.fused != picks[j].best.fused {
			return picks[i].best.fused > picks[j].best.fused
		}
		return picks[i].best.cos > picks[j].best.cos
	})

	// Step 5: intent-card veto — reject chains where a negative example
	// matches as strongly as the best positive anchor.
	negByChain := map[string][]NegativeRecord{}
	for _, n := range snap.Negatives {
		negByChain[n.ChainID] = append(negByChain[n.ChainID], n)
	}

	for _, p := range picks {
		// veto check
		if m.vetoed(ctx, p.best, negByChain[p.chainID], queryEmb) {
			continue
		}
		// Confidence = the strongest absolute channel signal (cosine similarity
		// or lexical coverage), keeping the old 0..1 threshold semantics.
		conf := p.best.cos
		if p.best.cover > conf {
			conf = p.best.cover
		}
		if conf < m.threshold {
			return nil, nil
		}
		return &MatchResult{
			ChainID:    p.chainID,
			Confidence: conf,
			Method:     channelMethod(p.best),
			IntentText: p.best.record.IntentText,
		}, nil
	}

	return nil, nil
}

// vetoed returns true when the chain's negative examples match the query
// at least as well as its best positive anchor.
func (m *Matcher) vetoed(ctx context.Context, best *sc, negatives []NegativeRecord, queryEmb []float32) bool {
	if len(negatives) == 0 || queryEmb == nil {
		return false
	}
	posCos := best.cos
	var negMax float32
	for _, n := range negatives {
		sim, err := CosineSimilarity(queryEmb, n.Embedding)
		if err != nil {
			continue
		}
		if sim > negMax {
			negMax = sim
		}
	}
	// Veto when the negative example is at least as close as the positive
	// anchor (with a small tolerance so near-equal semantics are rejected).
	return negMax >= posCos-0.02 && negMax >= 0.55
}

// rankChannels returns a per-index rank (1-based) or 0 when the channel is
// empty/zero. Equal scores share the best rank.
func rankChannels(cands []sc, score func(sc) float64) []int {
	ranks := make([]int, len(cands))
	type sv struct {
		i int
		v float64
	}
	vs := make([]sv, 0, len(cands))
	for i, c := range cands {
		if score(c) <= 0 {
			continue
		}
		vs = append(vs, sv{i: i, v: score(c)})
	}
	sort.Slice(vs, func(i, j int) bool { return vs[i].v > vs[j].v })
	for k, v := range vs {
		ranks[v.i] = k + 1
	}
	return ranks
}

func channelMethod(c *sc) string {
	if c.cover > 0 && c.cos > 0 {
		return "hybrid"
	}
	if c.cos > 0 {
		return "embedding"
	}
	if c.cover > 0 {
		return "bm25"
	}
	return "none"
}