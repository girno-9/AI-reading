import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  CheckCircle2,
  Download,
  FileAudio,
  FileJson,
  Mic2,
  Plus,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import './phase3.css';

const STORAGE_KEY = 'ai-reading-phase3-workspace-v1';
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'flac', 'ogg'];
const AUDIO_TYPES = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/ogg'];

function emptyWorkspace() {
  return {
    sourceBook: null,
    voices: [],
    characterVoiceMap: {},
    segmentVoiceMap: {},
    importedAt: '',
    updatedAt: '',
  };
}

function App() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [status, setStatus] = useState('导入 1-2 阶段整本 JSON 后开始分配声音');
  const [voiceName, setVoiceName] = useState('');
  const [voiceNote, setVoiceNote] = useState('');
  const [voiceFile, setVoiceFile] = useState(null);
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

  async function addVoice(event) {
    event.preventDefault();
    const cleanName = voiceName.trim();
    if (!cleanName) {
      setStatus('请填写声音名称');
      return;
    }
    if (!voiceFile) {
      setStatus('请选择声音样本文件');
      return;
    }
    try {
      validateAudioFile(voiceFile);
      const dataUrl = await fileToDataUrl(voiceFile);
      const now = new Date().toISOString();
      const voice = {
        id: createLocalId('voice'),
        name: cleanName,
        note: voiceNote.trim(),
        sample_filename: voiceFile.name,
        sample_type: voiceFile.type || guessAudioType(voiceFile.name),
        sample_data_url: dataUrl,
        created_at: now,
      };
      setWorkspace((current) => touch({ ...current, voices: [...current.voices, voice] }));
      setVoiceName('');
      setVoiceNote('');
      setVoiceFile(null);
      setStatus(`已添加声音：${voice.name}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function renameVoice(voiceId, nextName) {
    const cleanName = nextName.trim();
    if (!cleanName) return;
    setWorkspace((current) =>
      touch({
        ...current,
        voices: current.voices.map((voice) => (voice.id === voiceId ? { ...voice, name: cleanName } : voice)),
      }),
    );
    setStatus('声音名称已更新');
  }

  function updateVoiceNote(voiceId, note) {
    setWorkspace((current) =>
      touch({
        ...current,
        voices: current.voices.map((voice) => (voice.id === voiceId ? { ...voice, note } : voice)),
      }),
    );
  }

  function deleteVoice(voiceId) {
    const voice = workspace.voices.find((item) => item.id === voiceId);
    const confirmed = window.confirm(`删除声音“${voice?.name || ''}”吗？相关角色默认声音和段落覆盖会被清空。`);
    if (!confirmed) return;
    setWorkspace((current) =>
      touch({
        ...current,
        voices: current.voices.filter((item) => item.id !== voiceId),
        characterVoiceMap: removeVoiceAssignments(current.characterVoiceMap, voiceId),
        segmentVoiceMap: removeVoiceAssignments(current.segmentVoiceMap, voiceId),
      }),
    );
    setStatus('声音已删除，相关分配已清空');
  }

  function setCharacterVoice(character, voiceId) {
    const key = getCharacterKey(character);
    setWorkspace((current) => {
      const characterVoiceMap = { ...current.characterVoiceMap };
      if (voiceId) characterVoiceMap[key] = voiceId;
      else delete characterVoiceMap[key];
      return touch({ ...current, characterVoiceMap });
    });
  }

  function setSegmentVoice(segment, voiceId) {
    const key = getSegmentKey(segment);
    setWorkspace((current) => {
      const segmentVoiceMap = { ...current.segmentVoiceMap };
      if (voiceId) segmentVoiceMap[key] = voiceId;
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
    const payload = buildPhase3Export(workspace);
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
            <strong>{workspace.voices.length}</strong>
            <span>声音</span>
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
                <h2>声音库</h2>
                <span>样本会写入导出文件</span>
              </header>
              <form className="voice-form" onSubmit={addVoice}>
                <input value={voiceName} onChange={(event) => setVoiceName(event.target.value)} placeholder="声音名称，例如：温柔女声" />
                <input value={voiceNote} onChange={(event) => setVoiceNote(event.target.value)} placeholder="备注，例如：旁白 / 慢速 / 清亮" />
                <label className="file-picker">
                  <FileAudio size={17} />
                  <span>{voiceFile ? voiceFile.name : '选择 wav / mp3 / m4a / flac / ogg'}</span>
                  <input type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,audio/*" onChange={(event) => setVoiceFile(event.target.files?.[0] || null)} />
                </label>
                <button type="submit">
                  <Plus size={17} />
                  添加声音
                </button>
              </form>
              <div className="voice-list">
                {workspace.voices.length === 0 ? (
                  <p className="muted">还没有声音样本</p>
                ) : (
                  workspace.voices.map((voice) => (
                    <VoiceRow key={voice.id} voice={voice} onRename={renameVoice} onNoteChange={updateVoiceNote} onDelete={deleteVoice} />
                  ))
                )}
              </div>
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
                        {workspace.voices.map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name}
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
                    voices={workspace.voices}
                    characterVoiceMap={workspace.characterVoiceMap}
                    segmentVoiceMap={workspace.segmentVoiceMap}
                    onChange={setSegmentVoice}
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

function VoiceRow({ voice, onRename, onNoteChange, onDelete }) {
  const [name, setName] = useState(voice.name);

  useEffect(() => {
    setName(voice.name);
  }, [voice.name]);

  return (
    <article className="voice-row">
      <div className="voice-icon">
        <Volume2 size={18} />
      </div>
      <div className="voice-fields">
        <div className="voice-name-line">
          <input value={name} onChange={(event) => setName(event.target.value)} />
          <button disabled={name.trim() === voice.name} onClick={() => onRename(voice.id, name)}>
            <CheckCircle2 size={15} />
            保存
          </button>
        </div>
        <input value={voice.note || ''} onChange={(event) => onNoteChange(voice.id, event.target.value)} placeholder="备注" />
        <small>{voice.sample_filename}</small>
        <audio controls src={voice.sample_data_url} />
      </div>
      <button className="icon-danger" onClick={() => onDelete(voice.id)} title="删除声音">
        <Trash2 size={16} />
      </button>
    </article>
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

function SegmentVoiceRow({ segment, voices, characterVoiceMap, segmentVoiceMap, onChange }) {
  const segmentKey = getSegmentKey(segment);
  const characterKey = String(segment.character_id || segment.character_name || '');
  const overrideVoiceId = segmentVoiceMap[segmentKey] || '';
  const inheritedVoiceId = characterVoiceMap[characterKey] || '';
  const effectiveVoiceId = overrideVoiceId || inheritedVoiceId;
  const effectiveVoice = voices.find((voice) => voice.id === effectiveVoiceId);

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
        <select value={overrideVoiceId} onChange={(event) => onChange(segment, event.target.value)}>
          <option value="">继承角色声音</option>
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
            </option>
          ))}
        </select>
        <small>{effectiveVoice ? `生效：${effectiveVoice.name}` : '生效：未分配'}</small>
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
      voices: Array.isArray(parsed.voices) ? parsed.voices : [],
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

  const voices = Array.isArray(payload.voices)
    ? payload.voices.map((voice, index) => ({
        id: voice.id || createLocalId(`voice-${index + 1}`),
        name: voice.name || `声音 ${index + 1}`,
        note: voice.note || '',
        sample_filename: voice.sample_filename || voice.filename || '',
        sample_type: voice.sample_type || '',
        sample_data_url: voice.sample_data_url || voice.data_url || '',
        created_at: voice.created_at || now,
      }))
    : [];
  const knownVoiceIds = new Set(voices.map((voice) => voice.id));
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

  return { sourceBook, voices, characterVoiceMap, segmentVoiceMap, importedAt: now, updatedAt: now };
}

function buildPhase3Export(workspace) {
  const book = workspace.sourceBook;
  const voicesById = new Map(workspace.voices.map((voice) => [voice.id, voice]));
  const characters = (book.characters || deriveCharactersFromChapters(book.chapters)).map((character) => {
    const defaultVoiceId = workspace.characterVoiceMap[getCharacterKey(character)] || null;
    return {
      ...character,
      default_voice_id: defaultVoiceId,
      default_voice_name: defaultVoiceId ? voicesById.get(defaultVoiceId)?.name || null : null,
    };
  });
  const characterVoiceByName = new Map(characters.map((character) => [character.name, character.default_voice_id]));
  const characterVoiceById = new Map(characters.map((character) => [String(character.id), character.default_voice_id]));

  return {
    ...book,
    phase: 'phase3_voice_assignment',
    export_version: 3,
    exported_at: new Date().toISOString(),
    voices: workspace.voices,
    characters,
    chapters: book.chapters.map((chapter) => ({
      ...chapter,
      segments: chapter.segments.map((segment) => {
        const overrideVoiceId = workspace.segmentVoiceMap[getSegmentKey(segment)] || null;
        const inheritedVoiceId = characterVoiceById.get(String(segment.character_id)) || characterVoiceByName.get(segment.character_name) || null;
        const effectiveVoiceId = overrideVoiceId || inheritedVoiceId || null;
        return {
          ...segment,
          voice_id: overrideVoiceId,
          voice_name: overrideVoiceId ? voicesById.get(overrideVoiceId)?.name || null : null,
          effective_voice_id: effectiveVoiceId,
          effective_voice_name: effectiveVoiceId ? voicesById.get(effectiveVoiceId)?.name || null : null,
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

function validateAudioFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const validExtension = AUDIO_EXTENSIONS.includes(extension);
  const validType = !file.type || AUDIO_TYPES.includes(file.type) || file.type.startsWith('audio/');
  if (!validExtension || !validType) throw new Error('声音样本只支持 wav、mp3、m4a、flac、ogg');
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取声音样本失败'));
    reader.readAsDataURL(file);
  });
}

function guessAudioType(filename) {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'm4a') return 'audio/mp4';
  if (extension === 'flac') return 'audio/flac';
  if (extension === 'ogg') return 'audio/ogg';
  return 'audio/wav';
}

function createLocalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
