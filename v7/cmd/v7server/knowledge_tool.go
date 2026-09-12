package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	toolshared "github.com/sipeed/picoclaw/pkg/tools/shared"
)

// knowledgeTool implements toolshared.Tool for managing the knowledge base.
// It supports search, add, update, delete operations on entries and entities.
type knowledgeTool struct {
	store *KnowledgeStore
}

func newKnowledgeTool(store *KnowledgeStore) *knowledgeTool {
	return &knowledgeTool{store: store}
}

func (t *knowledgeTool) Name() string { return "knowledge" }

func (t *knowledgeTool) Description() string {
	return `Manage the knowledge base. Actions:
- search: Full-text search across all knowledge entries
- list: List entries by category
- add: Add a new knowledge entry
- update: Update an existing entry
- delete: Delete an entry
- entity_upsert: Create or update an entity (device/room/person)
- entity_list: List entities
- entity_find: Find an entity by name and type
- relation_add: Add a relation between two entities
- relation_list: List relations for an entity`
}

func (t *knowledgeTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
	"action": map[string]any{
		"type":        "string",
		"description": "The action to perform",
		"enum":        []string{"search", "list", "add", "update", "delete", "entity_upsert", "entity_list", "entity_find", "relation_add", "relation_list", "semantic_search", "embed"},
	},
			"query": map[string]any{
				"type":        "string",
				"description": "Search query (for search action)",
			},
			"category": map[string]any{
				"type":        "string",
				"description": "Entry category: fact, preference, device, room, person, note",
			},
			"content": map[string]any{
				"type":        "string",
				"description": "Entry content (for add/update actions)",
			},
			"tags": map[string]any{
				"type":        "string",
				"description": "Comma-separated tags",
			},
			"id": map[string]any{
				"type":        "integer",
				"description": "Entry/entity ID (for update/delete/entity_find/relation_list)",
			},
			"name": map[string]any{
				"type":        "string",
				"description": "Entity name (for entity_upsert/entity_find)",
			},
			"entity_type": map[string]any{
				"type":        "string",
				"description": "Entity type: device, room, person, app",
			},
			"properties": map[string]any{
				"type":        "string",
				"description": "JSON properties (for entity_upsert/relation_add)",
			},
			"from_id": map[string]any{
				"type":        "integer",
				"description": "Source entity ID (for relation_add)",
			},
			"to_id": map[string]any{
				"type":        "integer",
				"description": "Target entity ID (for relation_add)",
			},
			"relation_type": map[string]any{
				"type":        "string",
				"description": "Relation type: located_in, owned_by, controls, connected_to",
			},
			"limit": map[string]any{
				"type":        "integer",
				"description": "Max results (default 10)",
			},
		},
		"required": []string{"action"},
	}
}

func (t *knowledgeTool) Execute(ctx context.Context, args map[string]any) *toolshared.ToolResult {
	action, _ := args["action"].(string)
	if action == "" {
		return &toolshared.ToolResult{ForLLM: "Error: action is required", IsError: true}
	}

	switch action {
	case "search":
		return t.handleSearch(args)
	case "list":
		return t.handleList(args)
	case "add":
		return t.handleAdd(args)
	case "update":
		return t.handleUpdate(args)
	case "delete":
		return t.handleDelete(args)
	case "entity_upsert":
		return t.handleEntityUpsert(args)
	case "entity_list":
		return t.handleEntityList(args)
	case "entity_find":
		return t.handleEntityFind(args)
	case "relation_add":
		return t.handleRelationAdd(args)
	case "relation_list":
		return t.handleRelationList(args)
	case "semantic_search":
		return t.handleSemanticSearch(args)
	case "embed":
		return t.handleEmbed(args)
	default:
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Unknown action: %s", action), IsError: true}
	}
}

func (t *knowledgeTool) handleSearch(args map[string]any) *toolshared.ToolResult {
	query, _ := args["query"].(string)
	if query == "" {
		return &toolshared.ToolResult{ForLLM: "Error: query is required for search", IsError: true}
	}
	limit := 10
	if v, ok := args["limit"].(float64); ok && v > 0 {
		limit = int(v)
	}

	results, err := t.store.SearchEntries(query, limit)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Search error: %v", err), IsError: true}
	}
	if len(results) == 0 {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("No results found for: %s", query)}
	}

	var out []string
	for i, e := range results {
		out = append(out, fmt.Sprintf("[%d] (%s) %s", i+1, e.Category, truncate(e.Content, 200)))
	}
	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Found %d results:\n%s", len(results), strings.Join(out, "\n"))}
}

func (t *knowledgeTool) handleList(args map[string]any) *toolshared.ToolResult {
	category, _ := args["category"].(string)
	limit := 50
	if v, ok := args["limit"].(float64); ok && v > 0 {
		limit = int(v)
	}

	results, err := t.store.ListEntries(category, limit)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("List error: %v", err), IsError: true}
	}
	if len(results) == 0 {
		return &toolshared.ToolResult{ForLLM: "No entries found"}
	}

	var out []string
	for _, e := range results {
		out = append(out, fmt.Sprintf("[%d] (%s) %s", e.ID, e.Category, truncate(e.Content, 200)))
	}
	return &toolshared.ToolResult{ForLLM: strings.Join(out, "\n")}
}

func (t *knowledgeTool) handleAdd(args map[string]any) *toolshared.ToolResult {
	content, _ := args["content"].(string)
	if content == "" {
		return &toolshared.ToolResult{ForLLM: "Error: content is required", IsError: true}
	}
	category, _ := args["category"].(string)
	if category == "" {
		category = "note"
	}
	tags, _ := args["tags"].(string)

	id, err := t.store.AddEntry(category, content, "agent", tags)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Add error: %v", err), IsError: true}
	}
	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Entry added with ID: %d", id)}
}

func (t *knowledgeTool) handleUpdate(args map[string]any) *toolshared.ToolResult {
	id, _ := args["id"].(float64)
	if id == 0 {
		return &toolshared.ToolResult{ForLLM: "Error: id is required", IsError: true}
	}
	content, _ := args["content"].(string)
	category, _ := args["category"].(string)
	tags, _ := args["tags"].(string)

	if err := t.store.UpdateEntry(int64(id), category, content, tags); err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Update error: %v", err), IsError: true}
	}
	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Entry %d updated", int64(id))}
}

func (t *knowledgeTool) handleDelete(args map[string]any) *toolshared.ToolResult {
	id, _ := args["id"].(float64)
	if id == 0 {
		return &toolshared.ToolResult{ForLLM: "Error: id is required", IsError: true}
	}
	if err := t.store.DeleteEntry(int64(id)); err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Delete error: %v", err), IsError: true}
	}
	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Entry %d deleted", int64(id))}
}

func (t *knowledgeTool) handleEntityUpsert(args map[string]any) *toolshared.ToolResult {
	name, _ := args["name"].(string)
	entityType, _ := args["entity_type"].(string)
	if name == "" || entityType == "" {
		return &toolshared.ToolResult{ForLLM: "Error: name and entity_type are required", IsError: true}
	}
	properties, _ := args["properties"].(string)
	if properties == "" {
		properties = "{}"
	}

	id, err := t.store.UpsertEntity(name, entityType, properties)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Entity upsert error: %v", err), IsError: true}
	}
	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Entity '%s' (%s) saved with ID: %d", name, entityType, id)}
}

func (t *knowledgeTool) handleEntityList(args map[string]any) *toolshared.ToolResult {
	entityType, _ := args["entity_type"].(string)
	results, err := t.store.ListEntities(entityType)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Entity list error: %v", err), IsError: true}
	}
	if len(results) == 0 {
		return &toolshared.ToolResult{ForLLM: "No entities found"}
	}

	var out []string
	for _, e := range results {
		out = append(out, fmt.Sprintf("[%d] %s (%s) %s", e.ID, e.Name, e.Type, e.Properties))
	}
	return &toolshared.ToolResult{ForLLM: strings.Join(out, "\n")}
}

func (t *knowledgeTool) handleEntityFind(args map[string]any) *toolshared.ToolResult {
	name, _ := args["name"].(string)
	entityType, _ := args["entity_type"].(string)
	if name == "" {
		return &toolshared.ToolResult{ForLLM: "Error: name is required", IsError: true}
	}

	e, err := t.store.FindEntity(name, entityType)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Entity not found: %v", err), IsError: true}
	}
	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("[%d] %s (%s) %s", e.ID, e.Name, e.Type, e.Properties)}
}

func (t *knowledgeTool) handleRelationAdd(args map[string]any) *toolshared.ToolResult {
	fromID, _ := args["from_id"].(float64)
	toID, _ := args["to_id"].(float64)
	relType, _ := args["relation_type"].(string)
	if fromID == 0 || toID == 0 || relType == "" {
		return &toolshared.ToolResult{ForLLM: "Error: from_id, to_id, and relation_type are required", IsError: true}
	}
	properties, _ := args["properties"].(string)
	if properties == "" {
		properties = "{}"
	}

	id, err := t.store.AddRelation(int64(fromID), int64(toID), relType, properties)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Relation add error: %v", err), IsError: true}
	}
	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Relation added with ID: %d", id)}
}

func (t *knowledgeTool) handleRelationList(args map[string]any) *toolshared.ToolResult {
	entityID, _ := args["id"].(float64)
	if entityID == 0 {
		return &toolshared.ToolResult{ForLLM: "Error: id (entity ID) is required", IsError: true}
	}

	results, err := t.store.GetRelations(int64(entityID))
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Relation list error: %v", err), IsError: true}
	}
	if len(results) == 0 {
		return &toolshared.ToolResult{ForLLM: "No relations found"}
	}

	data, _ := json.MarshalIndent(results, "", "  ")
	return &toolshared.ToolResult{ForLLM: string(data)}
}

func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max] + "..."
	}
	return s
}

// Default embedder instance (shared across calls).
var defaultEmbedder = NewEmbedder(128)

func (t *knowledgeTool) handleSemanticSearch(args map[string]any) *toolshared.ToolResult {
	query, _ := args["query"].(string)
	if query == "" {
		return &toolshared.ToolResult{ForLLM: "Error: query is required for semantic_search", IsError: true}
	}
	limit := 5
	if v, ok := args["limit"].(float64); ok && v > 0 {
		limit = int(v)
	}

	queryEmb := defaultEmbedder.Embed(query)
	results, scores, err := t.store.SemanticSearch(queryEmb, limit)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Semantic search error: %v", err), IsError: true}
	}
	if len(results) == 0 {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("No semantic matches found for: %s", query)}
	}

	var out []string
	for i, e := range results {
		out = append(out, fmt.Sprintf("[%d] (score=%.2f, %s) %s", i+1, scores[i], e.Category, truncate(e.Content, 200)))
	}
	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Semantic search results:\n%s", strings.Join(out, "\n"))}
}

func (t *knowledgeTool) handleEmbed(args map[string]any) *toolshared.ToolResult {
	id, _ := args["id"].(float64)
	if id == 0 {
		// Embed all entries without embeddings.
		entries, err := t.store.GetAllEntries()
		if err != nil {
			return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Embed error: %v", err), IsError: true}
		}
		count := 0
		for _, e := range entries {
			emb := defaultEmbedder.EmbedAndSerialize(e.Content)
			if err := t.store.SetEntryEmbedding(e.ID, emb); err == nil {
				count++
			}
		}
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Embedded %d entries", count)}
	}

	// Embed a specific entry.
	entries, err := t.store.ListEntries("", 10000)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Embed error: %v", err), IsError: true}
	}
	for _, e := range entries {
		if e.ID == int64(id) {
			emb := defaultEmbedder.EmbedAndSerialize(e.Content)
			if err := t.store.SetEntryEmbedding(e.ID, emb); err != nil {
				return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Embed error: %v", err), IsError: true}
			}
			return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Entry %d embedded", e.ID)}
		}
	}
	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Entry %d not found", int64(id)), IsError: true}
}
