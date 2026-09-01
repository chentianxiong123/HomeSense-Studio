package alist

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type LocalDriver struct{}

func (d LocalDriver) List(vpath string, rel string) ([]Entry, error) {
	mount, r, err := resolveMountFromPath(vpath, rel)
	if err != nil {
		return nil, err
	}
	base, err := resolveLocalPath(mount, r)
	if err != nil {
		return nil, err
	}
	items, err := os.ReadDir(base)
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(items))
	for _, item := range items {
		info, err := item.Info()
		if err != nil {
			continue
		}
		entryPath := filepath.ToSlash(filepath.Join(mount.Path, r, item.Name()))
		if !strings.HasPrefix(entryPath, "/") {
			entryPath = "/" + entryPath
		}
		size := info.Size()
		if info.IsDir() {
			size = 0
		}
		entries = append(entries, Entry{
			Name:      item.Name(),
			Path:      filepath.Clean(entryPath),
			Size:      size,
			IsDir:     info.IsDir(),
			Modified:  formatTime(info.ModTime()),
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

func resolveMountFromPath(vpath string, rel string) (MountConfig, string, error) {
	cfg, err := readConfig()
	if err != nil {
		return MountConfig{}, "", fmt.Errorf("config not found: %v", err)
	}
	return resolveMount(cfg, filepath.Join(vpath, rel))
}

func resolveLocalPath(mount MountConfig, rel string) (string, error) {
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

func (d LocalDriver) Get(vpath string, rel string) (Detail, error) {
	mount, r, err := resolveMountFromPath(vpath, rel)
	if err != nil {
		return Detail{}, err
	}
	fullPath, err := resolveLocalPath(mount, r)
	if err != nil {
		return Detail{}, err
	}
	info, err := os.Stat(fullPath)
	if err != nil {
		return Detail{}, err
	}
	size := info.Size()
	if info.IsDir() {
		size = 0
	}
	return Detail{
		Entry: Entry{
			Name:      info.Name(),
			Path:      filepath.ToSlash(filepath.Join(mount.Path, r)),
			Size:      size,
			IsDir:     info.IsDir(),
			Modified:  formatTime(info.ModTime()),
			Driver:    "local",
			MountPath: mount.Path,
		},
		RawURL: "file://" + filepath.ToSlash(fullPath),
	}, nil
}

func (d LocalDriver) Remove(vpath string, rel string) error {
	mount, r, err := resolveMountFromPath(vpath, rel)
	if err != nil {
		return err
	}
	if mount.Readonly {
		return errors.New("mount is readonly")
	}
	if strings.TrimSpace(r) == "" {
		return errors.New("refusing to remove mount root")
	}
	fullPath, err := resolveLocalPath(mount, r)
	if err != nil {
		return err
	}
	return os.RemoveAll(fullPath)
}

func (d LocalDriver) Copy(srcVPath string, srcRel string, dstVPath string, dstRel string) error {
	srcMount, srcR, err := resolveMountFromPath(srcVPath, srcRel)
	if err != nil {
		return err
	}
	dstMount, dstR, err := resolveMountFromPath(dstVPath, dstRel)
	if err != nil {
		return err
	}
	if srcMount.Readonly {
		return errors.New("source mount is readonly")
	}
	srcPath, err := resolveLocalPath(srcMount, srcR)
	if err != nil {
		return err
	}
	dstDir, err := resolveLocalPath(dstMount, dstR)
	if err != nil {
		return err
	}
	info, err := os.Stat(srcPath)
	if err != nil {
		return err
	}
	dst := filepath.Join(dstDir, info.Name())
	srcClean, _ := filepath.Abs(srcPath)
	dstClean, _ := filepath.Abs(dst)
	if strings.HasPrefix(dstClean, srcClean+string(os.PathSeparator)) {
		return errors.New("destination is inside source")
	}
	return copyPath(srcClean, dstClean, info)
}

func copyPath(src string, dst string, info os.FileInfo) error {
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
				continue
			}
			if err := copyPath(filepath.Join(src, item.Name()), filepath.Join(dst, item.Name()), itemInfo); err != nil {
				return err
			}
		}
		return nil
	}
	return copyFile(src, dst, info.Mode())
}

func copyFile(src string, dst string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
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
