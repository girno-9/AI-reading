import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  Download,
  FileJson,
  Mic2,
  PackageOpen,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import './phase3.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const STORAGE_KEY = 'ai-reading-phase3-workspace-v1';

function emptyWorkspace() {
  return {
    sourceBook: null,
    characterVoiceMap: {},
    segmentVoiceMap: {},
    importedAt: '',
    updatedAt: '',
  };
}

function App() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [status, setStatus] = useState('导入 1-2 阶段整本 JSON 后开始分配声音');
  const [voicepackInbox, setVoicepackInbox] = useState([]);
  const [voicepacks, setVoicepacks] = useState([]);
  const [isLoadingVoicepacks, setIsLoadingVoicepacks] = useState(false);
  const [activeChapterId, setActiveChapterId] = useState(null);
  const importInputRef = useRef(null);

  const book = workspace.sourceBook;
  const chapters = book?.chapters || [];
  const characters = book?.characters || deriveCharactersFromChapters(chapters);
  const activeChapter = useMemo(() => {
    if (!chapters.length) return null;
    return chapters.find((chapter) => String(chapter.id) === String(activeChapterId)) || chapters[0];
  }, [chapters, activeChapterId]);
  const segmentCount = chapters.reduce((total, chapter) => total + (chapter.segments?.length || 0), 0);
  const assignedCharacters = characters.filter((character) => workspace.characterVoiceMap[getCharacterKey(character)]);
  const overrideCount = Object.keys(workspace.segmentVoiceMap).length;

  useEffect(() => {
    refreshVoicepacks();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    if (!activeChapterId && chapters[0]?.id !== undefined) {
      setActiveChapterId(chapters[0].id);
    }
  }, [activeChapterId, chapters]);

  async function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      validateBookJson(payload);
      const nextWorkspace = normalizeImportedWorkspace(payload);
      setWorkspace(nextWorkspace);
      setActiveChapterId(nextWorkspace.sourceBook.chapters[0]?.id || null);
      setStatus(`已导入：${nextWorkspace.sourceBook.title}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      event.target.value = '';
    }
  }

  async function api(path, options = {}) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: '请求失败，请查看后端 CMD 窗口。' }));
        throw new Error(error.detail || '请求失败，请查看后端 CMD 窗口。');
      }
      return response.json();
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(`无法连接后端：${API_BASE}。请确认后端 CMD 窗口正在运行。`);
      }
      throw error;
    }
  }

  async function refreshVoicepacks() {
    setIsLoadingVoicepacks(true);
    try {
      const [inbox, imported] = await Promise.all([api('/api/voicepacks/inbox'), api('/api/voicepacks')]);
      setVoicepackInbox(inbox);
      setVoicepacks(imported);
      setStatus(`声音包库已刷新：投递区 ${inbox.length} 个，已导入 ${imported.length} 个`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsLoadingVoicepacks(false);
    }
  }

  async function importVoicepack(filename) {
    try {
      setStatus(`正在导入声音包：${filename}`);
      const detail = await api('/api/voicepacks/import', {
        method: 'POST',
        body: JSON.stringify({ filename }),
      });
      await refreshVoicepacks();
      setStatus(`已导入声音包：${detail.voice_name}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteVoicepack(packageId) {
    const voicepack = voicepacks.find((item) => item.package_id === packageId);
    const confirmed = window.confirm(`删除已导入声音包“${voicepack?.voice_name || ''}”吗？投递区原 ZIP 不会删除。`);
    if (!confirmed) return;
    try {
      await api(`/api/voicepacks/${packageId}`, { method: 'DELETE' });
      setWorkspace((current) =>
        touch({
          ...current,
          characterVoiceMap: removeVoiceAssignments(current.characterVoiceMap, packageId),
          segmentVoiceMap: removeVoiceAssignments(current.segmentVoiceMap, packageId),
        }),
      );
      await refreshVoicepacks();
      setStatus('已删除导入副本，相关分配已清空');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function testVoicepack(segment, packageId) {
    if (!packageId) {
      setStatus('当前段落还没有生效声音包');
      return;
    }
    try {
      const result = await api(`/api/voicepacks/${packageId}/test-synthesis`, {
        method: 'POST',
        body: JSON.stringify({ text: segment.text, emotion: segment.label || null }),
      });
      setStatus(result.detail || '试听测试完成');
    } catch (error) {
      setStatus(error.message);
    }
  }

  function setCharacterVoice(character, packageId) {
    const key = getCharacterKey(character);
    setWorkspace((current) => {
      const characterVoiceMap = { ...current.characterVoiceMap };
      if (packageId) characterVoiceMap[key] = packageId;
      else delete characterVoiceMap[key];
      return touch({ ...current, characterVoiceMap });
    });
  }

  function setSegmentVoice(segment, packageId) {
    const key = getSegmentKey(segment);
    setWorkspace((current) => {
      const segmentVoiceMap = { ...current.segmentVoiceMap };
      if (packageId) segmentVoiceMap[key] = packageId;
      else delete segmentVoiceMap[key];
      return touch({ ...current, segmentVoiceMap });
    });
  }

  function resetWorkspace() {
    const confirmed = window.confirm('清空第三阶段当前工作台吗？已下载的 JSON 文件不受影响。');
    if (!confirmed) return;
    localStorage.removeItem(STORAGE_KEY);
    setWorkspace(emptyWorkspace());
    setActiveChapterId(null);
    setStatus('已清空第三阶段工作台');
  }

  function exportPhase3Json() {
    if (!book) {
      setStatus('请先导入 1-2 阶段整本 JSON');
      return;
    }
    const payload = buildPhase3Export(workspace, voicepacks);
    downloadJson(payload, `${sanitizeFilename(payload.title)}_phase3_voice_assignment.json`);
    setStatus('已导出第三阶段 JSON');
  }

  return (
    <main className="phase3-shell">
      <aside className="phase3-sidebar">
        <div className="phase3-brand">
          <Mic2 size={28} />
          <div>
            <h1>第三阶段</h1>
            <p>声音库与段落声音分配</p>
          </div>
        </div>

        <section className="import-panel">
          <div className="panel-heading">
            <FileJson size={18} />
            <span>导入整本 JSON</span>
          </div>
          <input ref={importInputRef} type="file" accept=".json,application/json" onChange={importJson} />
          <button onClick={() => importInputRef.current?.click()}>
            <Upload size={17} />
            选择 1-2 阶段 JSON
          </button>
        </section>

        <section className="book-summary">
          <div className="panel-heading">
            <BookOpen size={18} />
            <span>当前书稿</span>
          </div>
          {book ? (
            <div className="summary-list">
              <strong>{book.title}</strong>
              <span>{chapters.length} 章</span>
              <span>{characters.length} 个角色</span>
              <span>{segmentCount} 段</span>
            </div>
          ) : (
            <p className="muted">尚未导入书稿</p>
          )}
        </section>

        <section className="stats-panel">
          <div>
            <strong>{voicepacks.length}</strong>
            <span>声音包</span>
          </div>
          <div>
            <strong>{assignedCharacters.length}</strong>
            <span>角色默认</span>
          </div>
          <div>
            <strong>{overrideCount}</strong>
            <span>单段覆盖</span>
          </div>
        </section>

        <div className="sidebar-actions">
          <button disabled={!book} onClick={exportPhase3Json}>
            <Download size={17} />
            导出 phase3 JSON
          </button>
          <button className="ghost danger" onClick={resetWorkspace}>
            <Trash2 size={17} />
            清空工作台
          </button>
        </div>
      </aside>

      <section className="phase3-main">
        <header className="phase3-topbar">
          <div>
            <p>当前状态</p>
            <strong>{status}</strong>
          </div>
          {workspace.updatedAt && <span>已暂存 {formatLocalTime(workspace.updatedAt)}</span>}
        </header>

        {!book ? (
          <section className="phase3-empty">
            <FileJson size={48} />
            <h2>导入 1-2 阶段导出的整本 JSON</h2>
            <p>第三阶段不会读取原数据库，也不会改动前一阶段页面；声音分配结果会导出成新的 JSON。</p>
          </section>
        ) : (
          <div className="phase3-grid">
            <section className="voice-library">
              <header>
                <h2>ZIP 声音包库</h2>
                <span>投递区自动识别</span>
              </header>
              <VoicepackLibrary
                inbox={voicepackInbox}
                voicepacks={voicepacks}
                isLoading={isLoadingVoicepacks}
                onRefresh={refreshVoicepacks}
                onImport={importVoicepack}
                onDelete={deleteVoicepack}
              />
            </section>

            <section className="character-voices">
              <header>
                <h2>角色默认声音</h2>
                <span>段落未覆盖时继承</span>
              </header>
              <div className="character-table">
                {characters.map((character) => {
                  const key = getCharacterKey(character);
                  return (
                    <label key={key} className="character-voice-row">
                      <span title={character.name}>{character.name}</span>
                      <select value={workspace.characterVoiceMap[key] || ''} onChange={(event) => setCharacterVoice(character, event.target.value)}>
                        <option value="">未分配</option>
                        {voicepacks.map((voicepack) => (
                          <option key={voicepack.package_id} value={voicepack.package_id}>
                            {voicepack.voice_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="assignment-panel">
              <header>
                <h2>段落声音分配</h2>
                <span>单段覆盖优先于角色默认声音</span>
              </header>
              <nav className="phase3-tabs">
                {chapters.map((chapter) => (
                  <button key={getChapterKey(chapter)} className={String(chapter.id) === String(activeChapter?.id) ? 'active' : ''} onClick={() => setActiveChapterId(chapter.id)}>
                    {chapter.title}
                  </button>
                ))}
              </nav>
              <IllustrationStrip chapter={activeChapter} />
              <div className="segment-table">
                {activeChapter?.segments?.map((segment) => (
                  <SegmentVoiceRow
                    key={getSegmentKey(segment)}
                    segment={segment}
                    voicepacks={voicepacks}
                    characterVoiceMap={workspace.characterVoiceMap}
                    segmentVoiceMap={workspace.segmentVoiceMap}
                    onChange={setSegmentVoice}
                    onTest={testVoicepack}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function VoicepackLibrary({ inbox, voicepacks, isLoading, onRefresh, onImport, onDelete }) {
  return (
    <div className="voicepack-library">
      <button onClick={onRefresh} disabled={isLoading}>
        <RefreshCw size={17} />
        {isLoading ? '正在刷新...' : '刷新投递区'}
      </button>
      <div className="voicepack-path">
        <PackageOpen size={17} />
        <span>backend\\data\\voicepack_inbox</span>
      </div>

      <section className="voicepack-section">
        <h3>投递区 ZIP</h3>
        <div className="voice-list">
          {inbox.length === 0 ? (
            <p className="muted">把 .voicepack.zip 放进投递区后点击刷新</p>
          ) : (
            inbox.map((item) => (
              <article className={`voicepack-row ${item.is_valid ? '' : 'invalid'}`} key={item.filename}>
                <div className="voicepack-info">
                  <strong>{item.voice_name || item.filename}</strong>
                  <small>{item.is_valid ? `${item.character_name || '未命名角色'} / ${item.engine || '未知引擎'}` : item.error}</small>
                  <small>{item.filename}</small>
                </div>
                <button disabled={!item.is_valid} onClick={() => onImport(item.filename)}>
                  <Upload size={16} />
                  导入
                </button>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="voicepack-section">
        <h3>已导入</h3>
        <div className="voice-list">
          {voicepacks.length === 0 ? (
            <p className="muted">还没有导入声音包</p>
          ) : (
            voicepacks.map((voicepack) => (
              <article className="voicepack-row imported" key={voicepack.package_id}>
                <div className="voicepack-info">
                  <strong>{voicepack.voice_name}</strong>
                  <small>{voicepack.character_name} / {voicepack.engine || '未知引擎'}</small>
                  <small>{voicepack.supported_emotions?.length ? voicepack.supported_emotions.join('、') : '未声明情绪'}</small>
                  {voicepack.preview_urls?.[0] && <audio controls src={`${API_BASE}${voicepack.preview_urls[0]}`} />}
                </div>
                <button className="icon-danger" onClick={() => onDelete(voicepack.package_id)} title="删除导入副本">
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function IllustrationStrip({ chapter }) {
  const illustrations = chapter?.illustrations || [];
  if (!illustrations.length) return null;
  return (
    <div className="illustration-strip">
      {illustrations.map((illustration) => (
        <figure key={illustration.id || illustration.url}>
          <img src={illustration.data_url || illustration.url} alt={illustration.alt || '章节插画'} />
          <figcaption>{illustration.alt || '章节插画'}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function SegmentVoiceRow({ segment, voicepacks, characterVoiceMap, segmentVoiceMap, onChange, onTest }) {
  const segmentKey = getSegmentKey(segment);
  const characterKey = String(segment.character_id || segment.character_name || '');
  const overridePackageId = segmentVoiceMap[segmentKey] || '';
  const inheritedPackageId = characterVoiceMap[characterKey] || '';
  const effectivePackageId = overridePackageId || inheritedPackageId;
  const effectiveVoicepack = voicepacks.find((voicepack) => voicepack.package_id === effectivePackageId);

  return (
    <article className="segment-voice-row">
      <div className="segment-index">第 {Number(segment.position || 0) + 1} 段</div>
      <div className="segment-content">
        <div className="segment-meta">
          <span>{segment.character_name || '旁白'}</span>
          {segment.label && <strong>{segment.label}</strong>}
          {!segment.is_spoken && <em>不朗读</em>}
        </div>
        <p>{segment.text}</p>
      </div>
      <div className="segment-voice-select">
        <select value={overridePackageId} onChange={(event) => onChange(segment, event.target.value)}>
          <option value="">继承角色声音包</option>
          {voicepacks.map((voicepack) => (
            <option key={voicepack.package_id} value={voicepack.package_id}>
              {voicepack.voice_name}
            </option>
          ))}
        </select>
        <small>{effectiveVoicepack ? `生效：${effectiveVoicepack.voice_name}` : '生效：未分配'}</small>
        <button className="test-button" disabled={!effectivePackageId} onClick={() => onTest(segment, effectivePackageId)}>
          <Sparkles size={15} />
          测试试听
        </button>
      </div>
    </article>
  );
}

function loadWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyWorkspace();
    const parsed = JSON.parse(raw);
    return {
      ...emptyWorkspace(),
      ...parsed,
      characterVoiceMap: parsed.characterVoiceMap || {},
      segmentVoiceMap: parsed.segmentVoiceMap || {},
    };
  } catch {
    return emptyWorkspace();
  }
}

function validateBookJson(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('JSON 内容不是有效对象');
  if (!String(payload.title || '').trim()) throw new Error('整本 JSON 缺少 title');
  if (!Array.isArray(payload.chapters) || payload.chapters.length === 0) throw new Error('整本 JSON 缺少 chapters');
  for (const chapter of payload.chapters) {
    if (!Array.isArray(chapter.segments)) throw new Error(`章节“${chapter.title || ''}”缺少 segments`);
  }
  const hasCharacters = Array.isArray(payload.characters) && payload.characters.length > 0;
  const hasSegmentCharacters = payload.chapters.some((chapter) => chapter.segments.some((segment) => segment.character_id || segment.character_name));
  if (!hasCharacters && !hasSegmentCharacters) throw new Error('整本 JSON 缺少 characters 或段落角色信息');
}

function normalizeImportedWorkspace(payload) {
  const now = new Date().toISOString();
  const sourceBook = {
    ...payload,
    chapters: payload.chapters.map((chapter, chapterIndex) => ({
      ...chapter,
      id: chapter.id ?? `chapter-${chapterIndex + 1}`,
      position: chapter.position ?? chapterIndex,
      title: chapter.title || `第 ${chapterIndex + 1} 章`,
      illustrations: Array.isArray(chapter.illustrations) ? chapter.illustrations : [],
      segments: (chapter.segments || []).map((segment, segmentIndex) => ({
        ...segment,
        id: segment.id ?? `chapter-${chapterIndex + 1}-segment-${segmentIndex + 1}`,
        position: segment.position ?? segmentIndex,
        character_name: segment.character_name || '旁白',
        label: segment.label || '',
        is_spoken: segment.is_spoken !== false,
      })),
    })),
  };
  if (!Array.isArray(sourceBook.characters) || sourceBook.characters.length === 0) {
    sourceBook.characters = deriveCharactersFromChapters(sourceBook.chapters);
  }

  const knownVoiceIds = new Set();
  const characterVoiceMap = {};
  for (const character of sourceBook.characters) {
    const voiceId = character.default_voice_id || character.voice_id || '';
    if (voiceId && knownVoiceIds.has(voiceId)) characterVoiceMap[getCharacterKey(character)] = voiceId;
  }
  const segmentVoiceMap = {};
  for (const chapter of sourceBook.chapters) {
    for (const segment of chapter.segments) {
      const voiceId = segment.voice_id || segment.override_voice_id || '';
      if (voiceId && knownVoiceIds.has(voiceId)) segmentVoiceMap[getSegmentKey(segment)] = voiceId;
    }
  }

  return { sourceBook, characterVoiceMap, segmentVoiceMap, importedAt: now, updatedAt: now };
}

function buildPhase3Export(workspace, voicepacks) {
  const book = workspace.sourceBook;
  const voicepacksById = new Map(voicepacks.map((voicepack) => [voicepack.package_id, voicepack]));
  const characters = (book.characters || deriveCharactersFromChapters(book.chapters)).map((character) => {
    const defaultVoicepackId = workspace.characterVoiceMap[getCharacterKey(character)] || null;
    return {
      ...character,
      default_voicepack_id: defaultVoicepackId,
      default_voicepack_name: defaultVoicepackId ? voicepacksById.get(defaultVoicepackId)?.voice_name || null : null,
    };
  });
  const characterVoicepackByName = new Map(characters.map((character) => [character.name, character.default_voicepack_id]));
  const characterVoicepackById = new Map(characters.map((character) => [String(character.id), character.default_voicepack_id]));

  return {
    ...book,
    phase: 'phase3_voice_assignment',
    export_version: 3,
    exported_at: new Date().toISOString(),
    voicepacks,
    characters,
    chapters: book.chapters.map((chapter) => ({
      ...chapter,
      segments: chapter.segments.map((segment) => {
        const overrideVoicepackId = workspace.segmentVoiceMap[getSegmentKey(segment)] || null;
        const inheritedVoicepackId =
          characterVoicepackById.get(String(segment.character_id)) || characterVoicepackByName.get(segment.character_name) || null;
        const effectiveVoicepackId = overrideVoicepackId || inheritedVoicepackId || null;
        return {
          ...segment,
          voicepack_id: overrideVoicepackId,
          voicepack_name: overrideVoicepackId ? voicepacksById.get(overrideVoicepackId)?.voice_name || null : null,
          effective_voicepack_id: effectiveVoicepackId,
          effective_voicepack_name: effectiveVoicepackId ? voicepacksById.get(effectiveVoicepackId)?.voice_name || null : null,
        };
      }),
    })),
  };
}

function deriveCharactersFromChapters(chapters) {
  const byKey = new Map();
  for (const chapter of chapters || []) {
    for (const segment of chapter.segments || []) {
      const id = segment.character_id ?? segment.character_name ?? '旁白';
      const key = String(id);
      if (!byKey.has(key)) byKey.set(key, { id, name: segment.character_name || '旁白', position: byKey.size });
    }
  }
  return [...byKey.values()];
}

function getCharacterKey(character) {
  return String(character.id ?? character.name);
}

function getChapterKey(chapter) {
  return String(chapter.id ?? chapter.title);
}

function getSegmentKey(segment) {
  return String(segment.id ?? `${segment.position}-${segment.text}`);
}

function removeVoiceAssignments(map, voiceId) {
  return Object.fromEntries(Object.entries(map).filter(([, assignedVoiceId]) => assignedVoiceId !== voiceId));
}

function touch(workspace) {
  return { ...workspace, updatedAt: new Date().toISOString() };
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(value) {
  return String(value || 'book').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'book';
}

function formatLocalTime(value) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

createRoot(document.getElementById('phase3-root')).render(<App />);
