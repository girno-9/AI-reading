import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronsUp,
  Download,
  FileImage,
  FileText,
  FileUp,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: isFormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: '请求失败，请查看后端 CMD 窗口。' }));
      throw new Error(error.detail || '请求失败，请查看后端 CMD 窗口。');
    }
    return response.json();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`无法连接后端：${API_BASE}。请确认后端 CMD 窗口正在运行，并查看窗口里的错误。`);
    }
    throw error;
  }
}

function App() {
  const [books, setBooks] = useState([]);
  const [selectedBookId, setSelectedBookId] = useState(null);
  const [book, setBook] = useState(null);
  const [activeChapterId, setActiveChapterId] = useState(null);
  const [status, setStatus] = useState('准备就绪');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [epubFile, setEpubFile] = useState(null);
  const [exportedJsonFile, setExportedJsonFile] = useState(null);
  const [newCharacter, setNewCharacter] = useState('');
  const [isImportingText, setIsImportingText] = useState(false);
  const [isImportingEpub, setIsImportingEpub] = useState(false);
  const [isImportingExportJson, setIsImportingExportJson] = useState(false);
  const [segmentDrafts, setSegmentDrafts] = useState({});
  const [isSavingChapter, setIsSavingChapter] = useState(false);
  const [resegmentText, setResegmentText] = useState('');
  const [isResegmentOpen, setIsResegmentOpen] = useState(false);
  const [isResegmenting, setIsResegmenting] = useState(false);
  const [rechapterText, setRechapterText] = useState('');
  const [rechapterIllustrations, setRechapterIllustrations] = useState([]);
  const [isRechapterOpen, setIsRechapterOpen] = useState(false);
  const [isRechaptering, setIsRechaptering] = useState(false);

  useEffect(() => {
    refreshBooks();
  }, []);

  useEffect(() => {
    if (selectedBookId) {
      loadBook(selectedBookId);
    }
  }, [selectedBookId]);

  const activeChapter = useMemo(() => {
    if (!book) return null;
    return book.chapters.find((chapter) => chapter.id === activeChapterId) || book.chapters[0] || null;
  }, [book, activeChapterId]);

  const activeChapterDirtyCount = useMemo(() => {
    if (!activeChapter) return 0;
    return activeChapter.segments.filter((segment) => segmentDrafts[segment.id]).length;
  }, [activeChapter, segmentDrafts]);

  async function refreshBooks() {
    try {
      const data = await api('/api/books');
      setBooks(data);
      if (!selectedBookId && data.length > 0) setSelectedBookId(data[0].id);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function clearCache() {
    const confirmed = window.confirm('会删除所有已导入书籍和插画，不能恢复。已导出的 JSON 文件不受影响。确定要继续吗？');
    if (!confirmed) return;
    try {
      setStatus('正在清空缓存...');
      const result = await api('/api/cache', { method: 'DELETE' });
      setBooks([]);
      setSelectedBookId(null);
      setBook(null);
      setActiveChapterId(null);
      setSegmentDrafts({});
      setStatus(`已清空缓存：删除 ${result.deleted_books} 本书`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadBook(id) {
    try {
      const data = await api(`/api/books/${id}`);
      setBook(data);
      setSegmentDrafts({});
      setActiveChapterId((current) => current || data.chapters[0]?.id || null);
      setStatus('已加载书籍');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function importTextBook(event) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      setStatus('请输入书名和正文');
      return;
    }
    setIsImportingText(true);
    try {
      setStatus('正在导入文本，请等待...');
      const data = await api('/api/books/import', {
        method: 'POST',
        body: JSON.stringify({ title, content }),
      });
      afterImport(data);
      setContent('');
      setStatus('文本导入完成');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsImportingText(false);
    }
  }

  async function importEpubBook(event) {
    event.preventDefault();
    if (!epubFile) {
      setStatus('请选择 EPUB 文件');
      return;
    }
    setIsImportingEpub(true);
    try {
      setStatus('正在解析 EPUB，请等待；如果失败，请查看后端 CMD 窗口。');
      const formData = new FormData();
      formData.append('file', epubFile);
      if (title.trim()) formData.append('title', title.trim());
      const data = await api('/api/books/import-epub', {
        method: 'POST',
        body: formData,
      });
      afterImport(data);
      setEpubFile(null);
      setStatus('EPUB 导入完成');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsImportingEpub(false);
    }
  }

  async function importExportedJsonBook(event) {
    event.preventDefault();
    if (!exportedJsonFile) {
      setStatus('请选择导出的 JSON 文件');
      return;
    }
    setIsImportingExportJson(true);
    try {
      setStatus('正在回导 JSON，请等待；如果失败，请查看后端 CMD 窗口。');
      const formData = new FormData();
      formData.append('file', exportedJsonFile);
      const data = await api('/api/books/import-export-json', {
        method: 'POST',
        body: formData,
      });
      afterImport(data);
      setExportedJsonFile(null);
      setStatus('导出 JSON 已回导为新书');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsImportingExportJson(false);
    }
  }

  function afterImport(data) {
    setTitle('');
    setSelectedBookId(data.id);
    setBook(data);
    setSegmentDrafts({});
    setActiveChapterId(data.chapters[0]?.id || null);
    refreshBooks();
  }

  function downloadExport(path, label) {
    window.location.href = `${API_BASE}${path}`;
    setStatus(`正在导出：${label}`);
  }

  async function updateSegment(segmentId, payload) {
    try {
      const updated = await api(`/api/segments/${segmentId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setBook((current) => ({
        ...current,
        chapters: current.chapters.map((chapter) => ({
          ...chapter,
          segments: chapter.segments.map((segment) => (segment.id === segmentId ? updated : segment)),
        })),
      }));
      setSegmentDrafts((current) => {
        const next = { ...current };
        delete next[segmentId];
        return next;
      });
      setStatus('段落已保存');
    } catch (error) {
      setStatus(error.message);
    }
  }

  function updateSegmentDraft(segment, payload) {
    const isDirty = payload.text !== segment.text || payload.character_id !== segment.character_id;
    setSegmentDrafts((current) => {
      const next = { ...current };
      if (isDirty) {
        next[segment.id] = payload;
      } else {
        delete next[segment.id];
      }
      return next;
    });
  }

  async function saveActiveChapterDrafts() {
    if (!activeChapter || activeChapterDirtyCount === 0) return;
    setIsSavingChapter(true);

    let savedCount = 0;
    let failedCount = 0;
    const updatedSegments = [];
    const savedIds = [];

    for (const segment of activeChapter.segments) {
      const draft = segmentDrafts[segment.id];
      if (!draft) continue;
      try {
        const updated = await api(`/api/segments/${segment.id}`, {
          method: 'PATCH',
          body: JSON.stringify(draft),
        });
        updatedSegments.push(updated);
        savedIds.push(segment.id);
        savedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    if (updatedSegments.length > 0) {
      const updatedById = new Map(updatedSegments.map((segment) => [segment.id, segment]));
      setBook((current) => ({
        ...current,
        chapters: current.chapters.map((chapter) => ({
          ...chapter,
          segments: chapter.segments.map((segment) => updatedById.get(segment.id) || segment),
        })),
      }));
      setSegmentDrafts((current) => {
        const next = { ...current };
        savedIds.forEach((id) => delete next[id]);
        return next;
      });
    }

    setStatus(`本章节保存完成：成功 ${savedCount} 段，失败 ${failedCount} 段`);
    setIsSavingChapter(false);
  }

  function openResegmentDialog() {
    if (!activeChapter) return;
    setResegmentText(formatChapterForResegment(activeChapter));
    setIsResegmentOpen(true);
  }

  async function openRechapterDialog() {
    if (!book) return;
    setStatus('正在准备全文分章节内容和插画标记...');
    try {
      const illustrationLibrary = await api(`/api/books/${book.id}/illustration-library`);
      setRechapterIllustrations(illustrationLibrary);
      setRechapterText(formatBookForRechapter(book, illustrationLibrary));
      setIsRechapterOpen(true);
      setStatus('已准备全文分章节内容');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function confirmResegment() {
    if (!activeChapter) return;
    const confirmed = window.confirm('会替换本章节所有段落，不能恢复。确定要继续吗？');
    if (!confirmed) return;
    setIsResegmenting(true);
    try {
      const updatedChapter = await api(`/api/chapters/${activeChapter.id}/resegment`, {
        method: 'POST',
        body: JSON.stringify({ content: resegmentText }),
      });
      setBook((current) => ({
        ...current,
        chapters: current.chapters.map((chapter) => (chapter.id === updatedChapter.id ? updatedChapter : chapter)),
      }));
      setSegmentDrafts((current) => {
        const next = { ...current };
        activeChapter.segments.forEach((segment) => delete next[segment.id]);
        return next;
      });
      setIsResegmentOpen(false);
      setStatus(`已重新分段：${updatedChapter.segments.length} 段`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsResegmenting(false);
    }
  }

  async function confirmRechapter() {
    if (!book) return;
    const confirmed = window.confirm('会替换整本书所有章节和段落，不能恢复。确定要继续吗？');
    if (!confirmed) return;
    setIsRechaptering(true);
    try {
      const updatedBook = await api(`/api/books/${book.id}/rechapter`, {
        method: 'POST',
        body: JSON.stringify({ content: rechapterText }),
      });
      setBook(updatedBook);
      setActiveChapterId(updatedBook.chapters[0]?.id || null);
      setSegmentDrafts({});
      setIsRechapterOpen(false);
      setStatus(`已重新分章节：${updatedBook.chapters.length} 章`);
      await refreshBooks();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsRechaptering(false);
    }
  }

  async function createCharacter(event) {
    event.preventDefault();
    if (!book || !newCharacter.trim()) return;
    try {
      const character = await api(`/api/books/${book.id}/characters`, {
        method: 'POST',
        body: JSON.stringify({ name: newCharacter }),
      });
      setBook((current) => {
        const exists = current.characters.some((item) => item.id === character.id);
        return {
          ...current,
          characters: exists ? current.characters : [...current.characters, character],
        };
      });
      setNewCharacter('');
      setStatus('角色已添加');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function renameCharacter(characterId, name) {
    if (!name.trim()) return;
    try {
      const character = await api(`/api/characters/${characterId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setBook((current) => ({
        ...current,
        characters: current.characters.map((item) => (item.id === characterId ? character : item)),
        chapters: current.chapters.map((chapter) => ({
          ...chapter,
          segments: chapter.segments.map((segment) =>
            segment.character_id === characterId ? { ...segment, character_name: character.name } : segment,
          ),
        })),
      }));
      setStatus('角色已重命名');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function moveCharacter(characterId, direction) {
    try {
      const characters = await api(`/api/characters/${characterId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ direction }),
      });
      setBook((current) => ({
        ...current,
        characters,
      }));
      setStatus('角色顺序已更新');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteCharacter(character) {
    if (!book || book.characters.length <= 1) {
      setStatus('至少要保留一个角色');
      return;
    }
    const confirmed = window.confirm(
      `确定删除角色“${character.name}”吗？正文段落里使用这个角色的内容会改为当前置顶角色。此操作不能恢复。`,
    );
    if (!confirmed) return;
    try {
      const result = await api(`/api/characters/${character.id}`, { method: 'DELETE' });
      const data = await api(`/api/books/${book.id}`);
      setBook(data);
      setSegmentDrafts({});
      setStatus(`角色已删除，${result.reassigned_segments} 段已改为置顶角色`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BookOpen size={24} />
          <div>
            <h1>AI 读书</h1>
            <p>文本、EPUB 与角色分段</p>
          </div>
        </div>

        <form className="import-form" onSubmit={importTextBook}>
          <label>
            书名
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：我的小说" />
          </label>
          <label>
            正文
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={'粘贴 .txt 或 .md 内容。\n\n第一章 开始\n\n张三说：“你好。”'}
            />
          </label>
          <button type="submit" disabled={isImportingText || isImportingEpub || isImportingExportJson}>
            <FileUp size={18} />
            {isImportingText ? '正在导入文本...' : '导入文本'}
          </button>
        </form>

        <form className="epub-form" onSubmit={importEpubBook}>
          <label>
            EPUB 文件
            <input
              type="file"
              accept=".epub,application/epub+zip"
              disabled={isImportingText || isImportingEpub || isImportingExportJson}
              onChange={(event) => setEpubFile(event.target.files?.[0] || null)}
            />
          </label>
          <button type="submit" disabled={isImportingText || isImportingEpub || isImportingExportJson}>
            <FileImage size={18} />
            {isImportingEpub ? '正在解析 EPUB...' : '导入 EPUB'}
          </button>
        </form>

        <section className="book-list">
          <div className="section-title">
            <span>书籍</span>
            <div className="book-actions">
              <button className="icon-button" onClick={refreshBooks} title="刷新书籍列表">
                <RefreshCw size={16} />
              </button>
              <button className="icon-button danger" onClick={clearCache} title="清空所有已导入书籍和插画">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          {books.length === 0 ? (
            <p className="empty">还没有导入书稿</p>
          ) : (
            books.map((item) => (
              <button
                key={item.id}
                className={`book-item ${item.id === selectedBookId ? 'active' : ''}`}
                onClick={() => {
                  setSelectedBookId(item.id);
                  setActiveChapterId(null);
                }}
              >
                <span>{item.title}</span>
                <small>
                  {item.chapter_count} 章 / {item.segment_count} 段
                </small>
              </button>
            ))
          )}
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>当前状态</p>
            <strong>{status}</strong>
          </div>
          {book && <span>{book.title}</span>}
        </header>

        {!book ? (
          <div className="empty-state">
            <BookOpen size={44} />
            <h2>先导入一本书</h2>
            <p>可以粘贴文本，也可以选择 EPUB 文件；导入后可编辑段落和角色。</p>
          </div>
        ) : (
          <div className="editor-grid">
            <section className="reader-pane">
              <nav className="chapter-tabs">
                {book.chapters.map((chapter) => (
                  <button
                    key={chapter.id}
                    className={chapter.id === activeChapter?.id ? 'active' : ''}
                    onClick={() => setActiveChapterId(chapter.id)}
                  >
                    {chapter.title}
                  </button>
                ))}
              </nav>

              <section className="resegment-bar">
                <span>对当前章节手动重新分段</span>
                <div className="resegment-actions">
                  <button onClick={openResegmentDialog}>
                    <FileText size={16} />
                    重新分段
                  </button>
                  <button onClick={openRechapterDialog}>
                    <BookOpen size={16} />
                    全文分章节
                  </button>
                </div>
              </section>

              <IllustrationPanel chapter={activeChapter} />

              <section className="chapter-save-bar">
                <span>
                  {activeChapterDirtyCount > 0
                    ? `本章节有 ${activeChapterDirtyCount} 段未保存`
                    : '本章节没有未保存修改'}
                </span>
                <button
                  disabled={activeChapterDirtyCount === 0 || isSavingChapter}
                  onClick={saveActiveChapterDrafts}
                >
                  <Save size={16} />
                  {isSavingChapter ? '正在保存...' : '保存本章节'}
                </button>
              </section>

              <div className="segments">
                {activeChapter?.segments.map((segment) => (
                  <SegmentEditor
                    key={segment.id}
                    segment={segment}
                    characters={book.characters}
                    draft={segmentDrafts[segment.id]}
                    onDraftChange={updateSegmentDraft}
                    onSave={updateSegment}
                  />
                ))}
              </div>
            </section>

            <aside className="side-pane">
              <section className="export-pane">
                <h2>导出</h2>
                <div className="export-grid">
                  <button onClick={() => downloadExport(`/api/books/${book.id}/export.json`, '整本书 JSON')}>
                    <Download size={16} />
                    整本 JSON
                  </button>
                  <button onClick={() => downloadExport(`/api/books/${book.id}/export.txt`, '整本书 TXT')}>
                    <Download size={16} />
                    整本 TXT
                  </button>
                  <button
                    disabled={!activeChapter}
                    onClick={() => downloadExport(`/api/chapters/${activeChapter.id}/export.json`, '当前章节 JSON')}
                  >
                    <Download size={16} />
                    本章 JSON
                  </button>
                  <button
                    disabled={!activeChapter}
                    onClick={() => downloadExport(`/api/chapters/${activeChapter.id}/export.txt`, '当前章节 TXT')}
                  >
                    <Download size={16} />
                    本章 TXT
                  </button>
                </div>
                <form className="export-import-form" onSubmit={importExportedJsonBook}>
                  <label>
                    回导 JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      disabled={isImportingText || isImportingEpub || isImportingExportJson}
                      onChange={(event) => setExportedJsonFile(event.target.files?.[0] || null)}
                    />
                  </label>
                  <button type="submit" disabled={isImportingText || isImportingEpub || isImportingExportJson}>
                    <FileUp size={16} />
                    {isImportingExportJson ? '正在回导...' : '导入为新书'}
                  </button>
                </form>
              </section>

              <section className="character-pane">
                <h2>角色管理</h2>
                <form className="inline-form" onSubmit={createCharacter}>
                  <input
                    value={newCharacter}
                    onChange={(event) => setNewCharacter(event.target.value)}
                    placeholder="新增角色名"
                  />
                  <button type="submit" title="新增角色">
                    <Plus size={18} />
                  </button>
                </form>

                <div className="character-list">
                  {book.characters.map((character, index) => (
                    <CharacterRow
                      key={character.id}
                      character={character}
                      isFirst={index === 0}
                      isLast={index === book.characters.length - 1}
                      canDelete={book.characters.length > 1}
                      onRename={renameCharacter}
                      onMove={moveCharacter}
                      onDelete={deleteCharacter}
                    />
                  ))}
                </div>
              </section>
            </aside>
          </div>
        )}
      </section>
      {isResegmentOpen && (
        <ResegmentDialog
          title="手动重新分段"
          value={resegmentText}
          isSaving={isResegmenting}
          helpLines={[
            '@段落名: 名称',
            '@正文开始 / @正文结束：显示并朗读',
            '@显示开始 / @显示结束：只显示，不朗读',
          ]}
          confirmLabel="确认重建本章节"
          onChange={setResegmentText}
          onCancel={() => setIsResegmentOpen(false)}
          onConfirm={confirmResegment}
        />
      )}
      {isRechapterOpen && (
        <ResegmentDialog
          title="全文重新分章节"
          value={rechapterText}
          isSaving={isRechaptering}
          helpLines={[
            '@章节名: 章节名称',
            '@插画: img_001 可移动到任意章节；不参与朗读',
            '章节名下一行开始写本章全文，下一次 @章节名 会开始新章节',
            '本功能只区分章节，章节内部会自动分段；段落细节请再用“重新分段”修改',
          ]}
          confirmLabel="确认重建整本书"
          illustrations={rechapterIllustrations}
          onChange={setRechapterText}
          onCancel={() => setIsRechapterOpen(false)}
          onConfirm={confirmRechapter}
        />
      )}
    </main>
  );
}

function formatChapterForResegment(chapter) {
  return chapter.segments
    .map((segment, index) => {
      const label = segment.label || `第 ${index + 1} 段`;
      const start = segment.is_spoken ? '@正文开始' : '@显示开始';
      const end = segment.is_spoken ? '@正文结束' : '@显示结束';
      return `@段落名: ${label}\n${start}\n${segment.text}\n${end}`;
    })
    .join('\n\n');
}

function formatBookForRechapter(book, illustrationLibrary) {
  let illustrationIndex = 0;
  return book.chapters
    .map((chapter) => {
      const illustrationLines = (chapter.illustrations || [])
        .map(() => illustrationLibrary[illustrationIndex++]?.key)
        .filter(Boolean)
        .map((key) => `@插画: ${key}`);
      const content = chapter.segments.map((segment) => segment.text).join('\n\n');
      return [`@章节名: ${chapter.title}`, ...illustrationLines.filter(Boolean), content].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

function ResegmentDialog({
  title,
  value,
  isSaving,
  helpLines,
  confirmLabel,
  illustrations = [],
  onChange,
  onCancel,
  onConfirm,
}) {
  const hasIllustrations = illustrations.length > 0;
  const textareaRef = useRef(null);

  function insertIllustrationAtCursor(key) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const marker = `@插画: ${key}`;
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const suffix = after && !after.startsWith('\n') ? '\n' : '';
    const trailing = after ? '' : '\n';
    const insertText = `${prefix}${marker}${suffix}${trailing}`;
    const nextValue = `${before}${insertText}${after}`;
    const nextCursor = before.length + insertText.length;

    onChange(nextValue);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  return (
    <div className="modal-backdrop">
      <section className={`resegment-dialog ${hasIllustrations ? 'with-illustrations' : ''}`}>
        <header>
          <h2>{title}</h2>
          <button onClick={onCancel}>关闭</button>
        </header>
        <div className="syntax-help">
          {helpLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="resegment-body">
          <textarea
            ref={textareaRef}
            wrap="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          {hasIllustrations && (
            <aside className="illustration-library">
              <h3>插画编号</h3>
              <div className="illustration-library-list">
                {illustrations.map((item) => (
                  <div className="illustration-library-item" key={item.key}>
                    <ImageWithFallback
                      src={`${API_BASE}${item.url}`}
                      alt={item.key}
                      className="illustration-library-thumb"
                    />
                    <div>
                      <strong>{item.key}</strong>
                      <button type="button" onClick={() => insertIllustrationAtCursor(item.key)}>
                        插入
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>
        <footer>
          <button onClick={onCancel}>取消</button>
          <button disabled={isSaving} onClick={onConfirm}>
            <Save size={16} />
            {isSaving ? '正在重建...' : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function IllustrationPanel({ chapter }) {
  const illustrations = chapter?.illustrations || [];
  return (
    <section className="illustration-panel">
      <div className="illustration-header">
        <span>章节插画</span>
        <small>{illustrations.length ? `${illustrations.length} 张` : '暂无插画'}</small>
      </div>
      {illustrations.length ? (
        <div className="chapter-illustration-list">
          {illustrations.map((illustration, index) => (
            <figure className="chapter-illustration-item" key={illustration.id}>
              <figcaption>
                <span>第 {index + 1} 张</span>
                {illustration.key && <strong>{illustration.key}</strong>}
              </figcaption>
              <ImageWithFallback
                src={`${API_BASE}${illustration.url}`}
                alt={illustration.alt || `第 ${index + 1} 张插画`}
                className="chapter-illustration-image"
              />
            </figure>
          ))}
        </div>
      ) : (
        <div className="illustration-empty">
          <FileImage size={30} />
          <span>当前章节没有插画</span>
        </div>
      )}
    </section>
  );
}

function ImageWithFallback({ src, alt, className = '' }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div className={`image-fallback ${className}`}>
        <FileImage size={24} />
        <span>插画加载失败</span>
      </div>
    );
  }

  return <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />;
}

function SegmentEditor({ segment, characters, draft, onDraftChange, onSave }) {
  const [text, setText] = useState(segment.text);
  const [characterId, setCharacterId] = useState(segment.character_id);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setText(segment.text);
    setCharacterId(segment.character_id);
    setDirty(false);
  }, [segment.id, segment.text, segment.character_id]);

  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    setCharacterId(draft.character_id);
    setDirty(true);
  }, [draft]);

  function updateDraft(nextText, nextCharacterId) {
    setText(nextText);
    setCharacterId(nextCharacterId);
    const nextPayload = { text: nextText, character_id: nextCharacterId };
    const isDirty = nextPayload.text !== segment.text || nextPayload.character_id !== segment.character_id;
    setDirty(isDirty);
    onDraftChange(segment, nextPayload);
  }

  return (
    <article className="segment-card">
      <div className="segment-meta">
        <span>第 {segment.position + 1} 段</span>
        {segment.label && <strong>{segment.label}</strong>}
        {!segment.is_spoken && <em>不朗读</em>}
        <select
          value={characterId}
          onChange={(event) => {
            updateDraft(text, Number(event.target.value));
          }}
        >
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={text}
        onChange={(event) => {
          updateDraft(event.target.value, characterId);
        }}
      />
      <div className="segment-actions">
        <span>{dirty ? '有未保存修改' : `角色：${segment.character_name}`}</span>
        <button disabled={!dirty} onClick={() => onSave(segment.id, { text, character_id: characterId })}>
          {dirty ? <Save size={16} /> : <Check size={16} />}
          保存
        </button>
      </div>
    </article>
  );
}

function CharacterRow({ character, isFirst, isLast, canDelete, onRename, onMove, onDelete }) {
  const [name, setName] = useState(character.name);
  const dirty = name !== character.name;

  useEffect(() => {
    setName(character.name);
  }, [character.name]);

  return (
    <div className="character-row">
      <PenLine size={16} />
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <button disabled={!dirty} onClick={() => onRename(character.id, name)}>
        保存
      </button>
      <div className="character-actions">
        <button
          className="character-action"
          disabled={isFirst}
          onClick={() => onMove(character.id, 'top')}
          title="置顶角色"
        >
          <ChevronsUp size={15} />
        </button>
        <button
          className="character-action"
          disabled={isFirst}
          onClick={() => onMove(character.id, 'up')}
          title="上移角色"
        >
          <ArrowUp size={15} />
        </button>
        <button
          className="character-action"
          disabled={isLast}
          onClick={() => onMove(character.id, 'down')}
          title="下移角色"
        >
          <ArrowDown size={15} />
        </button>
        <button
          className="character-action danger"
          disabled={!canDelete}
          onClick={() => onDelete(character)}
          title="删除角色"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
