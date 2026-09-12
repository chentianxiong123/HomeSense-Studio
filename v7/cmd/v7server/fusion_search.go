package main

import (
	"context"
	"fmt"
	"sort"
	"strings"

	toolshared "github.com/sipeed/picoclaw/pkg/tools/shared"
)

// fusionSearchTool implements multi-source recall with RRF (Reciprocal Rank Fusion).
// It combines keyword search, semantic search, entity lookup, and conversation
// history search into a single ranked result set.
type fusionSearchTool struct {
	knowledge *KnowledgeStore
	history   *historySearchTool
}

func newFusionSearchTool(knowledge *KnowledgeStore, history *historySearchTool) *fusionSearchTool {
	return &fusionSearchTool{knowledge: knowledge, history: history}
}

func (t *fusionSearchTool) Name() string { return "recall" }

func (t *fusionSearchTool) Description() string {
	return `Multi-source recall search. Combines keyword search, semantic search, entity lookup, and conversation history into a single ranked result. Use this when you need comprehensive search across all knowledge and history.`
}

func (t *fusionSearchTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"query": map[string]any{
				"type":        "string",
				"description": "The search query",
			},
			"limit": map[string]any{
				"type":        "integer",
				"description": "Max results per source (default: 5)",
			},
			"include_history": map[string]any{
				"type":        "boolean",
				"description": "Include conversation history in search (default: true)",
			},
			"include_knowledge": map[string]any{
				"type":        "boolean",
				"description": "Include knowledge entries in search (default: true)",
			},
			"include_entities": map[string]any{
				"type":        "boolean",
				"description": "Include entity search in search (default: true)",
			},
		},
		"required": []string{"query"},
	}
}

// rankedResult is a single search result with its source and rank position.
type rankedResult struct {
	Content  string
	Category string
	Source   string // "keyword", "semantic", "history", "entity"
	Score    float64
	Rank     int
}

// reciprocalRankFusion merges multiple ranked lists using RRF.
// RRF score = sum(1 / (k + rank_i)) across all lists where the item appears.
// k=60 is the standard constant from the original RRF paper.
func reciprocalRankFusion(lists [][]rankedResult, k int) []rankedResult {
	if k <= 0 {
		k = 60
	}

	type fused struct {
		result rankedResult
		score  float64
		seen   map[string]bool // track which sources contributed
	}

	merged := make(map[string]*fused)

	for _, list := range lists {
		for rank, item := range list {
			key := item.Content[:min(100, len(item.Content))]
			if existing, ok := merged[key]; ok {
				existing.score += 1.0 / float64(k+rank+1)
				if !existing.seen[item.Source] {
					existing.seen[item.Source] = true
				}
			} else {
				merged[key] = &fused{
					result: item,
					score:  1.0 / float64(k+rank+1),
					seen:   map[string]bool{item.Source: true},
				}
			}
		}
	}

	// Sort by fused score descending.
	var results []rankedResult
	for _, f := range merged {
		f.result.Score = f.score
		results = append(results, f.result)
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})
	return results
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (t *fusionSearchTool) Execute(ctx context.Context, args map[string]any) *toolshared.ToolResult {
	query, _ := args["query"].(string)
	if strings.TrimSpace(query) == "" {
		return &toolshared.ToolResult{ForLLM: "Error: query is required", IsError: true}
	}

	limit := 5
	if v, ok := args["limit"].(float64); ok && v > 0 {
		limit = int(v)
	}

	includeHistory, _ := args["include_history"].(bool)
	includeKnowledge, _ := args["include_knowledge"].(bool)
	includeEntities, _ := args["include_entities"].(bool)
	// Default all to true if not explicitly set.
	if !args["include_history"].(bool) && !args["include_knowledge"].(bool) && !args["include_entities"].(bool) {
		includeHistory = true
		includeKnowledge = true
		includeEntities = true
	}

	var allLists [][]rankedResult

	// Source 1: FTS5 keyword search on knowledge entries.
	if includeKnowledge && t.knowledge != nil {
		results, _ := t.knowledge.SearchEntries(query, limit)
		var list []rankedResult
		for i, e := range results {
			list = append(list, rankedResult{
				Content:  e.Content,
				Category: e.Category,
				Source:   "keyword",
				Rank:     i + 1,
			})
		}
		if len(list) > 0 {
			allLists = append(allLists, list)
		}
	}

	// Source 2: Semantic search on embeddings.
	if includeKnowledge && t.knowledge != nil {
		queryEmb := defaultEmbedder.Embed(query)
		results, scores, _ := t.knowledge.SemanticSearch(queryEmb, limit)
		var list []rankedResult
		for i, e := range results {
			list = append(list, rankedResult{
				Content:  e.Content,
				Category: e.Category,
				Source:   "semantic",
				Score:    scores[i],
				Rank:     i + 1,
			})
		}
		if len(list) > 0 {
			allLists = append(allLists, list)
		}
	}

	// Source 3: Entity name/type search.
	if includeEntities && t.knowledge != nil {
		results, _ := t.knowledge.ListEntities("")
		var list []rankedResult
		for i, e := range results {
			if strings.Contains(strings.ToLower(e.Name), strings.ToLower(query)) ||
				strings.Contains(strings.ToLower(e.Type), strings.ToLower(query)) {
				list = append(list, rankedResult{
					Content:  fmt.Sprintf("%s (%s) %s", e.Name, e.Type, e.Properties),
					Category: "entity",
					Source:   "entity",
					Rank:     i + 1,
				})
			}
		}
		if len(list) > 0 {
			allLists = append(allLists, list)
		}
	}

	// Source 4: Conversation history search.
	if includeHistory && t.history != nil {
		// Use FTS5 on sessions.db.
		var histResults []rankedResult
		if t.history.db != nil {
			t.history.db.ExecContext(ctx, `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`)
			rows, err := t.history.db.QueryContext(ctx, `
				SELECT m.content, m.role, m.created_at
				FROM messages m
				INNER JOIN messages_fts f ON m.rowid = f.rowid
				WHERE messages_fts MATCH ?
				ORDER BY rank
				LIMIT ?
			`, query, limit)
			if err == nil {
				defer rows.Close()
				i := 0
				for rows.Next() {
					var content, role string
					var createdAt int64
					if err := rows.Scan(&content, &role, &createdAt); err != nil {
						continue
					}
					i++
					if len(content) > 200 {
						content = content[:200] + "..."
					}
					histResults = append(histResults, rankedResult{
						Content:  fmt.Sprintf("[%s] %s", role, content),
						Category: "history",
						Source:   "history",
						Rank:     i,
					})
				}
			}
		}
		if len(histResults) > 0 {
			allLists = append(allLists, histResults)
		}
	}

	if len(allLists) == 0 {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("No results found for: %s", query)}
	}

	// Merge all sources using RRF.
	fused := reciprocalRankFusion(allLists, 60)

	// Format output.
	var out []string
	shown := 0
	for _, r := range fused {
		if shown >= limit*2 { // show up to 2x limit for diversity
			break
		}
		out = append(out, fmt.Sprintf("[%.3f | %s | %s] %s", r.Score, r.Source, r.Category, r.Content))
		shown++
	}

	return &toolshared.ToolResult{
		ForLLM: fmt.Sprintf("Recall results (%d sources, %d items):\n%s", len(allLists), shown, strings.Join(out, "\n")),
	}
}
