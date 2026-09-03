package webdav

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"homesense/alist-driver/internal/runtime"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

type Driver struct {
	client http.Client
}

func (d Driver) List(ctx context.Context, mount runtime.MountConfig, rel string) ([]runtime.Entry, error) {
	targetURL, err := remoteURL(mount, rel)
	if err != nil {
		return nil, err
	}
	status, body, err := d.propfind(ctx, mount, targetURL, "1")
	if err != nil {
		return nil, err
	}
	if status != http.StatusMultiStatus {
		return nil, fmt.Errorf("webdav propfind failed: %d", status)
	}
	parsed, err := parseMultiStatus(body)
	if err != nil {
		return nil, err
	}
	entries := make([]runtime.Entry, 0, len(parsed.Responses))
	for _, response := range parsed.Responses {
		if sameRemotePath(targetURL, response.Href) {
			continue
		}
		prop := response.OkProp()
		name := responseName(response.Href, prop.DisplayName)
		if name == "" {
			continue
		}
		entries = append(entries, runtime.Entry{
			Name:      name,
			Path:      virtualPath(mount.Path, rel, name),
			Size:      prop.ContentLength(),
			IsDir:     prop.ResourceType.IsCollection(),
			Modified:  prop.Modified(),
			Driver:    "webdav",
			MountPath: mount.Path,
		})
	}
	return entries, nil
}

func (d Driver) Get(ctx context.Context, mount runtime.MountConfig, rel string) (runtime.Detail, error) {
	targetURL, err := remoteURL(mount, rel)
	if err != nil {
		return runtime.Detail{}, err
	}
	status, body, err := d.propfind(ctx, mount, targetURL, "0")
	if err != nil {
		return runtime.Detail{}, err
	}
	if status != http.StatusMultiStatus {
		return runtime.Detail{}, fmt.Errorf("webdav propfind failed: %d", status)
	}
	parsed, err := parseMultiStatus(body)
	if err != nil {
		return runtime.Detail{}, err
	}
	if len(parsed.Responses) == 0 {
		return runtime.Detail{}, errors.New("webdav object not found")
	}
	prop := parsed.Responses[0].OkProp()
	name := responseName(parsed.Responses[0].Href, prop.DisplayName)
	if name == "" {
		name = path.Base(strings.TrimSuffix(rel, "/"))
	}
	return runtime.Detail{
		Entry: runtime.Entry{
			Name:      name,
			Path:      virtualPath(mount.Path, rel),
			Size:      prop.ContentLength(),
			IsDir:     prop.ResourceType.IsCollection(),
			Modified:  prop.Modified(),
			Driver:    "webdav",
			MountPath: mount.Path,
		},
		RawURL: targetURL,
	}, nil
}

func (d Driver) Open(ctx context.Context, mount runtime.MountConfig, rel string) (io.ReadCloser, error) {
	targetURL, err := remoteURL(mount, rel)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, err
	}
	applyAuth(req, mount)
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, fmt.Errorf("webdav get failed: %d", resp.StatusCode)
	}
	return resp.Body, nil
}

func (d Driver) Put(ctx context.Context, mount runtime.MountConfig, dstRel string, name string, reader io.Reader) error {
	if mount.Readonly {
		return errors.New("mount is readonly")
	}
	if strings.TrimSpace(name) == "" || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return fmt.Errorf("invalid file name: %s", name)
	}
	if err := d.ensureDir(ctx, mount, dstRel); err != nil {
		return err
	}
	targetURL, err := remoteURL(mount, path.Join(dstRel, name))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, targetURL, reader)
	if err != nil {
		return err
	}
	applyAuth(req, mount)
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webdav put failed: %d", resp.StatusCode)
	}
	return nil
}

func (d Driver) Remove(ctx context.Context, mount runtime.MountConfig, rel string) error {
	if mount.Readonly {
		return errors.New("mount is readonly")
	}
	if strings.TrimSpace(rel) == "" {
		return errors.New("refusing to remove mount root")
	}
	targetURL, err := remoteURL(mount, rel)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, targetURL, nil)
	if err != nil {
		return err
	}
	applyAuth(req, mount)
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webdav delete failed: %d", resp.StatusCode)
	}
	return nil
}

func (d Driver) Copy(ctx context.Context, mount runtime.MountConfig, srcRel string, dstRel string) error {
	if mount.Readonly {
		return errors.New("mount is readonly")
	}
	srcURL, err := remoteURL(mount, srcRel)
	if err != nil {
		return err
	}
	name := path.Base(strings.TrimSuffix(srcRel, "/"))
	dstURL, err := remoteURL(mount, path.Join(dstRel, name))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "COPY", srcURL, nil)
	if err != nil {
		return err
	}
	applyAuth(req, mount)
	req.Header.Set("Destination", dstURL)
	req.Header.Set("Overwrite", "T")
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webdav copy failed: %d", resp.StatusCode)
	}
	return nil
}

func (d Driver) propfind(ctx context.Context, mount runtime.MountConfig, targetURL string, depth string) (int, []byte, error) {
	body := bytes.NewBufferString(`<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><allprop/></propfind>`)
	req, err := http.NewRequestWithContext(ctx, "PROPFIND", targetURL, body)
	if err != nil {
		return 0, nil, err
	}
	applyAuth(req, mount)
	req.Header.Set("Depth", depth)
	req.Header.Set("Content-Type", `application/xml; charset="utf-8"`)
	resp, err := d.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(resp.Body)
	return resp.StatusCode, raw, readErr
}

func (d Driver) ensureDir(ctx context.Context, mount runtime.MountConfig, rel string) error {
	rel = strings.Trim(strings.ReplaceAll(rel, "\\", "/"), "/")
	if rel == "" {
		return nil
	}
	parts := strings.Split(rel, "/")
	current := ""
	for _, part := range parts {
		if part == "" {
			continue
		}
		current = path.Join(current, part)
		targetURL, err := remoteURL(mount, current)
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, "MKCOL", targetURL, nil)
		if err != nil {
			return err
		}
		applyAuth(req, mount)
		resp, err := d.client.Do(req)
		if err != nil {
			return err
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusMethodNotAllowed || resp.StatusCode == http.StatusConflict {
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("webdav mkcol failed: %d", resp.StatusCode)
		}
	}
	return nil
}

func applyAuth(req *http.Request, mount runtime.MountConfig) {
	if mount.Username != "" || mount.Password != "" {
		req.SetBasicAuth(mount.Username, mount.Password)
	}
}

func remoteURL(mount runtime.MountConfig, rel string) (string, error) {
	if strings.TrimSpace(mount.Address) == "" {
		return "", errors.New("webdav mount missing address")
	}
	parsed, err := url.Parse(mount.Address)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("webdav address must include scheme and host")
	}
	joined := path.Join(parsed.Path, mount.RootPath, rel)
	if strings.HasSuffix(rel, "/") && !strings.HasSuffix(joined, "/") {
		joined += "/"
	}
	if !strings.HasPrefix(joined, "/") {
		joined = "/" + joined
	}
	parsed.Path = joined
	return parsed.String(), nil
}

func virtualPath(mountPath string, parts ...string) string {
	all := append([]string{mountPath}, parts...)
	joined := path.Join(all...)
	if !strings.HasPrefix(joined, "/") {
		joined = "/" + joined
	}
	return path.Clean(joined)
}

func sameRemotePath(targetURL string, href string) bool {
	target, targetErr := url.Parse(targetURL)
	hrefURL, hrefErr := url.Parse(href)
	if targetErr != nil || hrefErr != nil {
		return false
	}
	targetPath := strings.TrimSuffix(target.EscapedPath(), "/")
	hrefPath := strings.TrimSuffix(hrefURL.EscapedPath(), "/")
	return targetPath == hrefPath
}

func responseName(href string, displayName string) string {
	if strings.TrimSpace(displayName) != "" {
		return displayName
	}
	parsed, err := url.Parse(href)
	if err != nil {
		return ""
	}
	name, err := url.PathUnescape(path.Base(strings.TrimSuffix(parsed.Path, "/")))
	if err != nil {
		return path.Base(strings.TrimSuffix(parsed.Path, "/"))
	}
	return name
}

type multiStatus struct {
	Responses []webdavResponse `xml:"response"`
}

type webdavResponse struct {
	Href     string        `xml:"href"`
	Propstat []webdavProps `xml:"propstat"`
}

type webdavProps struct {
	Status string     `xml:"status"`
	Prop   webdavProp `xml:"prop"`
}

type webdavProp struct {
	DisplayName      string             `xml:"displayname"`
	GetContentLength string             `xml:"getcontentlength"`
	GetLastModified  string             `xml:"getlastmodified"`
	ResourceType     webdavResourceType `xml:"resourcetype"`
}

type webdavResourceType struct {
	Collection *struct{} `xml:"collection"`
}

func parseMultiStatus(raw []byte) (multiStatus, error) {
	var parsed multiStatus
	if err := xml.Unmarshal(raw, &parsed); err != nil {
		return multiStatus{}, err
	}
	return parsed, nil
}

func (r webdavResponse) OkProp() webdavProp {
	for _, propstat := range r.Propstat {
		if strings.Contains(propstat.Status, " 200 ") {
			return propstat.Prop
		}
	}
	if len(r.Propstat) > 0 {
		return r.Propstat[0].Prop
	}
	return webdavProp{}
}

func (p webdavProp) ContentLength() int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(p.GetContentLength), 10, 64)
	if err != nil {
		return 0
	}
	return value
}

func (p webdavProp) Modified() string {
	if strings.TrimSpace(p.GetLastModified) == "" {
		return ""
	}
	parsed, err := http.ParseTime(p.GetLastModified)
	if err != nil {
		return p.GetLastModified
	}
	return parsed.Format(time.RFC3339)
}

func (r webdavResourceType) IsCollection() bool {
	return r.Collection != nil
}
