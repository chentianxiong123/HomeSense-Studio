package alist

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Config struct {
	Mounts []MountConfig `json:"mounts"`
}

type MountConfig struct {
	Path        string `json:"path"`
	Driver      string `json:"driver"`
	RootPath    string `json:"root_path,omitempty"`
	Address     string `json:"address,omitempty"`
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
	Credentials string `json:"credentials,omitempty"`
	Readonly    bool   `json:"readonly,omitempty"`
}

type Entry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	IsDir     bool   `json:"is_dir"`
	Modified  string `json:"modified,omitempty"`
	Driver    string `json:"driver"`
	MountPath string `json:"mount_path"`
}

type Detail struct {
	Entry
	RawURL string `json:"raw_url,omitempty"`
}

type ListResult struct {
	Path      string  `json:"path"`
	Provider  string  `json:"provider"`
	MountPath string  `json:"mount_path"`
	Entries   []Entry `json:"entries"`
	Total     int     `json:"total"`
}

type HealthResult struct {
	Status    string   `json:"status"`
	Version   string   `json:"version"`
	Drivers   []string `json:"drivers"`
	Mounts    []string `json:"mounts"`
	StartedAt string   `json:"started_at"`
}

type CapabilityRequest struct {
	Action string `json:"action"`
	Path   string `json:"path,omitempty"`
	Dir    string `json:"dir,omitempty"`
	SrcDir string `json:"src_dir,omitempty"`
	DstDir string `json:"dst_dir,omitempty"`
	Names  []string `json:"names,omitempty"`
	Config []MountConfig `json:"config,omitempty"`
}

const version = "v5-alist-driver-0.1.0"
const configFile = "~/.homesense/alist/config.json"

func configDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".homesense", "alist")
}

func configFilePath() string {
	return filepath.Join(configDir(), "config.json")
}

func writeConfig(cfg Config) error {
	os.MkdirAll(configDir(), 0o755)
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configFilePath(), b, 0o644)
}

func readConfig() (Config, error) {
	b, err := os.ReadFile(configFilePath())
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return Config{}, err
	}
	for i := range cfg.Mounts {
		cfg.Mounts[i].Path = cleanVirtualPath(cfg.Mounts[i].Path)
		cfg.Mounts[i].Driver = normalizeDriver(cfg.Mounts[i].Driver)
	}
	return cfg, nil
}

type Driver interface {
	List(vpath string, rel string) ([]Entry, error)
	Get(vpath string, rel string) (Detail, error)
	Remove(vpath string, rel string) error
	Copy(srcVPath string, srcRel string, dstVPath string, dstRel string) error
}

type Registry struct {
	mu     sync.RWMutex
	drivers map[string]Driver
}

func NewRegistry() *Registry {
	return &Registry{drivers: map[string]Driver{}}
}

func (r *Registry) Register(name string, d Driver) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.drivers[name] = d
}

func (r *Registry) Get(name string) (Driver, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	d, ok := r.drivers[name]
	return d, ok
}

func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.drivers))
	for n := range r.drivers {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

func cleanVirtualPath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" {
		value = "/"
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return filepath.Clean(value)
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

func resolveMount(cfg Config, rawPath string) (MountConfig, string, error) {
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
		return MountConfig{}, "", fmt.Errorf("no mount matched path: %s", rawPath)
	}
	rel := strings.TrimPrefix(cleaned, selected.Path)
	rel = strings.TrimPrefix(rel, "/")
	return *selected, rel, nil
}

func mountPaths(cfg Config) []string {
	paths := make([]string, 0, len(cfg.Mounts))
	for _, m := range cfg.Mounts {
		paths = append(paths, m.Path)
	}
	sort.Strings(paths)
	return paths
}

func virtualEntries(cfg Config, rawPath string) []Entry {
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
		entryPath := filepath.Join(cleaned, name)
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
	for _, e := range names {
		entries = append(entries, e)
	}
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries
}

func classifyError(err error) (string, string) {
	if err == nil {
		return "success", ""
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "unauthorized") || strings.Contains(msg, "401") {
		return "error", "UNAUTHORIZED"
	}
	if strings.Contains(msg, "forbidden") || strings.Contains(msg, "403") {
		return "error", "FORBIDDEN"
	}
	if strings.Contains(msg, "not found") || strings.Contains(msg, "404") ||
		strings.Contains(msg, "no such file") {
		return "error", "NOT_FOUND"
	}
	if strings.Contains(msg, "timeout") || strings.Contains(msg, "connection") {
		return "error", "NETWORK_ERROR"
	}
	if strings.Contains(msg, "readonly") || strings.Contains(msg, "permission") {
		return "error", "FORBIDDEN"
	}
	return "error", "ALIST_DRIVER_ERROR"
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
