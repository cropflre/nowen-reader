import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  Activity, ArrowLeft, ArrowRight, Bell, BookOpen, Check, ChevronDown, ChevronLeft,
  ChevronRight, ChevronsLeft, Circle, EllipsisVertical, Folder, Grid2X2,
  Grid3X3, Heart, LayoutDashboard, Layers, LibraryBig, List, Menu, Pause, Play,
  Plus, RotateCcw, RotateCw, Scan, Search, SearchX, Settings, Star, X,
  Shuffle, ZoomIn, ZoomOut,
} from "lucide-react";
import t from "@/lib/i18n/locales/zh-CN";
import {
  bookCount as count, bookFinished, bookFormat, bookPage, bookProgress as progress,
  bookStarted, bookUnit, initialBooks, selectDashboardBooks, withReadingPage,
  type ContentType, type PreviewBook as Book,
} from "./library-data";
import "./style.css";

const asset = (name: string) => `/shelf-preview/${name}.jpg`;
const storageKey = "nowen:shelf-preview:v2";
type PreviewSettings = { motion: boolean; glow: boolean; compact: boolean };
type View = "Dashboard" | "Libraries" | "Collections" | "Reading lists" | "Settings";

const navigation = [
  { name: "Dashboard" as const, icon: LayoutDashboard },
  { name: "Libraries" as const, icon: LibraryBig },
  { name: "Collections" as const, icon: Folder },
  { name: "Reading lists" as const, icon: List },
  { name: "Settings" as const, icon: Settings },
];
function loadPreview() {
  let saved: { progress?: Record<string, unknown>; favorites?: unknown; settings?: Partial<PreviewSettings> } = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem("nowen:shelf-preview:v1") || "{}");
    if (!saved || typeof saved !== "object") saved = {};
  } catch { /* Browser storage is optional for the preview. */ }
  const favorites = Array.isArray(saved.favorites) ? saved.favorites.filter((id): id is string => typeof id === "string" && initialBooks.some((book) => book.id === id)) : ["afterglow", "wanderer"];
  return {
    books: initialBooks.map((book) => {
      const page = saved.progress?.[book.id];
      let restored = book;
      if (typeof page === "number" && Number.isFinite(page)) restored = withReadingPage(book, page);
      if (page && typeof page === "object" && "lastReadPage" in page && typeof page.lastReadPage === "number" && Number.isFinite(page.lastReadPage)) {
        restored = withReadingPage(book, page.lastReadPage + 1);
        if ("lastReadAt" in page && (page.lastReadAt === null || (typeof page.lastReadAt === "string" && Number.isFinite(Date.parse(page.lastReadAt))))) restored.lastReadAt = page.lastReadAt;
        if ("readingStatus" in page && typeof page.readingStatus === "string") restored.readingStatus = page.readingStatus;
      }
      return { ...restored, isFavorite: favorites.includes(book.id) };
    }),
    favorites,
    settings: {
      motion: typeof saved.settings?.motion === "boolean" ? saved.settings.motion : true,
      glow: typeof saved.settings?.glow === "boolean" ? saved.settings.glow : true,
      compact: typeof saved.settings?.compact === "boolean" ? saved.settings.compact : false,
    },
  };
}

function ProgressRing({ value, color, className = "", displayValue, label }: { value: number; color: string; className?: string; displayValue?: string; label?: string }) {
  return <div className={`progress-ring ${className}`} style={{ "--ring-value": `${value}%`, "--gauge-value": `${value * 0.75}%`, "--ring-color": color } as React.CSSProperties} aria-label={label || `${value}% 已完成`}><span>{displayValue || `${value}%`}</span></div>;
}

function BrowserBar() {
  return <div className="browser-bar" aria-hidden="true">
    <div className="browser-tabs"><span className="window-dots"><i /><i /><i /></span><span className="active-browser-tab"><span className="tab-mark">N</span> My Shelf <X className="tab-close" size={12} /></span><Plus size={15} /><ChevronDown className="browser-dropdown" size={17} /></div>
    <div className="browser-address-row"><ArrowLeft size={14} /><ArrowRight size={14} /><RotateCw size={14} /><div className="address-field"><Circle size={13} /> myshelf.local/dashboard</div><Star size={17} /><EllipsisVertical size={17} /></div>
  </div>;
}

function Sidebar({ view, collapsed, open, onNavigate, onCollapse }: { view: View; collapsed: boolean; open: boolean; onNavigate: (view: View) => void; onCollapse: () => void }) {
  return <aside className={`sidebar${open ? " mobile-open" : ""}`}>
    <div className="brand"><span className="brand-icon"><BookOpen size={25} strokeWidth={2.2} /></span><strong>My Shelf</strong><button className="icon-button collapse-icon" onClick={onCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><ChevronsLeft size={17} /></button></div>
    <nav className="side-nav" aria-label="Navigation">{navigation.map(({ name, icon: Icon }) => <button key={name} className={`side-link${view === name ? " selected" : ""}`} title={name} aria-current={view === name ? "page" : undefined} onClick={() => onNavigate(name)}><Icon size={19} /><span>{name}</span></button>)}</nav>
  </aside>;
}

function TopBar({ query, onQuery, onMenu, onNavigate, scanProgress }: { query: string; onQuery: (value: string) => void; onMenu: () => void; onNavigate: (view: View) => void; scanProgress: number }) {
  const [menu, setMenu] = useState<"notifications" | "profile" | null>(null);
  const [unread, setUnread] = useState(true);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!header.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  return <header className="topbar" ref={header}>
    <button className="icon-button mobile-menu-button" onClick={onMenu} title="Navigation" aria-label="Open navigation"><Menu size={20} /></button>
    <div className="search-box"><Search size={19} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search manga/novels..." aria-label="Search books" />{query && <button className="icon-button search-clear" onClick={() => onQuery("")} title="Clear search" aria-label="Clear search"><X size={15} /></button>}</div>
    <div className="topbar-user"><button className="icon-button notification" onClick={() => { setMenu(menu === "notifications" ? null : "notifications"); setUnread(false); }} title="Notifications" aria-label="Notifications" aria-expanded={menu === "notifications"}><Bell size={19} />{unread && <i />}</button><button className="profile-button" onClick={() => setMenu(menu === "profile" ? null : "profile")} aria-label="Alex's account" aria-expanded={menu === "profile"}><img src={asset("winter")} alt="" /><span>Alex</span></button></div>
    {menu === "notifications" && <div className="topbar-popover" role="dialog" aria-label="Notifications"><h3>Notifications</h3><div className="notification-item"><Scan size={17} /><div><strong>{scanProgress >= 100 ? "Library scan complete" : "Library scan in progress"}</strong><small>{scanProgress >= 100 ? "3,480 files checked" : `${Math.round(scanProgress)}% complete`}</small></div></div><div className="notification-item"><BookOpen size={17} /><div><strong>Your shelf is up to date</strong><small>12 books in your library</small></div></div></div>}
    {menu === "profile" && <div className="topbar-popover profile-menu" role="menu" aria-label="Account"><strong>Alex</strong><small>Personal library</small><button role="menuitem" onClick={() => { onNavigate("Collections"); setMenu(null); }}><Heart size={16} /> My collection</button><button role="menuitem" onClick={() => { onNavigate("Settings"); setMenu(null); }}><Settings size={16} /> Settings</button></div>}
  </header>;
}

function FeatureCard({ book, position, onSelect, onRead }: { book: Book; position: number; onSelect: () => void; onRead: () => void }) {
  const active = position === 4;
  return <article className={`feature-card feature-position-${position}${active ? " active" : ""}`}>
    <button className="feature-art" onClick={onSelect} aria-label={`选择 ${book.title}`} aria-pressed={active}><img src={book.coverUrl} alt="" draggable={false} />{active && <ProgressRing value={progress(book)} color={book.accent} className="feature-ring" />}</button>
    <div className="feature-footer"><div className="feature-meta"><span title={book.title}>{book.title}</span>{!active && <small>{bookPage(book)}/{book.pageCount}{bookUnit(book)}</small>}</div><div className="feature-progress"><span style={{ width: `${progress(book)}%`, backgroundColor: book.accent }} /></div><button className="continue-button" onClick={onRead} aria-label={`继续阅读 ${book.title}`}>{t.dashboard.continueAction}</button></div>
  </article>;
}

function ReadingCarousel({ books, selected, onSelected, onRead }: { books: Book[]; selected: string; onSelected: (id: string) => void; onRead: (id: string) => void }) {
  const current = Math.max(0, books.findIndex((book) => book.id === selected));
  const slots = [[4], [3, 4], [3, 4, 5], [2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6, 7]][books.length - 1];
  const [dragOffset, setDragOffset] = useState(0);
  const pointer = useRef<{ x: number; id: number } | null>(null);
  const suppressClick = useRef(0);
  const move = (direction: number) => onSelected(books[(current + direction + books.length) % books.length].id);
  const select = (id: string) => { if (Date.now() >= suppressClick.current) onSelected(id); };
  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointer.current || pointer.current.id !== event.pointerId) return;
    const delta = event.clientX - pointer.current.x;
    if (Math.abs(delta) > 40) { move(delta < 0 ? 1 : -1); suppressClick.current = Date.now() + 250; }
    pointer.current = null;
    setDragOffset(0);
  };
  return <section className="reading-section">
    <div className="reading-heading"><div className="section-title"><h1>{t.dashboard.continueReading}</h1><span>{books.length} 本阅读中</span></div><div className="carousel-controls"><button className="icon-button" onClick={() => move(-1)} disabled={books.length < 2} aria-label="上一本" title="上一本"><ChevronLeft size={18} /></button><button className="icon-button" onClick={() => move(1)} disabled={books.length < 2} aria-label="下一本" title="下一本"><ChevronRight size={18} /></button></div></div>
    <div className={`feature-stage book-count-${books.length}${dragOffset ? " dragging" : ""}`} role="region" aria-label="继续阅读书架" tabIndex={0} style={{ "--drag-offset": `${dragOffset}px` } as React.CSSProperties}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); } }}
      onPointerDown={(event) => { if (event.button === 0 && !(event.target as Element).closest(".continue-button")) pointer.current = { x: event.clientX, id: event.pointerId }; }}
      onPointerMove={(event) => { if (pointer.current?.id === event.pointerId) { const delta = event.clientX - pointer.current.x; if (Math.abs(delta) > 12) { event.currentTarget.setPointerCapture(event.pointerId); setDragOffset(Math.max(-35, Math.min(35, delta * 0.2))); } } }}
      onPointerUp={finishDrag} onPointerCancel={() => { pointer.current = null; setDragOffset(0); }}>
      {books.map((book, index) => <FeatureCard key={book.id} book={book} position={slots[(index - current + slots.indexOf(4) + books.length) % books.length]} onSelect={() => select(book.id)} onRead={() => onRead(book.id)} />)}
    </div>
  </section>;
}

function ProjectDashboard({ books, type, selected, scanProgress, paused, onType, onSelected, onRead, onDetail, onFavorite, onBrowse, onList }: {
  books: Book[]; type: ContentType; selected: string; scanProgress: number; paused: boolean;
  onType: (type: ContentType) => void; onSelected: (id: string) => void; onRead: (id: string) => void;
  onDetail: (id: string) => void; onFavorite: (id: string) => void; onBrowse: () => void;
  onList: (status: string) => void;
}) {
  const model = useMemo(() => selectDashboardBooks(books, type), [books, type]);
  const [randomId, setRandomId] = useState("winter-1");
  const randomBook = model.visible.find((book) => book.id === randomId) || model.visible.find((book) => !bookStarted(book)) || model.visible[0];
  const shuffle = () => {
    const choices = model.visible.filter((book) => book.id !== randomBook?.id);
    if (choices.length) setRandomId(choices[Math.floor(Math.random() * choices.length)].id);
  };
  return <div className="project-dashboard">
    <div className="project-toolbar"><div className="project-type-tabs" role="tablist" aria-label="内容类型">{(["all", "comic", "novel"] as const).map((value) => {
      const Icon = value === "all" ? Layers : value === "comic" ? LibraryBig : BookOpen;
      return <button key={value} role="tab" aria-selected={type === value} onClick={() => onType(value)}><Icon size={15} />{t.contentTab[value]}<span>{books.filter((book) => value === "all" || book.type === value).length}</span></button>;
    })}</div><button className="text-action" onClick={onBrowse}>{t.dashboard.allLibrary}<ArrowRight size={15} /></button></div>
    <div className="project-content"><div className="project-shelves">
      {model.reading.length ? <ReadingCarousel books={model.reading} selected={selected} onSelected={onSelected} onRead={onRead} /> : <section className="reading-empty"><BookOpen size={30} /><h1>暂无阅读记录</h1><button className="secondary-button" onClick={onBrowse}>{t.dashboard.browseLibrary}<ArrowRight size={15} /></button></section>}
      <section className="recent-section"><div className="section-heading"><h2>{t.dashboard.recentlyAdded}</h2><button className="text-action" onClick={onBrowse}>{t.dashboard.viewAll}<ArrowRight size={14} /></button></div><BookGrid books={model.recent} favorites={books.filter((book) => book.isFavorite).map((book) => book.id)} onDetail={onDetail} onFavorite={onFavorite} /></section>
    </div><aside className="project-aside" aria-label="书库状态">
      <section className="project-server"><div className="aside-heading"><h2><Activity size={15} />{t.dashboard.server}</h2><span className="preview-status">示例</span></div><div className="gauges"><div><ProgressRing value={25} color="#7aa6df" className="gauge-ring" displayValue="8" label="CPU 8 核心" /><span>CPU · {t.dashboard.cores}</span></div><div><ProgressRing value={116 / 512 * 100} color="#d7aa72" className="gauge-ring" displayValue="116" label="内存 116 MB" /><span>{t.dashboard.memory} · MB</span></div><div><ProgressRing value={paused || scanProgress >= 100 ? 26 : 38} color="#8ec5a2" className="gauge-ring" displayValue={paused || scanProgress >= 100 ? "26" : "38"} label="Go 协程" /><span>{t.dashboard.goroutines}</span></div></div><div className="project-platform"><span>Go · SQLite</span><span>linux / arm64</span></div><div className="project-scan-status"><Scan size={15} /><span>{scanProgress >= 100 ? "扫描完成" : paused ? "扫描已暂停" : "正在扫描书库"}</span><strong>{Math.floor(scanProgress)}%</strong></div></section>
      <section className="project-overview"><div className="aside-heading"><h2><Layers size={15} />{t.dashboard.libraryOverview}</h2></div><div className="overview-metrics"><button onClick={onBrowse}><strong>{model.visible.length}</strong><span>{t.dashboard.totalItems}</span></button><button onClick={() => onList("In progress")}><strong>{model.readingCount}</strong><span>阅读中</span></button><button onClick={() => onList("Unread")}><strong>{model.unread}</strong><span>{t.dashboard.unread}</span></button><button onClick={() => onList("Finished")}><strong>{model.finished}</strong><span>已读</span></button></div></section>
      {randomBook && <section className="project-random"><div className="aside-heading"><h2><Shuffle size={15} />{t.dashboard.randomPick}</h2><button className="icon-button" onClick={shuffle} disabled={model.visible.length < 2} title={t.dashboard.shuffle} aria-label={t.dashboard.shuffle}><Shuffle size={16} /></button></div><button className="random-book" onClick={() => onRead(randomBook.id)} aria-label={`阅读推荐 ${randomBook.title}`}><img src={randomBook.coverUrl} alt="" /><span><strong>{randomBook.title}</strong><small>{randomBook.author}</small><small>{bookFormat(randomBook)} · {randomBook.pageCount} {bookUnit(randomBook)}</small></span><ChevronRight size={17} /></button></section>}
    </aside></div>
  </div>;
}

function BookGrid({ books, favorites, onDetail, onFavorite }: { books: Book[]; favorites: string[]; onDetail: (id: string) => void; onFavorite: (id: string) => void }) {
  return <div className="recent-grid">{books.map((book) => <article className="recent-card" key={book.id}>
    <button className="book-card-button" onClick={() => onDetail(book.id)} aria-label={`查看 ${book.title}`}><div className="recent-cover"><img src={book.coverUrl} alt="" loading="lazy" /><span className={`recent-badge${bookFinished(book) ? " gold" : book.type === "novel" ? " purple" : " green"}`}>{bookFinished(book) ? "已读" : bookStarted(book) ? `${progress(book)}%` : "未读"}</span><span className="book-format">{bookFormat(book)}</span></div><div className="recent-title" title={book.title}>{book.title}</div><div className="recent-subtitle">{book.author} <span>·</span> {book.pageCount} {bookUnit(book)}</div></button>
    <button className={`icon-button recent-favorite${favorites.includes(book.id) ? " saved" : ""}`} onClick={() => onFavorite(book.id)} title={favorites.includes(book.id) ? "取消收藏" : "收藏"} aria-label={`${favorites.includes(book.id) ? "取消收藏" : "收藏"} ${book.title}`} aria-pressed={favorites.includes(book.id)}><Heart size={16} fill={favorites.includes(book.id) ? "currentColor" : "none"} /></button>
  </article>)}</div>;
}

function Modal({ children, className, label, onClose }: { children: React.ReactNode; className: string; label: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className={className} aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>{children}</dialog>;
}

function BookDetail({ book, favorite, onFavorite, onProgress, onRead, onClose }: { book: Book; favorite: boolean; onFavorite: () => void; onProgress: (page: number) => void; onRead: () => void; onClose: () => void }) {
  return <Modal className="book-dialog" label={`${book.title} 详情`} onClose={onClose}>
    <button className="icon-button modal-close" onClick={onClose} title="关闭" aria-label="关闭书籍详情" autoFocus><X size={21} /></button><img className="detail-cover" src={book.coverUrl} alt={`${book.title} 封面`} />
    <div className="detail-content"><span className="detail-category">{book.library} / {book.genre}</span><h2>{book.title}</h2><div className="detail-metadata"><span>{book.author}</span><span>{bookFormat(book)}</span><span>{(book.fileSize / 1024 / 1024).toFixed(1)} MB</span></div><p>{book.description}</p><div className="detail-progress"><span>{bookFinished(book) ? "已读" : bookStarted(book) ? "阅读中" : "未读"}</span><strong>{progress(book)}%</strong></div><div className="feature-progress"><span style={{ width: `${progress(book)}%`, backgroundColor: book.accent }} /></div><small className="detail-count">{count(book)}</small><div className="detail-actions"><button className="primary-button" onClick={onRead}><BookOpen size={17} />{bookStarted(book) && !bookFinished(book) ? t.dashboard.continueAction : "开始阅读"}</button><button className={`secondary-button${favorite ? " is-saved" : ""}`} onClick={onFavorite} aria-pressed={favorite}><Heart size={17} fill={favorite ? "currentColor" : "none"} />{favorite ? "已收藏" : "加入收藏"}</button></div><div className="detail-minor-actions"><button onClick={() => onProgress(book.pageCount)} disabled={bookFinished(book)}><Check size={15} /> 标为已读</button><button onClick={() => onProgress(0)} disabled={!bookStarted(book)}><RotateCcw size={15} /> 重置进度</button></div></div>
  </Modal>;
}

function Reader({ book, onProgress, onClose }: { book: Book; onProgress: (page: number) => void; onClose: () => void }) {
  const [page, setPage] = useState(bookStarted(book) && !bookFinished(book) ? Math.max(1, bookPage(book)) : 1);
  const [zoom, setZoom] = useState(1);
  const pageContent = useRef<HTMLDivElement>(null);
  const novel = book.type === "novel";
  const pages = [book.coverUrl, asset(book.genre === "热血" ? "shadow" : "wanderer"), asset(book.genre === "冒险" ? "northwind" : "ember")];
  useEffect(() => { onProgress(page); pageContent.current?.scrollTo({ top: 0, left: 0 }); }, [page]);
  const changePage = (value: number) => { setPage(Math.max(1, Math.min(book.pageCount, value))); if (!novel) setZoom(1); };
  return <Modal className="reader-dialog" label={`阅读 ${book.title}`} onClose={onClose}><div className="reader-shell" onKeyDown={(event) => { if ((event.target as HTMLElement).tagName === "INPUT") return; if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); changePage(page + (event.key === "ArrowRight" ? 1 : -1)); } }}>
    <header className="reader-header"><div><BookOpen size={18} /><strong>{book.title}</strong></div><div className="reader-tools"><button className="icon-button" onClick={() => setZoom(Math.max(1, zoom - 0.25))} disabled={zoom <= 1} title={novel ? "缩小字号" : "缩小"} aria-label={novel ? "缩小字号" : "缩小"}><ZoomOut size={19} /></button><button className="icon-button" onClick={() => setZoom(Math.min(2, zoom + 0.25))} disabled={zoom >= 2} title={novel ? "增大字号" : "放大"} aria-label={novel ? "增大字号" : "放大"}><ZoomIn size={19} /></button><button className="icon-button" onClick={() => setZoom(1)} title={novel ? "默认字号" : "适应页面"} aria-label={novel ? "默认字号" : "适应页面"}><Scan size={19} /></button><button className="icon-button" onClick={onClose} title="关闭阅读器" aria-label="关闭阅读器" autoFocus><X size={21} /></button></div></header>
    {novel ? <div ref={pageContent} className="reader-page novel-page"><article key={page} className="novel-chapter" style={{ fontSize: `${18 * zoom}px` }}><div className="novel-chapter-label">{book.author} · {book.title}</div><h1>第 {page} 章 {['风中的来信', '河谷的清晨', '长路与归途'][(page - 1) % 3]}</h1><p>{book.description}</p><p>晨光穿过窗沿，落在那张泛黄的地图上。她把最后一封信放进包里，推开木门。远处的山林被薄雾笼罩，只有河水还在缓缓流动。</p><p>这条路她曾经走过很多次，但今天的风与从前不同。路旁有人种下了新的树，石桥也修好了。那些看似漫长的岁月，原来一直悄悄留在寻常的角落。</p><p>她在桥边停了一会儿，想起昨晚听见的故事。旅人说，答案从来不在地图的尽头，而在一次次出发的路上。她笑了笑，决定先去看看河流转弯的地方。</p><p>太阳慢慢升起，村庄里传来了开门的声音。新的旅途就这样开始，没有盛大的告别，也没有人知道它会通向哪里。</p></article></div> : <div ref={pageContent} className="reader-page" onDoubleClick={() => setZoom(zoom > 1 ? 1 : 1.5)}><img key={page} src={pages[(page - 1) % pages.length]} alt={`${book.title} 第 ${page} 页`} style={{ maxWidth: `${zoom * 100}%`, maxHeight: `${zoom * 100}%` }} /></div>}
    <footer className="reader-footer"><button className="icon-button" onClick={() => changePage(page - 1)} disabled={page <= 1} title={novel ? "上一章" : "上一页"} aria-label={novel ? "上一章" : "上一页"}><ChevronLeft size={21} /></button><input type="range" min={1} max={book.pageCount} value={page} onChange={(event) => changePage(Number(event.target.value))} aria-label={novel ? "阅读章节" : "阅读页码"} /><span>{page} / {book.pageCount} {bookUnit(book)}</span><button className="icon-button" onClick={() => changePage(page + 1)} disabled={page >= book.pageCount} title={novel ? "下一章" : "下一页"} aria-label={novel ? "下一章" : "下一页"}><ChevronRight size={21} /></button></footer>
  </div></Modal>;
}

function SettingsView({ settings, onChange }: { settings: PreviewSettings; onChange: (settings: PreviewSettings) => void }) {
  return <section className="settings-view"><h1>设置</h1><h2>外观</h2><label className="setting-row"><span>封面动效</span><input type="checkbox" className="toggle-switch" checked={settings.motion} onChange={(event) => onChange({ ...settings, motion: event.target.checked })} /></label><label className="setting-row"><span>封面高光</span><input type="checkbox" className="toggle-switch" checked={settings.glow} onChange={(event) => onChange({ ...settings, glow: event.target.checked })} /></label><div className="setting-row"><span>书架密度</span><div className="segmented-control"><button aria-pressed={!settings.compact} onClick={() => onChange({ ...settings, compact: false })}><Grid2X2 size={16} /> 舒适</button><button aria-pressed={settings.compact} onClick={() => onChange({ ...settings, compact: true })}><Grid3X3 size={16} /> 紧凑</button></div></div></section>;
}

function Dashboard() {
  const [initial] = useState(loadPreview);
  const [books, setBooks] = useState(initial.books);
  const [favorites, setFavorites] = useState(initial.favorites);
  const [settings, setSettings] = useState(initial.settings);
  const [view, setView] = useState<View>("Dashboard");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("All");
  const [contentType, setContentType] = useState<ContentType>("all");
  const [listType, setListType] = useState<ContentType>("all");
  const [selected, setSelected] = useState("afterglow");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [readerId, setReaderId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scanProgress, setScanProgress] = useState(98);
  const [scanPaused, setScanPaused] = useState(false);
  const [scanVisible, setScanVisible] = useState(true);
  const [toast, setToast] = useState("");
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ progress: Object.fromEntries(books.map((book) => [book.id, { lastReadPage: book.lastReadPage, lastReadAt: book.lastReadAt, readingStatus: book.readingStatus }])), favorites, settings })); } catch { /* Storage is optional for this local preview. */ }
  }, [books, favorites, settings]);
  useEffect(() => {
    if (scanPaused || scanProgress >= 100) return;
    const timer = window.setInterval(() => setScanProgress((value) => Math.min(100, value + 0.25)), 1200);
    return () => window.clearInterval(timer);
  }, [scanPaused, scanProgress >= 100]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 2200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [view, query, tab, contentType]);
  const onNavigate = (next: View) => { setView(next); setQuery(""); setTab(next === "Collections" ? "Favorites" : next === "Reading lists" ? "In progress" : "All"); setListType("all"); setSidebarOpen(false); };
  const browseCurrentType = () => { onNavigate("Libraries"); setTab(contentType === "all" ? "All" : contentType); };
  const showReadingList = (status: string) => { onNavigate("Reading lists"); setTab(status); setListType(contentType); };
  const toggleFavorite = (id: string) => { const isSaved = favorites.includes(id); setFavorites((value) => isSaved ? value.filter((item) => item !== id) : [...value, id]); setBooks((value) => value.map((book) => book.id === id ? { ...book, isFavorite: !isSaved } : book)); setToast(isSaved ? "已取消收藏" : "已加入收藏"); };
  const updateProgress = (id: string, page: number) => setBooks((value) => value.map((book) => book.id === id ? withReadingPage(book, page) : book));
  const openReader = (id: string) => { setDetailId(null); setReaderId(id); };
  const libraryBooks = useMemo(() => {
    let result = [...books].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
    const term = query.trim().toLowerCase();
    if (term) return result.filter((book) => `${book.title} ${book.author} ${book.genre} ${book.library} ${book.filename}`.toLowerCase().includes(term));
    if (view === "Libraries" && tab !== "All") result = result.filter((book) => book.type === tab);
    if (view === "Collections") result = tab === "Favorites" ? result.filter((book) => favorites.includes(book.id)) : result.filter((book) => book.genre === tab);
    if (view === "Reading lists") result = result.filter((book) => (listType === "all" || book.type === listType) && (tab === "Finished" ? bookFinished(book) : tab === "Unread" ? !bookStarted(book) : bookStarted(book) && !bookFinished(book)));
    return result;
  }, [books, query, view, tab, favorites, listType]);
  const detailBook = books.find((book) => book.id === detailId);
  const readerBook = books.find((book) => book.id === readerId);
  const searchActive = query.trim().length > 0;
  const tabs = view === "Libraries" ? ["All", "comic", "novel"] : view === "Collections" ? ["Favorites", "奇幻", "冒险"] : ["In progress", "Finished", "Unread"];
  const tabLabels: Record<string, string> = { All: "全部", comic: t.contentTab.comic, novel: t.contentTab.novel, Favorites: "我的收藏", "In progress": "阅读中", Finished: "已读", Unread: "未读" };
  const viewLabels: Record<View, string> = { Dashboard: "首页", Libraries: "书库", Collections: "收藏", "Reading lists": "阅读列表", Settings: "设置" };
  return <>
    <div className={`preview-canvas project-preview${collapsed ? " sidebar-collapsed" : ""}${!settings.motion ? " motion-off" : ""}${!settings.glow ? " glow-off" : ""}${settings.compact ? " compact-shelf" : ""}`}>
      <BrowserBar />
      <div className="app-frame"><Sidebar view={view} collapsed={collapsed} open={sidebarOpen} onNavigate={onNavigate} onCollapse={() => { setCollapsed(!collapsed); setSidebarOpen(false); }} />{sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}<div className="app-main">
        <TopBar query={query} onQuery={setQuery} onMenu={() => setSidebarOpen(!sidebarOpen)} onNavigate={onNavigate} scanProgress={scanProgress} />
        <main className="dashboard-main project-main" ref={content}>
          {view === "Settings" && !searchActive ? <SettingsView settings={settings} onChange={setSettings} /> : <>
            {view === "Dashboard" && !searchActive ? <ProjectDashboard books={books} type={contentType} selected={selected} scanProgress={scanProgress} paused={scanPaused} onType={setContentType} onSelected={setSelected} onRead={openReader} onDetail={setDetailId} onFavorite={toggleFavorite} onBrowse={browseCurrentType} onList={showReadingList} /> : <section className="library-view"><div className="library-heading"><h1>{searchActive ? "搜索结果" : viewLabels[view]}</h1><span>{libraryBooks.length} 本{view === "Reading lists" && listType !== "all" ? t.contentTab[listType] : "内容"}</span></div>{!searchActive && <div className="view-tabs" role="tablist" aria-label={viewLabels[view]}>{tabs.map((name) => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{tabLabels[name] || name}</button>)}</div>}{libraryBooks.length ? <BookGrid books={libraryBooks} favorites={favorites} onDetail={setDetailId} onFavorite={toggleFavorite} /> : <div className="empty-state">{searchActive ? <SearchX size={34} /> : <BookOpen size={34} />}<h2>{searchActive ? t.common.noSearchResults : tab === "Favorites" ? "暂无收藏" : "暂无内容"}</h2>{searchActive ? <button className="secondary-button" onClick={() => setQuery("")}>清除搜索</button> : <button className="secondary-button" onClick={() => onNavigate("Libraries")}>{t.dashboard.browseLibrary}</button>}</div>}</section>}
          </>}
          {scanVisible && <div className="scan-toast"><div className="scan-toast-body"><div className="scan-toast-text"><strong>文件扫描：</strong> {scanProgress >= 100 ? "扫描完成" : scanPaused ? "已暂停" : `漫画书库/余烬之城/第21卷.cbz (${Math.floor(scanProgress)}%)`} <span>· 已检查 {Math.min(3480, Math.round(scanProgress * 34.8)).toLocaleString()} / 3,480 个文件</span></div><div className="scan-toast-track"><span style={{ width: `${scanProgress}%` }} /></div></div><div className="scan-actions">{scanProgress >= 100 ? <button className="icon-button" title="重新扫描" aria-label="重新扫描" onClick={() => { setScanProgress(0); setScanPaused(false); }}><RotateCw size={16} /></button> : <button className="icon-button" title={scanPaused ? "继续扫描" : "暂停扫描"} aria-label={scanPaused ? "继续扫描" : "暂停扫描"} onClick={() => setScanPaused(!scanPaused)}>{scanPaused ? <Play size={16} /> : <Pause size={16} />}</button>}<button className="icon-button" title="关闭扫描状态" aria-label="关闭扫描状态" onClick={() => setScanVisible(false)}><X size={16} /></button></div></div>}
        </main>
      </div></div>
      {toast && <div className="action-toast" role="status"><Check size={16} />{toast}</div>}
    </div>
    {detailBook && <BookDetail book={detailBook} favorite={favorites.includes(detailBook.id)} onFavorite={() => toggleFavorite(detailBook.id)} onProgress={(page) => updateProgress(detailBook.id, page)} onRead={() => openReader(detailBook.id)} onClose={() => setDetailId(null)} />}
    {readerBook && <Reader book={readerBook} onProgress={(page) => updateProgress(readerBook.id, page)} onClose={() => { setReaderId(null); setToast("阅读进度已保存"); }} />}
  </>;
}

const root = ReactDOM.createRoot(document.getElementById("shelf-preview-root")!);
root.render(<Dashboard />);
import.meta.hot?.dispose(() => root.unmount());
