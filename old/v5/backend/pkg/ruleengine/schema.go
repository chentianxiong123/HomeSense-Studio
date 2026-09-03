package ruleengine

// SynonymGroup represents a group of synonyms for a concept.
type SynonymGroup struct {
	ID       string   `json:"id"`
	Keywords []string `json:"keywords"`
}

// RuleTemplate defines a pattern for matching user intents.
type RuleTemplate struct {
	ID           string   `json:"id"`
	Pattern      string   `json:"pattern"`
	Devices      []string `json:"devices"`
	Capabilities []string `json:"capabilities"`
	Description  string   `json:"description"`
}

// RuleDefinition is an enabled rule instance.
type RuleDefinition struct {
	ID         string `json:"id"`
	TemplateID string `json:"template_id"`
	Enabled    bool   `json:"enabled"`
	Priority   int    `json:"priority"`
}

// Engine holds the rule engine state.
type Engine struct {
	synonymGroups map[string][]string
	ruleTemplates map[string]RuleTemplate
	ruleDefs      []RuleDefinition
}

// NewEngine creates a new Engine with default rules.
func NewEngine() *Engine {
	e := &Engine{
		synonymGroups: make(map[string][]string),
		ruleTemplates: make(map[string]RuleTemplate),
	}
	e.initDefaults()
	return e
}

func (e *Engine) initDefaults() {
	// 房间同义词组
	e.synonymGroups["room"] = []string{
		"客厅", "起居室", "堂屋",
		"卧室", "房间", "卧房",
		"厨房", "灶间",
		"卫生间", "厕所", "洗手间", "澡堂",
		"阳台", "书房", "餐厅", "门厅", "玄关",
	}

	// 设备同义词组
	e.synonymGroups["device_light"] = []string{
		"灯", "灯光", "电灯", "灯具",
	}
	e.synonymGroups["device_ac"] = []string{
		"空调", "冷气",
	}
	e.synonymGroups["device_tv"] = []string{
		"电视", "电视机",
	}

	// 动作同义词组
	e.synonymGroups["action_on"] = []string{
		"开", "打开", "开启", "点亮",
	}
	e.synonymGroups["action_off"] = []string{
		"关", "关闭", "关掉", "熄灭",
	}

	// 默认规则模板
	e.ruleTemplates["light_control"] = RuleTemplate{
		ID:           "light_control",
		Pattern:      "{action} {room} {device}",
		Devices:      e.synonymGroups["device_light"],
		Capabilities: []string{"turn_on", "turn_off"},
		Description:  "灯光控制",
	}
	e.ruleTemplates["ac_control"] = RuleTemplate{
		ID:           "ac_control",
		Pattern:      "{action} {room} {device}",
		Devices:      e.synonymGroups["device_ac"],
		Capabilities: []string{"turn_on", "turn_off"},
		Description:  "空调控制",
	}
	e.ruleTemplates["tv_control"] = RuleTemplate{
		ID:           "tv_control",
		Pattern:      "{action} {device}",
		Devices:      e.synonymGroups["device_tv"],
		Capabilities: []string{"turn_on", "turn_off"},
		Description:  "电视控制",
	}

	// 默认规则定义
	e.ruleDefs = []RuleDefinition{
		{ID: "r1", TemplateID: "light_control", Enabled: true, Priority: 100},
		{ID: "r2", TemplateID: "ac_control", Enabled: true, Priority: 90},
		{ID: "r3", TemplateID: "tv_control", Enabled: true, Priority: 80},
	}
}

// MatchResult holds the result of a rule match.
type MatchResult struct {
	Matched     bool              `json:"matched"`
	RuleID      string            `json:"rule_id,omitempty"`
	Device      string            `json:"device,omitempty"`
	Capability  string            `json:"capability,omitempty"`
	Args        map[string]string `json:"args,omitempty"`
	Description string            `json:"description,omitempty"`
}

func (r *MatchResult) Success() bool {
	return r.Matched && r.Device != "" && r.Capability != ""
}
