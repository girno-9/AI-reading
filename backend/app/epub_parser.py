from __future__ import annotations

import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from io import BytesIO
from pathlib import PurePosixPath
from xml.etree import ElementTree

from app.parser import ParsedChapter, ParsedSegment, detect_character


IMAGE_MEDIA_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"}


@dataclass
class ParsedImage:
    filename: str
    data: bytes
    alt: str = ""


@dataclass
class ParsedEpubChapter:
    title: str
    segments: list[ParsedSegment]
    images: list[ParsedImage] = field(default_factory=list)


class EpubError(ValueError):
    pass


class ChapterHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self.images: list[tuple[str, str]] = []
        self._capture_stack: list[str] = []
        self._text_parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()
        if tag in {"script", "style"}:
            self._skip_depth += 1
            return
        if tag in {"p", "h1", "h2", "h3", "blockquote", "li"}:
            self._flush()
            self._capture_stack.append(tag)
        if tag == "br":
            self._text_parts.append("\n")
        if tag == "img":
            src = attrs_dict.get("src")
            if src:
                self.images.append((src, attrs_dict.get("alt", "")))

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style"} and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._capture_stack and tag == self._capture_stack[-1]:
            self._capture_stack.pop()
            self._flush()

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and self._capture_stack:
            self._text_parts.append(data)

    def _flush(self) -> None:
        text = normalize_space("".join(self._text_parts))
        if text:
            self.blocks.append(text)
        self._text_parts = []

    def close(self) -> None:
        super().close()
        self._flush()


def parse_epub(epub_bytes: bytes) -> tuple[str | None, list[ParsedEpubChapter]]:
    with zipfile.ZipFile(BytesIO(epub_bytes)) as archive:
        opf_path = find_opf_path(archive)
        opf_dir = posixpath.dirname(opf_path)
        opf_root = ElementTree.fromstring(archive.read(opf_path))
        title = read_title(opf_root)
        manifest = read_manifest(opf_root, opf_dir)
        spine = read_spine(opf_root)

        chapters: list[ParsedEpubChapter] = []
        for item_id in spine:
            item = manifest.get(item_id)
            if not item or item["media_type"] not in {"application/xhtml+xml", "text/html"}:
                continue
            chapter_path = item["path"]
            parser = ChapterHtmlParser()
            parser.feed(decode_html(archive.read(chapter_path)))
            parser.close()

            blocks = [block for block in parser.blocks if block.strip()]
            if not blocks and not parser.images:
                continue

            chapter_title = choose_chapter_title(blocks, item["href"])
            segment_blocks = blocks[1:] if blocks and blocks[0] == chapter_title else blocks
            segments = [ParsedSegment(text=block, character_name=detect_character(block)) for block in segment_blocks]
            if not segments:
                segments = [ParsedSegment(text=chapter_title, character_name="旁白")]

            images = collect_images(archive, manifest, chapter_path, parser.images)
            chapters.append(ParsedEpubChapter(title=chapter_title, segments=segments, images=images))

    if not chapters:
        raise EpubError("EPUB 中没有找到可导入的正文内容")
    return title, chapters


def find_opf_path(archive: zipfile.ZipFile) -> str:
    try:
        container = ElementTree.fromstring(archive.read("META-INF/container.xml"))
    except KeyError as exc:
        raise EpubError("EPUB 缺少 META-INF/container.xml") from exc

    rootfile = container.find(".//{*}rootfile")
    if rootfile is None or not rootfile.attrib.get("full-path"):
        raise EpubError("EPUB 没有声明 OPF 文件")
    return rootfile.attrib["full-path"]


def read_title(opf_root: ElementTree.Element) -> str | None:
    title_node = opf_root.find(".//{*}metadata/{*}title")
    if title_node is None or not title_node.text:
        return None
    return normalize_space(title_node.text)


def read_manifest(opf_root: ElementTree.Element, opf_dir: str) -> dict[str, dict[str, str]]:
    manifest: dict[str, dict[str, str]] = {}
    for item in opf_root.findall(".//{*}manifest/{*}item"):
        item_id = item.attrib.get("id")
        href = item.attrib.get("href")
        if not item_id or not href:
            continue
        manifest[item_id] = {
            "href": href,
            "path": normalize_zip_path(posixpath.join(opf_dir, href)),
            "media_type": item.attrib.get("media-type", ""),
        }
    return manifest


def read_spine(opf_root: ElementTree.Element) -> list[str]:
    return [item.attrib["idref"] for item in opf_root.findall(".//{*}spine/{*}itemref") if item.attrib.get("idref")]


def decode_html(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def choose_chapter_title(blocks: list[str], href: str) -> str:
    if blocks:
        first = blocks[0]
        if len(first) <= 80:
            return first
    stem = PurePosixPath(href).stem
    return stem or "正文"


def collect_images(
    archive: zipfile.ZipFile,
    manifest: dict[str, dict[str, str]],
    chapter_path: str,
    image_refs: list[tuple[str, str]],
) -> list[ParsedImage]:
    images: list[ParsedImage] = []
    seen: set[str] = set()
    manifest_by_path = {item["path"]: item for item in manifest.values()}
    chapter_dir = posixpath.dirname(chapter_path)

    for src, alt in image_refs:
        image_path = normalize_zip_path(posixpath.join(chapter_dir, src.split("#")[0]))
        item = manifest_by_path.get(image_path)
        if item and item["media_type"] not in IMAGE_MEDIA_TYPES:
            continue
        if image_path in seen:
            continue
        try:
            data = archive.read(image_path)
        except KeyError:
            continue
        seen.add(image_path)
        filename = PurePosixPath(image_path).name or f"image_{len(images) + 1}"
        images.append(ParsedImage(filename=safe_filename(filename), data=data, alt=alt))
    return images


def normalize_zip_path(path: str) -> str:
    return posixpath.normpath(path).lstrip("/")


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def safe_filename(filename: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", filename)
