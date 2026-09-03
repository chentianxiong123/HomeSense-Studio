package webdav

import (
	"homesense/alist-driver/internal/runtime"
	"strings"
	"testing"
)

func TestRemoteURLKeepsBasePathAndEscapesUnicode(t *testing.T) {
	got, err := remoteURL(runtime.MountConfig{
		Address:  "https://example.test/dav",
		RootPath: "/root",
	}, "电影/a b.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got, "https://example.test/dav/root/") {
		t.Fatalf("base path was not preserved: %s", got)
	}
	if !strings.Contains(got, "%E7%94%B5%E5%BD%B1/a%20b.txt") {
		t.Fatalf("path was not escaped as expected: %s", got)
	}
}

func TestParseMultiStatus(t *testing.T) {
	raw := []byte(`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/root/</D:href>
    <D:propstat>
      <D:prop><D:displayname>root</D:displayname><D:resourcetype><D:collection/></D:resourcetype></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/root/a.txt</D:href>
    <D:propstat>
      <D:prop><D:displayname>a.txt</D:displayname><D:getcontentlength>5</D:getcontentlength><D:getlastmodified>Tue, 09 Jun 2026 10:00:00 GMT</D:getlastmodified></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`)
	parsed, err := parseMultiStatus(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Responses) != 2 {
		t.Fatalf("unexpected response count: %d", len(parsed.Responses))
	}
	prop := parsed.Responses[1].OkProp()
	if prop.ContentLength() != 5 {
		t.Fatalf("unexpected content length: %d", prop.ContentLength())
	}
	if prop.Modified() == "" {
		t.Fatal("expected modified time")
	}
}
