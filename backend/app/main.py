import base64
import hashlib
import json
import logging
import mimetypes
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.database import DATA_DIR, get_db, init_db
from app.epub_parser import EpubError, ParsedEpubChapter, parse_epub
from app.models import Book, Chapter, Character, Illustration, Segment
from app.parser import ParsedChapter, detect_character, split_book, split_segments
from app.schemas import (
    BookDetailResponse,
    BookListItem,
    BookRechapterRequest,
    ChapterResponse,
    ChapterResegmentRequest,
    CharacterCreateRequest,
    CharacterMoveRequest,
    CharacterResponse,
    CharacterUpdateRequest,
    IllustrationLibraryItem,
    IllustrationResponse,
    ImportBookRequest,
    SegmentResponse,
    SegmentUpdateRequest,
)


logger = logging.getLogger("ai_reading")
ASSETS_DIR = DATA_DIR / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="AI 读书", version="0.2.1", lifespan=lifespan)
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/books/import", response_model=BookDetailResponse)
def import_book(payload: ImportBookRequest, db: Session = Depends(get_db)) -> BookDetailResponse:
    parsed_chapters = split_book(payload.content)
    book = persist_book(db, payload.title.strip(), parsed_chapters)
    return get_book_detail(book.id, db)


@app.post("/api/books/import-epub", response_model=BookDetailResponse)
async def import_epub_book(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> BookDetailResponse:
    logger.info("开始导入 EPUB: filename=%s content_type=%s", file.filename, file.content_type)
    if not file.filename or not file.filename.lower().endswith(".epub"):
        logger.warning("EPUB 导入失败：文件扩展名不正确 filename=%s", file.filename)
        raise HTTPException(status_code=400, detail="请选择 .epub 文件")

    content = await file.read()
    logger.info("EPUB 文件读取完成：%s bytes", len(content))
    try:
        epub_title, parsed_chapters = parse_epub(content)
        logger.info("EPUB 解析完成：title=%s chapters=%s", epub_title, len(parsed_chapters))
        final_title = (title or epub_title or Path(file.filename).stem).strip()
        book = persist_book(db, final_title, parsed_chapters)
        logger.info("EPUB 入库完成：book_id=%s title=%s", book.id, final_title)
        return get_book_detail(book.id, db)
    except EpubError as exc:
        logger.exception("EPUB 解析失败：%s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("EPUB 导入发生未预期错误")
        raise HTTPException(status_code=500, detail=f"EPUB 导入失败：{exc}") from exc


@app.post("/api/books/import-export-json", response_model=BookDetailResponse)
async def import_export_json_book(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> BookDetailResponse:
    logger.info("开始导入导出 JSON: filename=%s content_type=%s", file.filename, file.content_type)
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="请选择 .json 文件")

    try:
        payload = json.loads((await file.read()).decode("utf-8"))
        book = persist_exported_book(db, payload)
        logger.info("导出 JSON 回导完成：book_id=%s title=%s", book.id, book.title)
        return get_book_detail(book.id, db)
    except json.JSONDecodeError as exc:
        logger.exception("导出 JSON 格式错误")
        raise HTTPException(status_code=400, detail="JSON 格式不正确，无法导入") from exc
    except ValueError as exc:
        logger.exception("导出 JSON 内容不符合要求")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("导出 JSON 回导发生未预期错误")
        raise HTTPException(status_code=500, detail=f"导入导出 JSON 失败：{exc}") from exc


@app.get("/api/books", response_model=list[BookListItem])
def list_books(db: Session = Depends(get_db)) -> list[BookListItem]:
    rows = db.execute(
        select(
            Book.id,
            Book.title,
            Book.created_at,
            func.count(func.distinct(Chapter.id)).label("chapter_count"),
            func.count(Segment.id).label("segment_count"),
        )
        .outerjoin(Chapter, Chapter.book_id == Book.id)
        .outerjoin(Segment, Segment.chapter_id == Chapter.id)
        .group_by(Book.id)
        .order_by(Book.created_at.desc())
    ).all()
    return [
        BookListItem(
            id=row.id,
            title=row.title,
            created_at=row.created_at,
            chapter_count=row.chapter_count,
            segment_count=row.segment_count,
        )
        for row in rows
    ]


@app.get("/api/books/{book_id}", response_model=BookDetailResponse)
def get_book(book_id: int, db: Session = Depends(get_db)) -> BookDetailResponse:
    return get_book_detail(book_id, db)


@app.get("/api/books/{book_id}/illustration-library", response_model=list[IllustrationLibraryItem])
def read_illustration_library(
    book_id: int, db: Session = Depends(get_db)
) -> list[IllustrationLibraryItem]:
    book = db.execute(
        select(Book)
        .where(Book.id == book_id)
        .options(joinedload(Book.chapters).joinedload(Chapter.illustrations))
    ).unique().scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    return get_or_create_illustration_library(book)


@app.get("/api/books/{book_id}/export.json")
def export_book_json(book_id: int, db: Session = Depends(get_db)) -> Response:
    book = get_book_detail(book_id, db)
    return download_response(
        json.dumps(book_export_payload(book), ensure_ascii=False, indent=2),
        f"book_{book_id}.json",
        "application/json; charset=utf-8",
    )


@app.get("/api/books/{book_id}/export.txt")
def export_book_txt(book_id: int, db: Session = Depends(get_db)) -> Response:
    book = get_book_detail(book_id, db)
    return download_response(
        render_book_txt(book),
        f"book_{book_id}.txt",
        "text/plain; charset=utf-8",
    )


@app.get("/api/chapters/{chapter_id}/export.json")
def export_chapter_json(chapter_id: int, db: Session = Depends(get_db)) -> Response:
    chapter = get_chapter_export(chapter_id, db)
    return download_response(
        json.dumps(chapter_export_payload(chapter), ensure_ascii=False, indent=2),
        f"chapter_{chapter_id}.json",
        "application/json; charset=utf-8",
    )


@app.get("/api/chapters/{chapter_id}/export.txt")
def export_chapter_txt(chapter_id: int, db: Session = Depends(get_db)) -> Response:
    chapter = get_chapter_export(chapter_id, db)
    return download_response(
        render_chapter_txt(chapter),
        f"chapter_{chapter_id}.txt",
        "text/plain; charset=utf-8",
    )


@app.delete("/api/cache")
def clear_cache(db: Session = Depends(get_db)) -> dict[str, int]:
    books = db.execute(select(Book)).scalars().all()
    deleted_books = len(books)
    for book in books:
        db.delete(book)
    db.commit()

    if ASSETS_DIR.exists():
        shutil.rmtree(ASSETS_DIR)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    logger.info("已清空缓存：books=%s assets=%s", deleted_books, ASSETS_DIR)
    return {"deleted_books": deleted_books}


@app.patch("/api/segments/{segment_id}", response_model=SegmentResponse)
def update_segment(
    segment_id: int, payload: SegmentUpdateRequest, db: Session = Depends(get_db)
) -> SegmentResponse:
    segment = db.get(Segment, segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="段落不存在")

    if payload.text is not None:
        segment.text = payload.text.strip()
    if payload.label is not None:
        segment.label = payload.label.strip()
    if payload.is_spoken is not None:
        segment.is_spoken = 1 if payload.is_spoken else 0

    if payload.character_id is not None:
        character = db.get(Character, payload.character_id)
        if not character:
            raise HTTPException(status_code=404, detail="角色不存在")
        chapter = db.get(Chapter, segment.chapter_id)
        if character.book_id != chapter.book_id:
            raise HTTPException(status_code=400, detail="角色不属于当前书籍")
        segment.character_id = character.id

    db.commit()
    db.refresh(segment)
    return serialize_segment(segment)


@app.post("/api/chapters/{chapter_id}/resegment", response_model=ChapterResponse)
def resegment_chapter(
    chapter_id: int, payload: ChapterResegmentRequest, db: Session = Depends(get_db)
) -> ChapterResponse:
    chapter = db.execute(
        select(Chapter)
        .where(Chapter.id == chapter_id)
        .options(
            joinedload(Chapter.book).joinedload(Book.characters),
            joinedload(Chapter.segments).joinedload(Segment.character),
            joinedload(Chapter.illustrations),
        )
    ).unique().scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    parsed_segments = parse_manual_segments(payload.content)
    if not parsed_segments:
        raise HTTPException(status_code=400, detail="没有解析到任何段落")

    old_character_by_text = {normalize_segment_text(segment.text): segment.character for segment in chapter.segments}
    existing_characters = {character.name: character for character in chapter.book.characters}

    def get_character(name: str) -> Character:
        clean_name = name.strip() or "旁白"
        if clean_name not in existing_characters:
            character = Character(
                book_id=chapter.book_id,
                name=clean_name,
                position=len(existing_characters),
            )
            db.add(character)
            db.flush()
            existing_characters[clean_name] = character
        return existing_characters[clean_name]

    for segment in list(chapter.segments):
        db.delete(segment)
    db.flush()

    for index, parsed in enumerate(parsed_segments):
        preserved = old_character_by_text.get(normalize_segment_text(parsed["text"]))
        if parsed["is_spoken"] and preserved:
            character = preserved
        elif parsed["is_spoken"]:
            character = get_character(detect_character(parsed["text"]))
        else:
            character = get_character("旁白")
        db.add(
            Segment(
                chapter_id=chapter.id,
                character_id=character.id,
                text=parsed["text"],
                position=index,
                label=parsed["label"],
                is_spoken=1 if parsed["is_spoken"] else 0,
            )
        )

    db.commit()
    return get_chapter_export(chapter_id, db)


@app.post("/api/books/{book_id}/rechapter", response_model=BookDetailResponse)
def rechapter_book(
    book_id: int, payload: BookRechapterRequest, db: Session = Depends(get_db)
) -> BookDetailResponse:
    book = db.execute(
        select(Book)
        .where(Book.id == book_id)
        .options(
            joinedload(Book.characters),
            joinedload(Book.chapters).joinedload(Chapter.segments).joinedload(Segment.character),
            joinedload(Book.chapters).joinedload(Chapter.illustrations),
        )
    ).unique().scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")

    parsed_chapters = parse_manual_chapters(payload.content)
    if not parsed_chapters:
        raise HTTPException(status_code=400, detail="没有解析到任何章节")

    old_character_by_text = {
        normalize_segment_text(segment.text): segment.character
        for chapter in book.chapters
        for segment in chapter.segments
    }
    existing_characters = {
        character.name: character
        for character in sorted(book.characters, key=lambda item: (item.position, item.id))
    }
    illustration_library = {
        item.key: item
        for item in get_or_create_illustration_library(book)
    }

    def get_character(name: str) -> Character:
        clean_name = name.strip() or "旁白"
        if clean_name not in existing_characters:
            character = Character(
                book_id=book.id,
                name=clean_name,
                position=len(existing_characters),
            )
            db.add(character)
            db.flush()
            existing_characters[clean_name] = character
        return existing_characters[clean_name]

    for chapter in list(book.chapters):
        db.delete(chapter)
    db.flush()

    created_chapters = 0
    created_segments = 0
    created_illustrations = 0
    for chapter_index, parsed_chapter in enumerate(parsed_chapters):
        segments = split_segments(parsed_chapter["content"])
        illustrations = parsed_chapter["illustrations"]
        if not segments and not illustrations:
            continue

        chapter = Chapter(book_id=book.id, title=parsed_chapter["title"], position=created_chapters)
        db.add(chapter)
        db.flush()
        created_chapters += 1

        for image_index, image_key in enumerate(illustrations):
            library_item = illustration_library.get(image_key)
            if not library_item:
                raise HTTPException(status_code=400, detail=f"找不到插画编号 {image_key}")
            image_path = copy_library_illustration(book.id, chapter.id, image_index, library_item)
            if not image_path:
                continue
            db.add(
                Illustration(
                    chapter_id=chapter.id,
                    path=image_path,
                    alt=f"插画 {image_index + 1}",
                    position=image_index,
                )
            )
            created_illustrations += 1

        for segment_index, text in enumerate(segments):
            preserved = old_character_by_text.get(normalize_segment_text(text))
            character = preserved or get_character(detect_character(text))
            db.add(
                Segment(
                    chapter_id=chapter.id,
                    character_id=character.id,
                    text=text,
                    position=segment_index,
                    label="",
                    is_spoken=1,
                )
            )
            created_segments += 1

    if created_chapters == 0 or (created_segments == 0 and created_illustrations == 0):
        raise HTTPException(status_code=400, detail="章节内容为空，无法重建章节")

    db.commit()
    return get_book_detail(book.id, db)


@app.post("/api/books/{book_id}/characters", response_model=CharacterResponse)
def create_character(
    book_id: int, payload: CharacterCreateRequest, db: Session = Depends(get_db)
) -> CharacterResponse:
    if not db.get(Book, book_id):
        raise HTTPException(status_code=404, detail="书籍不存在")

    name = payload.name.strip()
    existing = db.execute(
        select(Character).where(Character.book_id == book_id, Character.name == name)
    ).scalar_one_or_none()
    if existing:
        return existing

    next_position = db.execute(
        select(func.count(Character.id)).where(Character.book_id == book_id)
    ).scalar_one()
    character = Character(book_id=book_id, name=name, position=next_position)
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


@app.patch("/api/characters/{character_id}/move", response_model=list[CharacterResponse])
def move_character(
    character_id: int, payload: CharacterMoveRequest, db: Session = Depends(get_db)
) -> list[CharacterResponse]:
    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")
    characters = get_ordered_characters(db, character.book_id)
    current_index = next((index for index, item in enumerate(characters) if item.id == character.id), -1)
    if current_index < 0:
        raise HTTPException(status_code=404, detail="角色不存在")

    if payload.direction == "top":
        moved = [characters.pop(current_index)]
        characters = moved + characters
    elif payload.direction == "up" and current_index > 0:
        characters[current_index - 1], characters[current_index] = characters[current_index], characters[current_index - 1]
    elif payload.direction == "down" and current_index < len(characters) - 1:
        characters[current_index + 1], characters[current_index] = characters[current_index], characters[current_index + 1]

    save_character_order(db, characters)
    db.commit()
    return [CharacterResponse.model_validate(item) for item in get_ordered_characters(db, character.book_id)]


@app.patch("/api/characters/{character_id}", response_model=CharacterResponse)
def update_character(
    character_id: int, payload: CharacterUpdateRequest, db: Session = Depends(get_db)
) -> CharacterResponse:
    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")

    character.name = payload.name.strip()
    db.commit()
    db.refresh(character)
    return character


@app.delete("/api/characters/{character_id}")
def delete_character(character_id: int, db: Session = Depends(get_db)) -> dict[str, int]:
    character = db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")

    characters = get_ordered_characters(db, character.book_id)
    if len(characters) <= 1:
        raise HTTPException(status_code=400, detail="至少保留一个角色")

    fallback = next((item for item in characters if item.id != character.id), None)
    if not fallback:
        raise HTTPException(status_code=400, detail="没有可接管段落的角色")

    reassigned = db.execute(
        select(Segment).where(Segment.character_id == character.id)
    ).scalars().all()
    for segment in reassigned:
        segment.character_id = fallback.id
        segment.character = fallback

    db.delete(character)
    db.flush()
    save_character_order(db, get_ordered_characters(db, fallback.book_id))
    db.commit()
    return {"fallback_character_id": fallback.id, "reassigned_segments": len(reassigned)}


def get_ordered_characters(db: Session, book_id: int) -> list[Character]:
    return list(
        db.execute(
            select(Character)
            .where(Character.book_id == book_id)
            .order_by(Character.position, Character.id)
        ).scalars()
    )


def save_character_order(db: Session, characters: list[Character]) -> None:
    for index, character in enumerate(characters):
        character.position = index
    db.flush()


def persist_book(
    db: Session, title: str, parsed_chapters: list[ParsedChapter | ParsedEpubChapter]
) -> Book:
    book = Book(title=title)
    db.add(book)
    db.flush()

    characters: dict[str, Character] = {}

    def get_character(name: str) -> Character:
        clean_name = name.strip() or "旁白"
        if clean_name not in characters:
            character = Character(book_id=book.id, name=clean_name, position=len(characters))
            db.add(character)
            db.flush()
            characters[clean_name] = character
        return characters[clean_name]

    get_character("旁白")
    for chapter_index, parsed_chapter in enumerate(parsed_chapters):
        chapter = Chapter(book_id=book.id, title=parsed_chapter.title, position=chapter_index)
        db.add(chapter)
        db.flush()

        for image_index, parsed_image in enumerate(getattr(parsed_chapter, "images", [])):
            image_path = save_illustration(book.id, chapter.id, image_index, parsed_image.filename, parsed_image.data)
            db.add(
                Illustration(
                    chapter_id=chapter.id,
                    path=image_path,
                    alt=parsed_image.alt,
                    position=image_index,
                )
            )

        for segment_index, parsed_segment in enumerate(parsed_chapter.segments):
            character = get_character(parsed_segment.character_name)
            db.add(
                Segment(
                    chapter_id=chapter.id,
                    character_id=character.id,
                    text=parsed_segment.text,
                    position=segment_index,
                    label="",
                    is_spoken=1,
                )
            )

    db.commit()
    return book


def persist_exported_book(db: Session, payload: dict) -> Book:
    title = str(payload.get("title") or "").strip()
    chapters_payload = payload.get("chapters")
    if not title:
        raise ValueError("导出 JSON 缺少书名")
    if not isinstance(chapters_payload, list) or not chapters_payload:
        raise ValueError("导出 JSON 缺少章节")

    book = Book(title=f"{title}（回导）")
    db.add(book)
    db.flush()

    characters: dict[str, Character] = {}

    def get_character(name: str) -> Character:
        clean_name = str(name or "旁白").strip() or "旁白"
        if clean_name not in characters:
            character = Character(book_id=book.id, name=clean_name, position=len(characters))
            db.add(character)
            db.flush()
            characters[clean_name] = character
        return characters[clean_name]

    get_character("旁白")
    for chapter_index, chapter_payload in enumerate(chapters_payload):
        chapter_title = str(chapter_payload.get("title") or f"第 {chapter_index + 1} 章").strip()
        chapter = Chapter(book_id=book.id, title=chapter_title, position=chapter_index)
        db.add(chapter)
        db.flush()

        for image_index, illustration_payload in enumerate(chapter_payload.get("illustrations") or []):
            image_path = restore_exported_illustration(
                book.id,
                chapter.id,
                image_index,
                illustration_payload,
            )
            if not image_path:
                continue
            db.add(
                Illustration(
                    chapter_id=chapter.id,
                    path=image_path,
                    alt=str(illustration_payload.get("alt") or ""),
                    position=image_index,
                )
            )

        segments_payload = chapter_payload.get("segments") or []
        if not isinstance(segments_payload, list):
            raise ValueError(f"章节“{chapter_title}”的段落格式不正确")
        for segment_index, segment_payload in enumerate(segments_payload):
            text = str(segment_payload.get("text") or "").strip()
            if not text:
                continue
            character = get_character(segment_payload.get("character_name") or "旁白")
            db.add(
                Segment(
                    chapter_id=chapter.id,
                    character_id=character.id,
                    text=text,
                    position=segment_index,
                    label=str(segment_payload.get("label") or ""),
                    is_spoken=1 if segment_payload.get("is_spoken", True) else 0,
                )
            )

    db.commit()
    return book


def restore_exported_illustration(
    book_id: int,
    chapter_id: int,
    position: int,
    illustration_payload: dict,
) -> str:
    data_url = str(illustration_payload.get("data_url") or "")
    if data_url.startswith("data:") and ";base64," in data_url:
        header, encoded = data_url.split(";base64,", 1)
        media_type = header.removeprefix("data:") or "application/octet-stream"
        extension = mimetypes.guess_extension(media_type) or ".bin"
        filename = f"exported_{position + 1}{extension}"
        return save_illustration(book_id, chapter_id, position, filename, base64.b64decode(encoded))

    return normalize_exported_asset_path(str(illustration_payload.get("url") or ""))


def save_data_url_illustration(book_id: int, chapter_id: int, position: int, marker: str) -> str:
    data_url = extract_data_url(marker)
    if not data_url:
        return ""
    header, encoded = data_url.split(";base64,", 1)
    media_type = header.removeprefix("data:") or "application/octet-stream"
    extension = mimetypes.guess_extension(media_type) or ".bin"
    filename = f"rechapter_{position + 1}{extension}"
    return save_illustration(book_id, chapter_id, position, filename, base64.b64decode(encoded))


def get_or_create_illustration_library(book: Book) -> list[IllustrationLibraryItem]:
    library_dir = ASSETS_DIR / f"book_{book.id}" / "library"
    library_dir.mkdir(parents=True, exist_ok=True)
    library_files = sorted(
        [path for path in library_dir.iterdir() if path.is_file() and path.stem.startswith("img_")]
    )
    known_hashes = {file_hash(path): path for path in library_files}

    source_paths: list[Path] = []
    for chapter in sorted(book.chapters, key=lambda item: item.position):
        for illustration in sorted(chapter.illustrations, key=lambda item: item.position):
            source_path = ASSETS_DIR / illustration.path
            if source_path.exists():
                source_paths.append(source_path)

    for source_path in source_paths:
        digest = file_hash(source_path)
        if digest in known_hashes:
            continue
        next_index = len(library_files) + 1
        extension = source_path.suffix or ".bin"
        target = library_dir / f"img_{next_index:03d}{extension}"
        shutil.copyfile(source_path, target)
        library_files.append(target)
        known_hashes[digest] = target

    return [
        IllustrationLibraryItem(key=path.stem, url=f"/assets/book_{book.id}/library/{path.name}")
        for path in sorted(library_files)
    ]


def copy_library_illustration(
    book_id: int, chapter_id: int, position: int, item: IllustrationLibraryItem
) -> str:
    asset_path = normalize_exported_asset_path(item.url)
    source_path = ASSETS_DIR / asset_path if asset_path else None
    if not source_path or not source_path.exists():
        return ""
    return save_illustration(book_id, chapter_id, position, source_path.name, source_path.read_bytes())


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract_data_url(value: str) -> str:
    start = value.find("data:")
    if start < 0:
        return ""
    data_url = value[start:].strip()
    if ";base64," not in data_url:
        return ""
    return data_url


def normalize_exported_asset_path(url: str) -> str:
    if not url:
        return ""
    if url.startswith("/assets/"):
        return url.removeprefix("/assets/")
    if url.startswith("assets/"):
        return url.removeprefix("assets/")
    return ""


def book_export_payload(book: BookDetailResponse) -> dict:
    payload = book.model_dump(mode="json")
    payload["export_version"] = 1
    payload["chapters"] = [chapter_export_payload(chapter) for chapter in book.chapters]
    return payload


def chapter_export_payload(chapter: ChapterResponse) -> dict:
    payload = chapter.model_dump(mode="json")
    payload["illustrations"] = [illustration_export_payload(item) for item in chapter.illustrations]
    return payload


def illustration_export_payload(illustration: IllustrationResponse) -> dict:
    payload = illustration.model_dump(mode="json")
    asset_path = normalize_exported_asset_path(illustration.url)
    file_path = ASSETS_DIR / asset_path if asset_path else None
    if file_path and file_path.exists():
        media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        payload["data_url"] = f"data:{media_type};base64,{base64.b64encode(file_path.read_bytes()).decode('ascii')}"
    return payload


def save_illustration(book_id: int, chapter_id: int, position: int, filename: str, data: bytes) -> str:
    chapter_dir = ASSETS_DIR / f"book_{book_id}" / f"chapter_{chapter_id}"
    chapter_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{position + 1}_{filename}"
    target = chapter_dir / safe_name
    target.write_bytes(data)
    return f"book_{book_id}/chapter_{chapter_id}/{safe_name}"


def get_book_detail(book_id: int, db: Session) -> BookDetailResponse:
    book = db.execute(
        select(Book)
        .where(Book.id == book_id)
        .options(
            joinedload(Book.characters),
            joinedload(Book.chapters).joinedload(Chapter.illustrations),
            joinedload(Book.chapters).joinedload(Chapter.segments).joinedload(Segment.character),
        )
    ).unique().scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="书籍不存在")
    illustration_keys = build_illustration_key_map(book)

    return BookDetailResponse(
        id=book.id,
        title=book.title,
        created_at=book.created_at,
        characters=[
            CharacterResponse.model_validate(character)
            for character in sorted(book.characters, key=lambda item: (item.position, item.id))
        ],
        chapters=[
            ChapterResponse(
                id=chapter.id,
                title=chapter.title,
                position=chapter.position,
                illustrations=[
                    serialize_illustration(illustration, illustration_keys)
                    for illustration in chapter.illustrations
                    if illustration_asset_exists(illustration)
                ],
                segments=[serialize_segment(segment) for segment in chapter.segments],
            )
            for chapter in book.chapters
        ],
    )


def get_chapter_export(chapter_id: int, db: Session) -> ChapterResponse:
    chapter = db.execute(
        select(Chapter)
        .where(Chapter.id == chapter_id)
        .options(
            joinedload(Chapter.illustrations),
            joinedload(Chapter.segments).joinedload(Segment.character),
        )
    ).unique().scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    book = db.get(Book, chapter.book_id)
    illustration_keys = build_illustration_key_map(book) if book else {}

    return ChapterResponse(
        id=chapter.id,
        title=chapter.title,
        position=chapter.position,
        illustrations=[
            serialize_illustration(illustration, illustration_keys)
            for illustration in chapter.illustrations
            if illustration_asset_exists(illustration)
        ],
        segments=[serialize_segment(segment) for segment in chapter.segments],
    )


def render_book_txt(book: BookDetailResponse) -> str:
    lines = [book.title, ""]
    for chapter in book.chapters:
        lines.append(f"# {chapter.title}")
        lines.extend(render_illustration_lines(chapter.illustrations))
        for segment in chapter.segments:
            lines.append(f"[{segment.character_name}] {segment.text}")
            lines.append("")
    return "\n".join(lines).strip() + "\n"


def render_chapter_txt(chapter: ChapterResponse) -> str:
    lines = [f"# {chapter.title}"]
    lines.extend(render_illustration_lines(chapter.illustrations))
    for segment in chapter.segments:
        lines.append(f"[{segment.character_name}] {segment.text}")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def render_illustration_lines(illustrations: list[IllustrationResponse]) -> list[str]:
    if not illustrations:
        return []
    lines = ["", "## 插画"]
    for illustration in illustrations:
        label = illustration.alt or f"插画 {illustration.position + 1}"
        lines.append(f"- {label}: {illustration.url}")
    lines.append("")
    return lines


def parse_manual_segments(content: str) -> list[dict]:
    segments: list[dict] = []
    label = ""
    mode: str | None = None
    lines: list[str] = []

    def flush() -> None:
        nonlocal label, mode, lines
        text = "\n".join(lines).strip()
        if text:
            segments.append(
                {
                    "label": label.strip(),
                    "text": text,
                    "is_spoken": mode != "display",
                }
            )
        label = ""
        mode = None
        lines = []

    for raw_line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if line.startswith("@段落名:") or line.startswith("@段落名："):
            if lines:
                flush()
            label = line.split(":", 1)[-1] if ":" in line else line.split("：", 1)[-1]
            continue
        if line == "@正文开始":
            if lines:
                flush()
            mode = "spoken"
            continue
        if line == "@正文结束":
            flush()
            continue
        if line == "@显示开始":
            if lines:
                flush()
            mode = "display"
            continue
        if line == "@显示结束":
            flush()
            continue
        if mode:
            lines.append(raw_line)

    if lines:
        flush()

    if segments:
        return segments

    return [
        {"label": "", "text": block.strip(), "is_spoken": True}
        for block in content.split("\n\n")
        if block.strip()
    ]


def parse_manual_chapters(content: str) -> list[dict]:
    chapters: list[dict] = []
    current_title = ""
    lines: list[str] = []
    illustrations: list[str] = []

    def flush() -> None:
        nonlocal current_title, lines, illustrations
        chapter_text = "\n".join(lines).strip()
        if current_title and (chapter_text or illustrations):
            chapters.append(
                {
                    "title": current_title.strip(),
                    "content": chapter_text,
                    "illustrations": illustrations,
                }
            )
        lines = []
        illustrations = []

    for raw_line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if line.startswith("@章节名:") or line.startswith("@章节名："):
            flush()
            current_title = line.split(":", 1)[-1] if ":" in line else line.split("：", 1)[-1]
            continue
        if line.startswith("@插画:") or line.startswith("@插画："):
            illustration_marker = line.split(":", 1)[-1] if ":" in line else line.split("：", 1)[-1]
            image_key = illustration_marker.strip().split()[0] if illustration_marker.strip() else ""
            if image_key:
                illustrations.append(image_key)
            continue
        if current_title:
            lines.append(raw_line)

    flush()
    if chapters:
        return chapters

    return [
        {
            "title": chapter.title,
            "content": "\n\n".join(segment.text for segment in chapter.segments),
            "illustrations": [],
        }
        for chapter in split_book(content)
    ]


def normalize_segment_text(text: str) -> str:
    return "\n".join(line.strip() for line in text.splitlines()).strip()


def download_response(content: str, filename: str, media_type: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def build_illustration_key_map(book: Book) -> dict[int, str]:
    key_map: dict[int, str] = {}
    index = 1
    for chapter in sorted(book.chapters, key=lambda item: item.position):
        for illustration in sorted(chapter.illustrations, key=lambda item: item.position):
            if not illustration_asset_exists(illustration):
                continue
            key_map[illustration.id] = f"img_{index:03d}"
            index += 1
    return key_map


def serialize_illustration(
    illustration: Illustration, key_map: dict[int, str] | None = None
) -> IllustrationResponse:
    return IllustrationResponse(
        id=illustration.id,
        position=illustration.position,
        url=f"/assets/{illustration.path}",
        alt=illustration.alt,
        key=key_map.get(illustration.id) if key_map else None,
    )


def illustration_asset_exists(illustration: Illustration) -> bool:
    return (ASSETS_DIR / illustration.path).exists()


def serialize_segment(segment: Segment) -> SegmentResponse:
    return SegmentResponse(
        id=segment.id,
        position=segment.position,
        text=segment.text,
        character_id=segment.character_id,
        character_name=segment.character.name,
        label=segment.label or "",
        is_spoken=bool(segment.is_spoken),
    )
