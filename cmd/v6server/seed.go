// Workspace seeding for new users. Copies the persona (SOUL.md / AGENT.md) and
// skills from the packaged corpus into a freshly registered user's workspace,
// mirroring the approach used by cmd/usersim so a tenant starts with a coherent
// agent definition.

package main

import (
	"os"
	"path/filepath"
)

// seedWorkspaceFiles copies corpus persona + skills into the user workspace.
func seedWorkspaceFiles(wsDir, corpusDir string) error {
	if corpusDir == "" {
		return nil
	}
	for _, name := range []string{"SOUL.md", "AGENT.md"} {
		src := filepath.Join(corpusDir, name)
		if b, err := os.ReadFile(src); err == nil {
			if err := os.WriteFile(filepath.Join(wsDir, name), b, 0o644); err != nil {
				return err
			}
		}
	}
	skillsSrc := filepath.Join(corpusDir, "skills")
	st, err := os.Stat(skillsSrc)
	if err != nil || !st.IsDir() {
		return nil
	}
	dst := filepath.Join(wsDir, "skills")
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(skillsSrc)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		md := filepath.Join(skillsSrc, e.Name(), "SKILL.md")
		b, err := os.ReadFile(md)
		if err != nil {
			continue
		}
		d := filepath.Join(dst, e.Name())
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(d, "SKILL.md"), b, 0o644); err != nil {
			return err
		}
	}
	return nil
}
