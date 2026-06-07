from app.parser import detect_character, split_book


def test_split_book_with_chapters_and_segments():
    content = """第一章 开始

旁白第一段。

张三说：“你好。”

第二章 回应

李四问道：“你是谁？”
"""

    chapters = split_book(content)

    assert len(chapters) == 2
    assert chapters[0].title == "第一章 开始"
    assert len(chapters[0].segments) == 2
    assert chapters[0].segments[1].character_name == "张三"
    assert chapters[1].segments[0].character_name == "李四"


def test_split_book_without_heading_falls_back_to_body():
    chapters = split_book("只有一段没有章节标题的文字。")

    assert len(chapters) == 1
    assert chapters[0].title == "正文"
    assert chapters[0].segments[0].character_name == "旁白"


def test_detect_unknown_dialogue():
    assert detect_character("“这是没有说话人的对白。”") == "未知角色"
