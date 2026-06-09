package main

import (
	"context"
	"homesense/alist-driver/internal/runtime"
	"os"
	"path/filepath"
	"testing"
)

func TestHealthIncludesRegisteredDrivers(t *testing.T) {
	data, err := run(context.Background(), buildRegistry(), runtime.Config{}, "health", actionInput{})
	if err != nil {
		t.Fatalf("health failed: %v", err)
	}
	health := data.(runtime.HealthResult)
	if health.Status != "ok" {
		t.Fatalf("unexpected status: %s", health.Status)
	}
	if !contains(health.Drivers, "local") || !contains(health.Drivers, "webdav") {
		t.Fatalf("expected local and webdav drivers, got %#v", health.Drivers)
	}
}

func TestVirtualMountList(t *testing.T) {
	cfg := runtime.Config{Mounts: []runtime.MountConfig{
		{Path: "/cloud/a", Driver: "local", RootPath: t.TempDir()},
		{Path: "/local/b", Driver: "local", RootPath: t.TempDir()},
	}}
	data, err := run(context.Background(), buildRegistry(), cfg, "list", actionInput{Path: "/"})
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	list := data.(runtime.ListResult)
	if list.Provider != "virtual" {
		t.Fatalf("expected virtual provider, got %s", list.Provider)
	}
	if len(list.Entries) != 2 {
		t.Fatalf("expected two virtual entries, got %#v", list.Entries)
	}
}

func TestCrossMountLocalFileCopy(t *testing.T) {
	root := t.TempDir()
	srcRoot := filepath.Join(root, "src")
	dstRoot := filepath.Join(root, "dst")
	if err := os.MkdirAll(srcRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dstRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcRoot, "a.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	cfg := runtime.Config{Mounts: []runtime.MountConfig{
		{Path: "/src", Driver: "local", RootPath: srcRoot},
		{Path: "/dst", Driver: "local", RootPath: dstRoot},
	}}
	_, err := run(context.Background(), buildRegistry(), cfg, "copy", actionInput{
		SrcDir: "/src",
		DstDir: "/dst",
		Names:  `["a.txt"]`,
	})
	if err != nil {
		t.Fatalf("copy failed: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dstRoot, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "hello" {
		t.Fatalf("unexpected copied content: %q", string(raw))
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
