package local

import (
	"path"
	"strings"
)

func runtimePathJoin(parts ...string) string {
	joined := path.Join(parts...)
	if !strings.HasPrefix(joined, "/") {
		joined = "/" + joined
	}
	return path.Clean(joined)
}
