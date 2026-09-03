import html
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin


@dataclass
class LinkCandidate:
    title: str
    url: str
    snippet: str = ""
    cover: str = ""


class AnchorParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links: list[LinkCandidate] = []
        self._active_href: str | None = None
        self._active_text: list[str] = []
        self._active_img = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        attrs_map = {name.lower(): value or "" for name, value in attrs}
        if tag.lower() == "a":
            href = attrs_map.get("href", "").strip()
            if href and not href.startswith(("javascript:", "mailto:", "#")):
                self._active_href = urljoin(self.base_url, href)
                self._active_text = []
                self._active_img = ""
        elif tag.lower() == "img" and self._active_href:
            src = attrs_map.get("src") or attrs_map.get("data-src") or attrs_map.get("data-original") or ""
            if src and not self._active_img:
                self._active_img = urljoin(self.base_url, src)

    def handle_data(self, data: str):
        if self._active_href:
            text = data.strip()
            if text:
                self._active_text.append(text)

    def handle_endtag(self, tag: str):
        if tag.lower() != "a" or not self._active_href:
            return
        title = " ".join(self._active_text).strip()
        self.links.append(LinkCandidate(title=html.unescape(title), url=self._active_href, cover=self._active_img))
        self._active_href = None
        self._active_text = []
        self._active_img = ""


class PageMetadataParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.title = ""
        self.meta: dict[str, str] = {}
        self.media_urls: list[dict[str, str]] = []
        self.json_ld_blocks: list[str] = []
        self._in_title = False
        self._title_parts: list[str] = []
        self._script_type = ""
        self._script_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        tag_name = tag.lower()
        attrs_map = {name.lower(): value or "" for name, value in attrs}
        if tag_name == "title":
            self._in_title = True
            self._title_parts = []
            return
        if tag_name == "script":
            self._script_type = attrs_map.get("type", "").lower()
            self._script_parts = []
            return
        if tag_name == "meta":
            key = attrs_map.get("property") or attrs_map.get("name")
            content = attrs_map.get("content", "").strip()
            if key and content:
                self.meta[key.lower()] = html.unescape(content)
            return
        if tag_name == "link":
            rel = attrs_map.get("rel", "").lower()
            href = attrs_map.get("href", "").strip()
            if href and ("image_src" in rel or "apple-touch-icon" in rel or "icon" in rel):
                self.meta.setdefault("link:image", urljoin(self.base_url, href))
            return
        if tag_name in {"video", "audio", "source", "iframe", "embed"}:
            src = attrs_map.get("src", "").strip()
            if src:
                self.media_urls.append({
                    "url": urljoin(self.base_url, src),
                    "tag": tag_name,
                    "mime_type": attrs_map.get("type", "").strip(),
                })
            poster = attrs_map.get("poster", "").strip()
            if poster:
                self.meta.setdefault("poster", urljoin(self.base_url, poster))

    def handle_data(self, data: str):
        if self._in_title:
            text = data.strip()
            if text:
                self._title_parts.append(text)
        if self._script_type == "application/ld+json":
            self._script_parts.append(data)

    def handle_endtag(self, tag: str):
        tag_name = tag.lower()
        if tag_name == "title":
            self.title = html.unescape(" ".join(self._title_parts).strip())
            self._in_title = False
            self._title_parts = []
        elif tag_name == "script":
            if self._script_type == "application/ld+json":
                block = "".join(self._script_parts).strip()
                if block:
                    self.json_ld_blocks.append(block)
            self._script_type = ""
            self._script_parts = []
