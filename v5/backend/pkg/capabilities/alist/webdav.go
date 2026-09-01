package alist

import (
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

type WebDAVDriver struct {
	client http.Client
}

type propfindResult struct {
	Responses []response `xml:"*//http://ns.webdav.org/dav:response"`
}

type response struct {
	Href  string `xml:"http://ns.webdav.org/dav:href"`
	Prop  propstat
}

type propstat struct {
	Prop multiProps `xml:"http://ns.webdav.org/dav:prop"`
}

type multiProps struct {
	DisplayName string `xml:"http://ns.webdav.org/dav:displayname"`
	ResourceType string `xml:"http://ns.webdav.org/dav:resourcetype"`
	ContentLength string `xml:"http://ns.webdav.org/dav:getcontentlength"`
	LastModified string `xml:"http://ns.webdav.org/dav:getlastmodified"`
}

func (d WebDAVDriver) List(vpath string, rel string) ([]Entry, error) {
	cfg, err := readConfig()
	if err != nil {
		return nil, err
	}
	mount, r, err := resolveMount(cfg, vpath)
	if err != nil {
		return nil, err
	}
	targetURL := mount.Address + "/" + strings.TrimPrefix(r, "/")
	if targetURL == "" || targetURL == "/" {
		targetURL = mount.Address
	}
	status, body, err := d.propfind(targetURL, "1")
	if err != nil {
		return nil, err
	}
	if status != http.StatusMultiStatus {
		return nil, fmt.Errorf("webdav propfind failed: %d", status)
	}
	parsed, err := parsePropfind(body)
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(parsed.Responses))
	for _, resp := range parsed.Responses {
		name := parseResponseName(resp.Href, mount.Path, r)
		if name == "" {
			continue
		}
		entries = append(entries, Entry{
			Name:      name,
			Path:      mount.Path + "/" + name,
			IsDir:     isCollection(resp),
			Modified:  parseModified(resp),
			Driver:    "webdav",
			MountPath: mount.Path,
		})
	}
	return entries, nil
}

func (d WebDAVDriver) Get(vpath string, rel string) (Detail, error) {
	cfg, err := readConfig()
	if err != nil {
		return Detail{}, err
	}
	mount, r, err := resolveMount(cfg, vpath)
	if err != nil {
		return Detail{}, err
	}
	targetURL := mount.Address + "/" + strings.TrimPrefix(r, "/")
	if targetURL == "" {
		targetURL = mount.Address
	}
	status, body, err := d.propfind(targetURL, "0")
	if err != nil {
		return Detail{}, err
	}
	if status != http.StatusMultiStatus {
		return Detail{}, fmt.Errorf("webdav propfind failed: %d", status)
	}
	parsed, err := parsePropfind(body)
	if err != nil {
		return Detail{}, err
	}
	if len(parsed.Responses) == 0 {
		return Detail{}, fmt.Errorf("webdav object not found")
	}
	resp := parsed.Responses[0]
	name := parseResponseName(resp.Href, mount.Path, r)
	size := parseInt64(parsePropContentLength(resp))
	return Detail{
		Entry: Entry{
			Name:      name,
			Path:      mount.Path + "/" + name,
			Size:      size,
			IsDir:     isCollection(resp),
			Modified:  parseModified(resp),
			Driver:    "webdav",
			MountPath: mount.Path,
		},
		RawURL: targetURL,
	}, nil
}

func (d WebDAVDriver) Remove(vpath string, rel string) error {
	cfg, err := readConfig()
	if err != nil {
		return err
	}
	mount, r, err := resolveMount(cfg, vpath)
	if err != nil {
		return err
	}
	if mount.Readonly {
		return fmt.Errorf("webdav mount is readonly")
	}
	targetURL := mount.Address + "/" + strings.TrimPrefix(r, "/")
	req, _ := http.NewRequest("DELETE", targetURL, nil)
	req.SetBasicAuth(mount.Username, mount.Password)
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("webdav delete failed: %d %s", resp.StatusCode, string(body))
	}
	return nil
}

func (d WebDAVDriver) Copy(vpath string, srcRel string, dstVPath string, dstRel string) error {
	return fmt.Errorf("webdav copy not implemented")
}

func (d WebDAVDriver) propfind(targetURL, depth string) (int, []byte, error) {
	req, _ := http.NewRequest("PROPFIND", targetURL, nil)
	req.Header.Set("Depth", depth)
	req.Header.Set("Content-Type", "application/xml")
	if d.client.Jar == nil {
		d.client.Jar, _ = cookiejar.New(nil)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, body, nil
}

func parsePropfind(body []byte) (propfindResult, error) {
	var result propfindResult
	if err := xml.Unmarshal(body, &result); err != nil {
		return propfindResult{}, err
	}
	return result, nil
}

func parseResponseName(href, mountPath, rel string) string {
	parsed, err := url.Parse(href)
	if err != nil {
		return ""
	}
	name := parsed.Path
	name = strings.TrimPrefix(name, mountPath)
	name = strings.TrimPrefix(name, "/")
	name = strings.TrimPrefix(name, rel)
	name = strings.TrimPrefix(name, "/")
	parts := strings.Split(name, "/")
	if len(parts) > 0 && parts[0] != "" {
		return parts[0]
	}
	return ""
}

func isCollection(resp response) bool {
	return strings.Contains(resp.Prop.Prop.ResourceType, "collection") ||
		strings.Contains(resp.Prop.Prop.ResourceType, "container")
}

func parseModified(resp response) string {
	if t, err := time.Parse(time.RFC1123, resp.Prop.Prop.LastModified); err == nil {
		return t.Format(time.RFC3339)
	}
	return resp.Prop.Prop.LastModified
}

func parsePropContentLength(resp response) string {
	return resp.Prop.Prop.ContentLength
}

func parseInt64(s string) int64 {
	var n int64
	fmt.Sscanf(s, "%d", &n)
	return n
}
