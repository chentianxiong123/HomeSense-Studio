package runtime

import (
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"strings"
)

func LoadConfig(fs *flag.FlagSet) (Config, error) {
	configText := fs.Lookup("config")
	configFile := fs.Lookup("config-file")

	if configText != nil && strings.TrimSpace(configText.Value.String()) != "" {
		return parseConfig([]byte(configText.Value.String()))
	}

	if configFile != nil && strings.TrimSpace(configFile.Value.String()) != "" {
		raw, err := os.ReadFile(configFile.Value.String())
		if err != nil {
			return Config{}, err
		}
		return parseConfig(raw)
	}

	stat, err := os.Stdin.Stat()
	if err == nil && stat.Mode()&os.ModeCharDevice == 0 {
		raw, readErr := io.ReadAll(os.Stdin)
		if readErr != nil {
			return Config{}, readErr
		}
		if strings.TrimSpace(string(raw)) != "" {
			return parseConfig(raw)
		}
	}

	return Config{}, errors.New("alist-driver config is required")
}

func parseConfig(raw []byte) (Config, error) {
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, err
	}
	for i := range cfg.Mounts {
		cfg.Mounts[i].Path = cleanVirtualPath(cfg.Mounts[i].Path)
		cfg.Mounts[i].Driver = normalizeDriver(cfg.Mounts[i].Driver)
	}
	return cfg, nil
}
