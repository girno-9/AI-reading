import re
from dataclasses import dataclass


CHAPTER_RE = re.compile(
    r"^\s*(第[一二三四五六七八九十百千万零〇\d]+[章节回卷部集篇].*|Chapter\s+\d+.*|#{1,3}\s+.+)\s*$",
    re.IGNORECASE,
)
SPEAKER_RE = re.compile(
    r"^\s*([\u4e00-\u9fa5A-Za-z0-9_·]{1,12}?)(?:低声说|轻声说|说道|问道|回答|答道|喊道|笑道|说|问|道)?\s*[：:]\s*[“\"']"
)
QUOTE_RE = re.compile(r"[“\"']([^”\"']{1,200})[”\"']")


@dataclass
class ParsedSegment:
    text: str
    character_name: str


@dataclass
class ParsedChapter:
    title: str
    segments: list[ParsedSegment]


def split_book(content: str) -> list[ParsedChapter]:
    lines = normalize_text(content).splitlines()
    chapters: list[tuple[str, list[str]]] = []
    current_title = "正文"
    current_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped and CHAPTER_RE.match(stripped):
            if current_lines or not chapters:
                chapters.append((clean_heading(current_title), current_lines))
            current_title = clean_heading(stripped)
            current_lines = []
        else:
            current_lines.append(line)

    chapters.append((clean_heading(current_title), current_lines))

    parsed = []
    for title, chapter_lines in chapters:
        segments = split_segments("\n".join(chapter_lines))
        if segments:
            parsed.append(
                ParsedChapter(
                    title=title,
                    segments=[ParsedSegment(text=s, character_name=detect_character(s)) for s in segments],
                )
            )

    if not parsed:
        text = normalize_text(content).strip()
        parsed.append(ParsedChapter(title="正文", segments=[ParsedSegment(text=text, character_name="旁白")]))

    return parsed


def normalize_text(content: str) -> str:
    return content.replace("\r\n", "\n").replace("\r", "\n").replace("\ufeff", "")


def clean_heading(title: str) -> str:
    title = title.strip()
    return re.sub(r"^#{1,3}\s*", "", title) or "正文"


def split_segments(chapter_text: str) -> list[str]:
    blocks = [block.strip() for block in re.split(r"\n\s*\n+", chapter_text) if block.strip()]
    if blocks:
        return blocks

    compact_lines = [line.strip() for line in chapter_text.splitlines() if line.strip()]
    return compact_lines


def detect_character(segment_text: str) -> str:
    first_line = segment_text.strip().splitlines()[0] if segment_text.strip() else ""
    speaker_match = SPEAKER_RE.match(first_line)
    if speaker_match:
        return speaker_match.group(1)

    if QUOTE_RE.search(first_line) and len(first_line) <= 260:
        return "未知角色"

    return "旁白"
