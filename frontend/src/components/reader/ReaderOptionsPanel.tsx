"use client";

import { useTranslation } from "@/lib/i18n";
import { X, ChevronDown, Monitor, Wrench, Cog } from "lucide-react";
import type {
  ReaderOptions,
  FitMode,
  ComicReadingMode,
  ReadingDirection,
} from "@/types/reader";
import { useState, useEffect, useRef } from "react";

interface ReaderOptionsPanelProps {
  options: ReaderOptions;
  onChange: (opts: Partial<ReaderOptions>) => void;
  onClose: () => void;
}

export default function ReaderOptionsPanel({
  options,
  onChange,
  onClose,
}: ReaderOptionsPanelProps) {
  const t = useTranslation();
  const ro = t.readerOptions;

  // 本地输入状态
  const [containerWidthInput, setContainerWidthInput] = useState(
    options.containerWidth
  );
  const [preloadInput, setPreloadInput] = useState(
    String(options.preloadCount)
  );
  const [autoPageInput, setAutoPageInput] = useState(
    String(options.autoPageInterval)
  );

  // 分组展开状态: 显示默认展开，其余收起
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["display"])
  );

  // 拖拽关闭手势
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragCurrentY = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isClosing, setIsClosing] = useState(false);

  // 入场动画
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setIsOpen(true));
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setIsOpen(false);
    setTimeout(onClose, 300);
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // 拖拽关闭手势处理
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    // 只在拖拽把手区域启用
    if (!target.closest("[data-drag-handle]")) return;
    dragStartY.current = e.touches[0].clientY;
    dragCurrentY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current === 0) return;
    dragCurrentY.current = e.touches[0].clientY;
    const offset = Math.max(0, dragCurrentY.current - dragStartY.current);
    setDragOffset(offset);
  };

  const handleTouchEnd = () => {
    if (dragOffset > 100) {
      handleClose();
    }
    setDragOffset(0);
    dragStartY.current = 0;
  };

  // ── 通用子组件 ──────────────────────────────────────────

  /** 选项按钮组 */
  const ToggleGroup = ({
    value,
    items,
    onChange: onGroupChange,
  }: {
    value: string;
    items: { value: string; label: string }[];
    onChange: (v: string) => void;
  }) => (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => onGroupChange(item.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            value === item.value
              ? "bg-blue-600 text-white shadow-sm shadow-blue-500/25"
              : "bg-white/8 text-white/50 hover:bg-white/12 hover:text-white/70 active:bg-white/15"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  /** 开关组件 */
  const Toggle = ({
    checked,
    onToggle,
    label,
    desc,
  }: {
    checked: boolean;
    onToggle: (v: boolean) => void;
    label: string;
    desc?: string;
  }) => (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <span className="text-xs font-medium text-white/80">{label}</span>
        {desc && (
          <p className="text-[11px] leading-tight text-white/35 mt-0.5">
            {desc}
          </p>
        )}
      </div>
      <button
        onClick={() => onToggle(!checked)}
        className={`relative shrink-0 h-6 w-10 rounded-full transition-colors duration-200 ${
          checked ? "bg-blue-600" : "bg-white/15"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );

  /** 输入框 + 应用 */
  const InputWithApply = ({
    value,
    onValueChange,
    onApply,
    placeholder,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    onApply: () => void;
    placeholder?: string;
  }) => (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onApply()}
        placeholder={placeholder}
        className="flex-1 rounded-lg bg-white/8 px-3 py-1.5 text-xs text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-blue-500/50 transition-shadow"
      />
      <button
        onClick={onApply}
        className="px-3 py-1.5 rounded-lg bg-blue-600/20 text-xs text-blue-400 font-medium hover:bg-blue-600/30 active:bg-blue-600/40 transition-colors"
      >
        {ro.apply}
      </button>
    </div>
  );

  /** 分组区域 */
  const Group = ({
    id,
    icon,
    title,
    children,
  }: {
    id: string;
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
  }) => {
    const expanded = expandedGroups.has(id);
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
        <button
          onClick={() => toggleGroup(id)}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors"
        >
          <span className="text-white/50">{icon}</span>
          <span className="flex-1 text-sm font-semibold text-white/90">
            {title}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-white/30 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
        <div
          className={`grid transition-all duration-200 ease-out ${
            expanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-4 space-y-4">{children}</div>
          </div>
        </div>
      </div>
    );
  };

  /** 设置行标题 */
  const Label = ({ children }: { children: React.ReactNode }) => (
    <h4 className="text-[11px] font-semibold text-white/45 uppercase tracking-wider mb-1.5">
      {children}
    </h4>
  );

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className={`fixed inset-0 z-[60] transition-opacity duration-300 ${
          isOpen && !isClosing ? "bg-black/60" : "bg-black/0"
        }`}
        onClick={handleClose}
      />

      {/* 底部弹出面板 */}
      <div
        ref={sheetRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`fixed bottom-0 left-0 right-0 z-[61] transition-transform duration-300 ease-out ${
          isOpen && !isClosing ? "translate-y-0" : "translate-y-full"
        }`}
        style={{
          transform:
            dragOffset > 0
              ? `translateY(${dragOffset}px)`
              : isOpen && !isClosing
              ? "translateY(0)"
              : "translateY(100%)",
          maxHeight: "75vh",
        }}
      >
        <div className="rounded-t-2xl bg-zinc-900 border-t border-white/10 shadow-2xl shadow-black/50 flex flex-col" style={{ maxHeight: "75vh" }}>
          {/* 拖拽把手 + 标题栏 */}
          <div
            data-drag-handle
            className="shrink-0 px-4 pt-3 pb-2 cursor-grab active:cursor-grabbing"
          >
            {/* 拖拽指示条 */}
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />

            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">{ro.title}</h2>
                <p className="text-[11px] text-white/30 mt-0.5">
                  {ro.autoSaveHint}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 可滚动内容区 */}
          <div
            className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4 space-y-2.5"
            style={{
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
            }}
          >
            {/* ── 📖 显示设置 ── */}
            <Group
              id="display"
              icon={<Monitor className="h-4 w-4" />}
              title={ro.groupDisplay}
            >
              {/* 适应显示 */}
              <div>
                <Label>{ro.fitMode}</Label>
                <ToggleGroup
                  value={options.fitMode}
                  items={[
                    { value: "container", label: ro.fitContainer },
                    { value: "width", label: ro.fitWidth },
                    { value: "height", label: ro.fitHeight },
                  ]}
                  onChange={(v) => onChange({ fitMode: v as FitMode })}
                />
              </div>

              {/* 页面渲染 */}
              <div>
                <Label>{ro.pageRendering}</Label>
                <ToggleGroup
                  value={options.mode}
                  items={[
                    { value: "single", label: ro.singlePage },
                    { value: "double", label: ro.doublePage },
                  ]}
                  onChange={(v) =>
                    onChange({ mode: v as ComicReadingMode })
                  }
                />
              </div>

              {/* 阅读方向 */}
              <div>
                <Label>{ro.readingDirection}</Label>
                <ToggleGroup
                  value={options.infiniteScroll ? "ttb" : options.direction}
                  items={[
                    { value: "ltr", label: ro.ltr },
                    { value: "rtl", label: ro.rtl },
                    { value: "ttb", label: ro.ttb },
                  ]}
                  onChange={(v) => {
                    if (v === "ttb") {
                      onChange({ direction: "ttb" as ReadingDirection, infiniteScroll: true });
                    } else {
                      onChange({ direction: v as ReadingDirection, infiniteScroll: false });
                    }
                  }}
                />
              </div>

              {/* 页码指示器 */}
              <Toggle
                checked={options.headerVisible}
                onToggle={(v) => onChange({ headerVisible: v })}
                label={ro.header}
              />
            </Group>

            {/* ── ⚙️ 高级设置 ── */}
            <Group
              id="advanced"
              icon={<Cog className="h-4 w-4" />}
              title={ro.groupAdvanced}
            >
              {/* 容器宽度 */}
              <div>
                <Label>{ro.containerWidth}</Label>
                <InputWithApply
                  value={containerWidthInput}
                  onValueChange={setContainerWidthInput}
                  onApply={() =>
                    onChange({ containerWidth: containerWidthInput })
                  }
                  placeholder={ro.containerWidthPlaceholder}
                />
              </div>

              {/* 预加载图片数量 */}
              <div>
                <Label>{ro.preloadCount}</Label>
                <InputWithApply
                  value={preloadInput}
                  onValueChange={setPreloadInput}
                  onApply={() => {
                    const n = parseInt(preloadInput, 10);
                    if (!isNaN(n) && n >= 0 && n <= 20) {
                      onChange({ preloadCount: n });
                    }
                  }}
                />
              </div>

              {/* 自动翻页间隔 */}
              <div>
                <Label>{ro.autoPageInterval}</Label>
                <p className="text-[11px] text-white/30 mb-1.5">
                  {ro.autoPageIntervalDesc}
                </p>
                <InputWithApply
                  value={autoPageInput}
                  onValueChange={setAutoPageInput}
                  onApply={() => {
                    const n = parseInt(autoPageInput, 10);
                    if (!isNaN(n) && n >= 0 && n <= 300) {
                      onChange({ autoPageInterval: n });
                    }
                  }}
                />
              </div>
            </Group>

            {/* ── 🔧 行为设置 ── */}
            <Group
              id="behavior"
              icon={<Wrench className="h-4 w-4" />}
              title={ro.groupBehavior}
            >
              {/* 进度跟踪 */}
              <Toggle
                checked={options.progressTracking}
                onToggle={(v) => onChange({ progressTracking: v })}
                label={ro.progressTracking}
                desc={ro.progressTrackingDesc}
              />

              {/* 默认显示档案覆盖层 */}
              <Toggle
                checked={options.defaultOverlay}
                onToggle={(v) => onChange({ defaultOverlay: v })}
                label={ro.defaultOverlay}
                desc={ro.defaultOverlayDesc}
              />

              {/* 页面翻译 */}
              <Toggle
                checked={options.showTranslate}
                onToggle={(v) => onChange({ showTranslate: v })}
                label={ro.showTranslate}
                desc={ro.showTranslateDesc}
              />

              {/* AI 助手 */}
              <Toggle
                checked={options.showAIChat}
                onToggle={(v) => onChange({ showAIChat: v })}
                label={ro.showAIChat}
                desc={ro.showAIChatDesc}
              />
            </Group>
          </div>
        </div>
      </div>
    </>
  );
}

/** 设置区域组件 */
function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-bold text-white/90 mb-1">{title}</h3>
      {desc && <p className="text-xs text-white/40 mb-2">{desc}</p>}
      {children}
    </div>
  );
}
