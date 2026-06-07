from datetime import datetime

from pydantic import BaseModel, Field


class ImportBookRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)


class SegmentUpdateRequest(BaseModel):
    text: str | None = Field(default=None, min_length=1)
    character_id: int | None = None
    label: str | None = None
    is_spoken: bool | None = None


class ChapterResegmentRequest(BaseModel):
    content: str = Field(min_length=1)


class BookRechapterRequest(BaseModel):
    content: str = Field(min_length=1)


class CharacterCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class CharacterUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class CharacterMoveRequest(BaseModel):
    direction: str = Field(pattern="^(up|down|top)$")


class CharacterResponse(BaseModel):
    id: int
    name: str
    position: int

    model_config = {"from_attributes": True}


class SegmentResponse(BaseModel):
    id: int
    position: int
    text: str
    character_id: int
    character_name: str
    label: str
    is_spoken: bool


class IllustrationResponse(BaseModel):
    id: int
    position: int
    url: str
    alt: str
    key: str | None = None


class IllustrationLibraryItem(BaseModel):
    key: str
    url: str


class ChapterResponse(BaseModel):
    id: int
    title: str
    position: int
    illustrations: list[IllustrationResponse]
    segments: list[SegmentResponse]


class BookListItem(BaseModel):
    id: int
    title: str
    created_at: datetime
    chapter_count: int
    segment_count: int


class BookDetailResponse(BaseModel):
    id: int
    title: str
    created_at: datetime
    characters: list[CharacterResponse]
    chapters: list[ChapterResponse]


class VoicepackInboxItem(BaseModel):
    filename: str
    size_bytes: int
    modified_at: datetime
    package_id: str | None = None
    character_name: str | None = None
    voice_name: str | None = None
    engine: str | None = None
    is_valid: bool
    error: str | None = None


class VoicepackImportRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=260)


class VoicepackSummary(BaseModel):
    package_id: str
    character_name: str
    voice_name: str
    engine: str
    supported_emotions: list[str]
    imported_at: datetime | None = None
    source_filename: str | None = None
    preview_urls: list[str]


class VoicepackDetail(VoicepackSummary):
    description: str
    manifest: dict


class VoicepackTestRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    emotion: str | None = None


class VoicepackTestResponse(BaseModel):
    status: str
    detail: str
