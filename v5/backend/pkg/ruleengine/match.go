package ruleengine

import (
	"regexp"
	"strings"
)

var (
	reActionOn  = regexp.MustCompile(`(?i)(开|打开|开启|点亮)`)
	reActionOff = regexp.MustCompile(`(?i)(关|关闭|关掉|熄灭)`)
	reRoom      = regexp.MustCompile(`(?i)(客厅|起居室|堂屋|卧室|房间|卧房|厨房|灶间|卫生间|厕所|洗手间|澡堂|阳台|书房|餐厅|门厅|玄关)`)
	reDeviceLight = regexp.MustCompile(`(?i)(灯|灯光|电灯|灯具)`)
	reDeviceAC  = regexp.MustCompile(`(?i)(空调|冷气)`)
	reDeviceTV  = regexp.MustCompile(`(?i)(电视|电视机)`)
)

// Match finds the best matching rule for the given input text.
func (e *Engine) Match(input string) *MatchResult {
	input = strings.TrimSpace(input)
	if input == "" {
		return &MatchResult{Matched: false}
	}

	// Determine action
	var action string
	if reActionOn.MatchString(input) {
		action = "turn_on"
	} else if reActionOff.MatchString(input) {
		action = "turn_off"
	}
	if action == "" {
		return &MatchResult{Matched: false}
	}

	// Determine device type and room
	var deviceType string
	var deviceKeyword string
	if reDeviceLight.MatchString(input) {
		deviceType = "light"
		deviceKeyword = "灯"
	} else if reDeviceAC.MatchString(input) {
		deviceType = "ac"
		deviceKeyword = "空调"
	} else if reDeviceTV.MatchString(input) {
		deviceType = "tv"
		deviceKeyword = "电视"
	}

	if deviceType == "" {
		return &MatchResult{Matched: false}
	}

	// Find room
	var room string
	matches := reRoom.FindAllString(input, -1)
	if len(matches) > 0 {
		room = matches[0]
	} else {
		room = "客厅" // default room
	}

	// Find matching rule definition
	var bestRule *RuleDefinition
	for i := range e.ruleDefs {
		rd := &e.ruleDefs[i]
		if !rd.Enabled {
			continue
		}
		tmpl, ok := e.ruleTemplates[rd.TemplateID]
		if !ok {
			continue
		}
		// Check if template matches device type
		matchDevice := false
		for _, d := range tmpl.Devices {
			if strings.Contains(deviceKeyword, d) || strings.Contains(d, deviceKeyword) {
				matchDevice = true
				break
			}
		}
		if !matchDevice {
			continue
		}
		// Check if template has matching capability
		matchCap := false
		for _, cap := range tmpl.Capabilities {
			if cap == action {
				matchCap = true
				break
			}
		}
		if !matchCap {
			continue
		}
		if bestRule == nil || rd.Priority > bestRule.Priority {
			bestRule = rd
		}
	}

	if bestRule == nil {
		return &MatchResult{Matched: false}
	}

	tmpl := e.ruleTemplates[bestRule.TemplateID]
	return &MatchResult{
		Matched:    true,
		RuleID:     bestRule.ID,
		Device:     deviceKeyword,
		Capability: action,
		Args: map[string]string{
			"room":  room,
			"scope": room + deviceKeyword,
		},
		Description: tmpl.Description,
	}
}

// MatchSimple is a convenience function for direct matching.
func MatchSimple(input string) *MatchResult {
	return NewEngine().Match(input)
}
