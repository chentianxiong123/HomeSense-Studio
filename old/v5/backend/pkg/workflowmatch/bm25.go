package workflowmatch

import (
	"math"
	"strings"
	"unicode"
)

// Chinese text is segmented into character bigrams (no dictionary required).
// Non-CJK runs (latin/digits) are tokenized as lowercase words.
func tokenizeTerms(text string) []string {
	var terms []string
	runes := []rune(strings.ToLower(text))

	i := 0
	for i < len(runes) {
		r := runes[i]
		// CJK run: emit all length-2 bigrams
		if isCJK(r) {
			start := i
			for i < len(runes) && isCJK(runes[i]) {
				i++
			}
			run := runes[start:i]
			for j := 0; j+1 < len(run); j++ {
				terms = append(terms, string(run[j:j+2]))
			}
			// single CJK char still useful
			if len(run) == 1 {
				terms = append(terms, string(run[0]))
			}
			continue
		}
		// non-CJK run (letters/digits): lowercase word
		start := i
		for i < len(runes) && !isCJK(runes[i]) {
			i++
		}
		w := strings.TrimSpace(string(runes[start:i]))
		if w != "" {
			terms = append(terms, w)
		}
	}
	return terms
}

func isCJK(r rune) bool {
	return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r)
}

// BM25Index computes BM25 scores for an in-memory corpus of terms.
type BM25Index struct {
	docs     [][]string // raw term lists
	docLens  []int
	tf       []map[string]int
	df       map[string]int
	numDocs  int
	avgdl    float64
	corpusID uint64
}

// NewBM25Index builds a BM25 index over the given documents.
func NewBM25Index(texts []string) *BM25Index {
	idx := &BM25Index{
		docs:    make([][]string, len(texts)),
		docLens: make([]int, len(texts)),
		tf:      make([]map[string]int, len(texts)),
		df:      make(map[string]int),
		numDocs: len(texts),
	}
	totalLen := 0
	for i, t := range texts {
		terms := tokenizeTerms(t)
		idx.docs[i] = terms
		idx.docLens[i] = len(terms)
		totalLen += len(terms)
		seen := make(map[string]struct{}, len(terms))
		idx.tf[i] = make(map[string]int)
		for _, term := range terms {
			idx.tf[i][term]++
			if _, ok := seen[term]; ok {
				continue
			}
			seen[term] = struct{}{}
			idx.df[term]++
		}
	}
	if idx.numDocs > 0 {
		idx.avgdl = float64(totalLen) / float64(idx.numDocs)
	}
	return idx
}

// k1 and b are the standard BM25 tuning parameters.
const bm25K1 = 1.2
const bm25B = 0.75

// Score returns BM25 scores for all documents against the query text.
func (idx *BM25Index) Score(query string) []float64 {
	if idx == nil || idx.numDocs == 0 {
		return nil
	}
	qterms := tokenizeTerms(query)
	// document frequency of terms present in the query
	n := float64(idx.numDocs)
	avgdl := idx.avgdl
	if avgdl <= 0 {
		avgdl = 1
	}
	scores := make([]float64, idx.numDocs)
	for _, q := range qterms {
		df := idx.df[q]
		if df == 0 {
			continue
		}
		idf := math.Log(1 + (n-float64(df)+0.5)/(float64(df)+0.5))
		for d := 0; d < idx.numDocs; d++ {
			tf := idx.tf[d][q]
			if tf == 0 {
				continue
			}
			dl := float64(idx.docLens[d])
			denom := float64(tf) + bm25K1*(1-bm25B+bm25B*dl/avgdl)
			scores[d] += idf * float64(tf) * (bm25K1 + 1) / denom
		}
	}
	return scores
}