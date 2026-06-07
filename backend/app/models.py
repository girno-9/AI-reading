from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    chapters: Mapped[list["Chapter"]] = relationship(
        back_populates="book", cascade="all, delete-orphan", order_by="Chapter.position"
    )
    characters: Mapped[list["Character"]] = relationship(
        back_populates="book", cascade="all, delete-orphan", order_by="Character.id"
    )


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    book: Mapped[Book] = relationship(back_populates="chapters")
    segments: Mapped[list["Segment"]] = relationship(
        back_populates="chapter", cascade="all, delete-orphan", order_by="Segment.position"
    )
    illustrations: Mapped[list["Illustration"]] = relationship(
        back_populates="chapter", cascade="all, delete-orphan", order_by="Illustration.position"
    )


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    book: Mapped[Book] = relationship(back_populates="characters")
    segments: Mapped[list["Segment"]] = relationship(back_populates="character")


class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), nullable=False, index=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(120), default="")
    is_spoken: Mapped[int] = mapped_column(Integer, default=1)

    chapter: Mapped[Chapter] = relationship(back_populates="segments")
    character: Mapped[Character] = relationship(back_populates="segments")


class Illustration(Base):
    __tablename__ = "illustrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), nullable=False, index=True)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    alt: Mapped[str] = mapped_column(String(200), default="")
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    chapter: Mapped[Chapter] = relationship(back_populates="illustrations")
