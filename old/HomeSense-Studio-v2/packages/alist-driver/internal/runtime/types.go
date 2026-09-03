package runtime

import "time"

type Config struct {
	Mounts []MountConfig `json:"mounts"`
}

type MountConfig struct {
	Path        string `json:"path"`
	Driver      string `json:"driver"`
	Label       string `json:"label,omitempty"`
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

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
