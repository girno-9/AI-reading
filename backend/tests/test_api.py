import os
from pathlib import Path
import zipfile
from io import BytesIO

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


client = TestClient(app)


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_import_edit_and_rename_character():
    response = client.post(
        "/api/books/import",
        json={
            "title": "测试书",
            "content": "第一章\n\n旁白。\n\n张三说：“你好。”",
        },
    )
    assert response.status_code == 200
    book = response.json()
    assert book["title"] == "测试书"
    assert len(book["chapters"]) == 1

    characters = {item["name"]: item["id"] for item in book["characters"]}
    assert "旁白" in characters
    assert "张三" in characters

    segment_id = book["chapters"][0]["segments"][0]["id"]
    edit_response = client.patch(
        f"/api/segments/{segment_id}",
        json={"text": "修改后的旁白。", "character_id": characters["张三"]},
    )
    assert edit_response.status_code == 200
    assert edit_response.json()["text"] == "修改后的旁白。"
    assert edit_response.json()["character_name"] == "张三"

    rename_response = client.patch(
        f"/api/characters/{characters['张三']}",
        json={"name": "张三新版"},
    )
    assert rename_response.status_code == 200
    assert rename_response.json()["name"] == "张三新版"


def test_import_epub_with_illustration():
    response = client.post(
        "/api/books/import-epub",
        data={"title": "EPUB 测试"},
        files={"file": ("book.epub", build_epub(), "application/epub+zip")},
    )

    assert response.status_code == 200
    book = response.json()
    assert book["title"] == "EPUB 测试"
    assert book["chapters"][0]["title"] == "第一章 雨夜"
    assert book["chapters"][0]["segments"][0]["text"] == "张三说：“你好。”"
    assert book["chapters"][0]["segments"][0]["character_name"] == "张三"
    assert len(book["chapters"][0]["illustrations"]) == 1
    assert book["chapters"][0]["illustrations"][0]["url"].startswith("/assets/")


def test_export_book_and_chapter_as_json_and_txt():
    response = client.post(
        "/api/books/import",
        json={
            "title": "Export Book",
            "content": "Chapter 1\n\nNarrator line.\n\nAlice: \"Hello.\"",
        },
    )
    assert response.status_code == 200
    book = response.json()
    book_id = book["id"]
    chapter_id = book["chapters"][0]["id"]

    book_json = client.get(f"/api/books/{book_id}/export.json")
    assert book_json.status_code == 200
    assert book_json.headers["content-disposition"] == f'attachment; filename="book_{book_id}.json"'
    assert book_json.json()["chapters"][0]["segments"][0]["text"] == "Narrator line."

    book_txt = client.get(f"/api/books/{book_id}/export.txt")
    assert book_txt.status_code == 200
    assert "Export Book" in book_txt.text
    assert "[旁白] Narrator line." in book_txt.text
    assert "[Alice] Alice: \"Hello.\"" in book_txt.text

    chapter_json = client.get(f"/api/chapters/{chapter_id}/export.json")
    assert chapter_json.status_code == 200
    assert chapter_json.json()["title"] == "Chapter 1"

    chapter_txt = client.get(f"/api/chapters/{chapter_id}/export.txt")
    assert chapter_txt.status_code == 200
    assert "# Chapter 1" in chapter_txt.text


def test_import_exported_json_creates_editable_copy():
    response = client.post(
        "/api/books/import",
        json={
            "title": "Round Trip",
            "content": "Chapter 1\n\nAlice: \"Hello.\"",
        },
    )
    assert response.status_code == 200
    book_id = response.json()["id"]
    exported = client.get(f"/api/books/{book_id}/export.json")
    assert exported.status_code == 200

    imported = client.post(
        "/api/books/import-export-json",
        files={"file": ("round_trip.json", exported.content, "application/json")},
    )

    assert imported.status_code == 200
    copy = imported.json()
    assert copy["id"] != book_id
    assert copy["title"] == "Round Trip（回导）"
    assert copy["chapters"][0]["segments"][0]["text"] == 'Alice: "Hello."'
    assert copy["chapters"][0]["segments"][0]["character_name"] == "Alice"


def test_exported_json_survives_cache_clear_and_restores_illustration():
    response = client.post(
        "/api/books/import-epub",
        data={"title": "Illustration Round Trip"},
        files={"file": ("book.epub", build_epub(), "application/epub+zip")},
    )
    assert response.status_code == 200
    book_id = response.json()["id"]

    exported = client.get(f"/api/books/{book_id}/export.json")
    assert exported.status_code == 200
    exported_payload = exported.json()
    assert exported_payload["chapters"][0]["illustrations"][0]["data_url"].startswith("data:image/png;base64,")

    cleared = client.delete("/api/cache")
    assert cleared.status_code == 200
    assert client.get("/api/books").json() == []

    imported = client.post(
        "/api/books/import-export-json",
        files={"file": ("with_illustration.json", exported.content, "application/json")},
    )
    assert imported.status_code == 200
    restored = imported.json()
    assert len(restored["chapters"][0]["illustrations"]) == 1
    assert restored["chapters"][0]["illustrations"][0]["url"].startswith("/assets/")


def test_book_detail_filters_missing_illustration_assets():
    response = client.post(
        "/api/books/import-epub",
        data={"title": "Missing Illustration"},
        files={"file": ("book.epub", build_epub(), "application/epub+zip")},
    )
    assert response.status_code == 200
    book = response.json()
    illustration_url = book["chapters"][0]["illustrations"][0]["url"]
    asset_path = Path("data/assets") / illustration_url.removeprefix("/assets/")
    asset_path.unlink()

    detail = client.get(f"/api/books/{book['id']}")

    assert detail.status_code == 200
    assert detail.json()["chapters"][0]["illustrations"] == []


def test_resegment_chapter_preserves_manual_character_for_same_text():
    response = client.post(
        "/api/books/import",
        json={
            "title": "Resegment Book",
            "content": "Chapter 1\n\nNarrator line.\n\nAlice: \"Hello.\"",
        },
    )
    assert response.status_code == 200
    book = response.json()
    chapter_id = book["chapters"][0]["id"]
    first_segment_id = book["chapters"][0]["segments"][0]["id"]

    bob = client.post(f"/api/books/{book['id']}/characters", json={"name": "Bob"}).json()
    client.patch(f"/api/segments/{first_segment_id}", json={"character_id": bob["id"]})

    resegmented = client.post(
        f"/api/chapters/{chapter_id}/resegment",
        json={
            "content": """@段落名: 保留角色
@正文开始
Narrator line.
@正文结束

@段落名: 备注
@显示开始
这一段显示但是不朗读。
@显示结束

@段落名: 新对白
@正文开始
Alice: "Hello again."
@正文结束""",
        },
    )

    assert resegmented.status_code == 200
    chapter = resegmented.json()
    assert len(chapter["segments"]) == 3
    assert chapter["segments"][0]["label"] == "保留角色"
    assert chapter["segments"][0]["character_name"] == "Bob"
    assert chapter["segments"][1]["is_spoken"] is False
    assert chapter["segments"][1]["label"] == "备注"
    assert chapter["segments"][2]["character_name"] == "Alice"


def test_rechapter_book_rebuilds_chapters_and_preserves_matching_segment_character():
    response = client.post(
        "/api/books/import",
        json={
            "title": "Rechapter Book",
            "content": "Chapter 1\n\nNarrator line.\n\nAlice: \"Hello.\"\n\nChapter 2\n\nBob: \"Hi.\"",
        },
    )
    assert response.status_code == 200
    book = response.json()
    first_segment_id = book["chapters"][0]["segments"][0]["id"]

    custom = client.post(f"/api/books/{book['id']}/characters", json={"name": "Custom"}).json()
    client.patch(f"/api/segments/{first_segment_id}", json={"character_id": custom["id"]})

    resectioned = client.post(
        f"/api/books/{book['id']}/rechapter",
        json={
            "content": """@章节名: 新第一章
Narrator line.

Alice: "Hello again."

@章节名: 新第二章
Bob: "Hi."
""",
        },
    )

    assert resectioned.status_code == 200
    updated = resectioned.json()
    assert [chapter["title"] for chapter in updated["chapters"]] == ["新第一章", "新第二章"]
    assert updated["chapters"][0]["segments"][0]["character_name"] == "Custom"
    assert updated["chapters"][0]["segments"][1]["character_name"] == "Alice"
    assert updated["chapters"][1]["segments"][0]["character_name"] == "Bob"


def test_rechapter_book_restores_illustration_markers_to_new_chapters():
    response = client.post(
        "/api/books/import-epub",
        data={"title": "Rechapter Illustration"},
        files={"file": ("book.epub", build_epub(), "application/epub+zip")},
    )
    assert response.status_code == 200
    book = response.json()
    library = client.get(f"/api/books/{book['id']}/illustration-library")
    assert library.status_code == 200
    assert library.json()[0]["key"] == "img_001"

    resectioned = client.post(
        f"/api/books/{book['id']}/rechapter",
        json={
            "content": f"""@章节名: 没有插画的章节
旁白内容。

@章节名: 移动插画后的章节
@插画: img_001
张三说：“你好。”
""",
        },
    )

    assert resectioned.status_code == 200
    updated = resectioned.json()
    assert len(updated["chapters"][0]["illustrations"]) == 0
    assert len(updated["chapters"][1]["illustrations"]) == 1
    assert updated["chapters"][1]["illustrations"][0]["key"] == "img_001"
    assert updated["chapters"][1]["segments"][0]["text"] == "张三说：“你好。”"

    reexported = client.get(f"/api/books/{book['id']}/export.json").json()
    assert len(reexported["chapters"][1]["illustrations"]) == 1
    assert reexported["chapters"][1]["illustrations"][0]["data_url"].startswith("data:image/png;base64,")

    removed = client.post(
        f"/api/books/{book['id']}/rechapter",
        json={
            "content": """@章节名: 删除标记但保留库
张三说：“你好。”
""",
        },
    )
    assert removed.status_code == 200
    assert len(removed.json()["chapters"][0]["illustrations"]) == 0
    assert client.get(f"/api/books/{book['id']}/illustration-library").json()[0]["key"] == "img_001"

    invalid = client.post(
        f"/api/books/{book['id']}/rechapter",
        json={
            "content": """@章节名: 错误编号
@插画: img_999
张三说：“你好。”
""",
        },
    )
    assert invalid.status_code == 400
    assert "img_999" in invalid.json()["detail"]


def test_move_character_order_is_persisted():
    book = client.post(
        "/api/books/import",
        json={"title": "Order Book", "content": "Chapter 1\n\nNarrator line."},
    ).json()
    book_id = book["id"]
    alpha = client.post(f"/api/books/{book_id}/characters", json={"name": "Alpha"}).json()
    beta = client.post(f"/api/books/{book_id}/characters", json={"name": "Beta"}).json()

    moved = client.patch(f"/api/characters/{beta['id']}/move", json={"direction": "top"})
    assert moved.status_code == 200
    assert [item["name"] for item in moved.json()][:3] == ["Beta", "旁白", "Alpha"]

    moved_down = client.patch(f"/api/characters/{beta['id']}/move", json={"direction": "down"})
    assert moved_down.status_code == 200
    assert [item["name"] for item in moved_down.json()][:3] == ["旁白", "Beta", "Alpha"]

    detail = client.get(f"/api/books/{book_id}").json()
    assert [item["name"] for item in detail["characters"]][:3] == ["旁白", "Beta", "Alpha"]


def test_delete_character_reassigns_segments_to_top_character():
    book = client.post(
        "/api/books/import",
        json={"title": "Delete Book", "content": "Chapter 1\n\nAlice: \"Hello.\"\n\nBob: \"Hi.\""},
    ).json()
    characters = {item["name"]: item for item in book["characters"]}
    alice = characters["Alice"]
    bob = characters["Bob"]
    bob_segment = next(
        segment
        for segment in book["chapters"][0]["segments"]
        if segment["character_name"] == "Bob"
    )

    client.patch(f"/api/characters/{alice['id']}/move", json={"direction": "top"})
    deleted = client.delete(f"/api/characters/{bob['id']}")

    assert deleted.status_code == 200
    assert deleted.json()["reassigned_segments"] == 1

    detail = client.get(f"/api/books/{book['id']}").json()
    updated_segment = next(
        segment
        for segment in detail["chapters"][0]["segments"]
        if segment["id"] == bob_segment["id"]
    )
    assert updated_segment["character_name"] == "Alice"


def test_delete_top_character_reassigns_to_new_top_character():
    book = client.post(
        "/api/books/import",
        json={"title": "Delete Top Book", "content": "Chapter 1\n\nAlice: \"Hello.\""},
    ).json()
    characters = {item["name"]: item for item in book["characters"]}
    alice = characters["Alice"]
    alice_segment = book["chapters"][0]["segments"][0]

    client.patch(f"/api/characters/{alice['id']}/move", json={"direction": "top"})
    deleted = client.delete(f"/api/characters/{alice['id']}")

    assert deleted.status_code == 200
    detail = client.get(f"/api/books/{book['id']}").json()
    assert detail["characters"][0]["name"] == "旁白"
    updated_segment = detail["chapters"][0]["segments"][0]
    assert updated_segment["id"] == alice_segment["id"]
    assert updated_segment["character_name"] == "旁白"


def build_epub() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip")
        archive.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>""",
        )
        archive.writestr(
            "OEBPS/content.opf",
            """<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试 EPUB</dc:title>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="image1" href="images/pic.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>""",
        )
        archive.writestr(
            "OEBPS/chapter1.xhtml",
            """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h1>第一章 雨夜</h1>
    <img src="images/pic.png" alt="雨夜插画"/>
    <p>张三说：“你好。”</p>
  </body>
</html>""",
        )
        archive.writestr("OEBPS/images/pic.png", b"\x89PNG\r\n\x1a\n")
    return buffer.getvalue()
