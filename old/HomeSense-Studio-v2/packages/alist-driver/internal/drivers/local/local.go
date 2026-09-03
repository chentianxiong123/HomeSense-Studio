package local

import (
	"context"
	"errors"
	"fmt"
	"homesense/alist-driver/internal/runtime"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Driver struct{}

func (d Driver) List(ctx context.Context, mount runtime.MountConfig, rel string) ([]runtime.Entry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	base, err := resolvePath(mount, rel)
	if err != nil {
		return nil, err
	}
	items, err := os.ReadDir(base)
	if err != nil {
		return nil, err
	}
	entries := make([]runtime.Entry, 0, len(items))
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		info, statErr := item.Info()
		if statErr != nil {
			return nil, statErr
		}
		entryPath := runtimePathJoin(mount.Path, rel, item.Name())
		size := info.Size()
		if info.IsDir() {
			size = 0
		}
		entries = append(entries, runtime.Entry{
			Name:      item.Name(),
			Path:      entryPath,
			Size:      size,
			IsDir:     info.IsDir(),
			Modified:  formatFileTime(info.ModTime()),
			Driver:    "local",
			MountPath: mount.Path,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, nil
}

func (d Driver) Get(ctx context.Context, mount runtime.MountConfig, rel string) (runtime.Detail, error) {
	if err := ctx.Err(); err != nil {
		return runtime.Detail{}, err
	}
	fullPath, err := resolvePath(mount, rel)
	if err != nil {
		return runtime.Detail{}, err
	}
	info, err := os.Stat(fullPath)
	if err != nil {
		return runtime.Detail{}, err
	}
	size := info.Size()
	if info.IsDir() {
		size = 0
	}
	return runtime.Detail{
		Entry: runtime.Entry{
			Name:      info.Name(),
			Path:      runtimePathJoin(mount.Path, rel),
			Size:      size,
			IsDir:     info.IsDir(),
			Modified:  formatFileTime(info.ModTime()),
			Driver:    "local",
			MountPath: mount.Path,
		},
		RawURL: "file://" + filepath.ToSlash(fullPath),
	}, nil
}

func (d Driver) Open(ctx context.Context, mount runtime.MountConfig, rel string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	fullPath, err := resolvePath(mount, rel)
	if err != nil {
		return nil, err
	}
	return os.Open(fullPath)
}

func (d Driver) Put(ctx context.Context, mount runtime.MountConfig, dstRel string, name string, reader io.Reader) error {
	if mount.Readonly {
		return errors.New("mount is readonly")
	}
	if strings.TrimSpace(name) == "" || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return fmt.Errorf("invalid file name: %s", name)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	dstDir, err := resolvePath(mount, dstRel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	dst := filepath.Join(dstDir, name)
	output, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer output.Close()
	buffer := make([]byte, 1024*1024)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := reader.Read(buffer)
		if n > 0 {
			if _, writeErr := output.Write(buffer[:n]); writeErr != nil {
				return writeErr
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	return output.Sync()
}

func (d Driver) Remove(ctx context.Context, mount runtime.MountConfig, rel string) error {
	if mount.Readonly {
		return errors.New("mount is readonly")
	}
	if strings.TrimSpace(rel) == "" {
		return errors.New("refusing to remove mount root")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	fullPath, err := resolvePath(mount, rel)
	if err != nil {
		return err
	}
	return os.RemoveAll(fullPath)
}

func (d Driver) Copy(ctx context.Context, mount runtime.MountConfig, srcRel string, dstRel string) error {
	if mount.Readonly {
		return errors.New("mount is readonly")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	src, err := resolvePath(mount, srcRel)
	if err != nil {
		return err
	}
	dstDir, err := resolvePath(mount, dstRel)
	if err != nil {
		return err
	}
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	dst := filepath.Join(dstDir, info.Name())
	if strings.HasPrefix(filepath.Clean(dst), filepath.Clean(src)+string(os.PathSeparator)) {
		return errors.New("destination is inside source")
	}
	return copyPath(ctx, src, dst, info)
}

func copyPath(ctx context.Context, src string, dst string, info os.FileInfo) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if info.IsDir() {
		if err := os.MkdirAll(dst, info.Mode()); err != nil {
			return err
		}
		items, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, item := range items {
			itemInfo, err := item.Info()
			if err != nil {
				return err
			}
			if err := copyPath(ctx, filepath.Join(src, item.Name()), filepath.Join(dst, item.Name()), itemInfo); err != nil {
				return err
			}
		}
		return nil
	}
	return copyFile(ctx, src, dst, info.Mode())
}

func copyFile(ctx context.Context, src string, dst string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	input, err := os.Open(src)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer output.Close()
	buffer := make([]byte, 1024*1024)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := input.Read(buffer)
		if n > 0 {
			if _, writeErr := output.Write(buffer[:n]); writeErr != nil {
				return writeErr
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	return output.Sync()
}

func resolvePath(mount runtime.MountConfig, rel string) (string, error) {
	if strings.TrimSpace(mount.RootPath) == "" {
		return "", fmt.Errorf("local mount %s missing root_path", mount.Path)
	}
	root, err := filepath.Abs(mount.RootPath)
	if err != nil {
		return "", err
	}
	cleanRel := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(rel, "/")))
	if cleanRel == "." {
		cleanRel = ""
	}
	full := filepath.Join(root, cleanRel)
	fullAbs, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	rootWithSep := root
	if !strings.HasSuffix(rootWithSep, string(os.PathSeparator)) {
		rootWithSep += string(os.PathSeparator)
	}
	if fullAbs != root && !strings.HasPrefix(strings.ToLower(fullAbs), strings.ToLower(rootWithSep)) {
		return "", errors.New("path escapes local mount root")
	}
	return fullAbs, nil
}
