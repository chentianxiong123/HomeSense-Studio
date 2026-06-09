package runtime

import (
	"errors"
	"path"
	"sort"
	"strings"
)

type ResolvedMount struct {
	Mount MountConfig
	Rel   string
}

func ResolveMount(cfg Config, rawPath string) (ResolvedMount, error) {
	cleaned := cleanVirtualPath(rawPath)
	var selected *MountConfig
	for i := range cfg.Mounts {
		mount := cfg.Mounts[i]
		if mount.Path == "/" || cleaned == mount.Path || strings.HasPrefix(cleaned, mount.Path+"/") {
			if selected == nil || len(mount.Path) > len(selected.Path) {
				selected = &mount
			}
		}
	}
	if selected == nil {
		return ResolvedMount{}, errors.New("no mount matched path")
	}
	rel := strings.TrimPrefix(cleaned, selected.Path)
	rel = strings.TrimPrefix(rel, "/")
	return ResolvedMount{Mount: *selected, Rel: rel}, nil
}

func VirtualEntries(cfg Config, rawPath string) []Entry {
	cleaned := cleanVirtualPath(rawPath)
	names := map[string]Entry{}
	for _, mount := range cfg.Mounts {
		if mount.Path == cleaned {
			continue
		}
		if !strings.HasPrefix(mount.Path, cleaned) && cleaned != "/" {
			continue
		}
		rest := strings.TrimPrefix(mount.Path, cleaned)
		rest = strings.TrimPrefix(rest, "/")
		if rest == "" {
			continue
		}
		name := strings.Split(rest, "/")[0]
		entryPath := path.Join(cleaned, name)
		if !strings.HasPrefix(entryPath, "/") {
			entryPath = "/" + entryPath
		}
		names[name] = Entry{
			Name:      name,
			Path:      cleanVirtualPath(entryPath),
			IsDir:     true,
			Driver:    "virtual",
			MountPath: cleaned,
		}
	}
	entries := make([]Entry, 0, len(names))
	for _, entry := range names {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries
}

func cleanVirtualPath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" {
		value = "/"
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return path.Clean(value)
}

func normalizeDriver(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "", "local", "file":
		return "local"
	case "webdav", "web_dav":
		return "webdav"
	default:
		return value
	}
}

func MountPaths(cfg Config) []string {
	paths := make([]string, 0, len(cfg.Mounts))
	for _, mount := range cfg.Mounts {
		paths = append(paths, mount.Path)
	}
	sort.Strings(paths)
	return paths
}
