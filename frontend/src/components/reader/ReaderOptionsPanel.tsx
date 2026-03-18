"use client";

import { useTranslation } from "@/lib/i18n";
import { X } from "lucide-react";
import type { ReaderOptions, FitMode, ComicReadingMode, ReadingDirection } from "@/types/reader";
import { useState } from "react";

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

  // 本地输入状态（容器宽度、预加载数量、自动翻页间隔）
  const [containerWidthInput, setContainerWidthInput] = useState(options.containerWidth);
  const [preloadInput, setPreloadInput] = useState(String(options.preloadCount));
  const [autoPageInput, setAutoPageInput] = useState(String(options.autoPageInterval));

  // 通用按钮组件
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
          className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
            value === item.value
              ? "bg-blue-600 text-white ring-1 ring-blue-500"
              : "bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/80"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  // 输入框 + 应用按钮
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
        className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:ring-1 focus:ring-blue-500/50"
      />
      <button
        onClick={onApply}
        className="px-4 py-1.5 rounded-lg bg-white/10 text-sm text-white/70 hover:bg-white/15 hover:text-white transition-colors"
      >
        {ro.apply}
      </button>
    </div>
  );

  return (
    <>
      {/* 背景遮罩 */}
      <div className="fixed inset-0 z-[60] bg-black/80" onClick={onClose} />

      {/* 面板 */}
      <div className="fixed top-0 right-0 z-[61] h-full w-full sm:w-96 max-w-[90vw] overflow-y-auto bg-zinc-900 border-l border-white/10 shadow-2xl">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors z-10"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          {/* 标题 */}
          <div className="text-center pr-8">
            <h2 className="text-lg font-bold text-white">{ro.title}</h2>
            <p className="text-xs text-white/40 mt-1">{ro.autoSaveHint}</p>
          </div>

          {/* 适应显示 */}
          <Section title={ro.fitMode}>
            <ToggleGroup
              value={options.fitMode}
              items={[
                { value: "container", label: ro.fitContainer },
                { value: "width", label: ro.fitWidth },
                { value: "height", label: ro.fitHeight },
              ]}
              onChange={(v) => onChange({ fitMode: v as FitMode })}
            />
          </Section>

          {/* 容器宽度 */}
          <Section title={ro.containerWidth}>
            <InputWithApply
              value={containerWidthInput}
              onValueChange={setContainerWidthInput}
              onApply={() => onChange({ containerWidth: containerWidthInput })}
              placeholder={ro.containerWidthPlaceholder}
            />
          </Section>

          {/* 页面渲染 */}
          <Section title={ro.pageRendering}>
            <ToggleGroup
              value={options.mode}
              items={[
                { value: "single", label: ro.singlePage },
                { value: "double", label: ro.doublePage },
              ]}
              onChange={(v) => onChange({ mode: v as ComicReadingMode })}
            />
          </Section>

          {/* 阅读方向 */}
          <Section title={ro.readingDirection}>
            <ToggleGroup
              value={options.direction}
              items={[
                { value: "ltr", label: ro.ltr },
                { value: "rtl", label: ro.rtl },
              ]}
              onChange={(v) => onChange({ direction: v as ReadingDirection })}
            />
          </Section>

          {/* 预加载图片数量 */}
          <Section title={ro.preloadCount}>
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
          </Section>

          {/* 头 */}
          <Section title={ro.header}>
            <ToggleGroup
              value={options.headerVisible ? "visible" : "hidden"}
              items={[
                { value: "visible", label: ro.headerVisible },
                { value: "hidden", label: ro.headerHidden },
              ]}
              onChange={(v) => onChange({ headerVisible: v === "visible" })}
            />
          </Section>

          {/* 默认显示档案覆盖层 */}
          <Section title={ro.defaultOverlay} desc={ro.defaultOverlayDesc}>
            <ToggleGroup
              value={options.defaultOverlay ? "enable" : "disable"}
              items={[
                { value: "enable", label: ro.enable },
                { value: "disable", label: ro.disable },
              ]}
              onChange={(v) => onChange({ defaultOverlay: v === "enable" })}
            />
          </Section>

          {/* 进度跟踪 */}
          <Section title={ro.progressTracking} desc={ro.progressTrackingDesc}>
            <ToggleGroup
              value={options.progressTracking ? "enable" : "disable"}
              items={[
                { value: "enable", label: ro.enable },
                { value: "disable", label: ro.disable },
              ]}
              onChange={(v) => onChange({ progressTracking: v === "enable" })}
            />
          </Section>

          {/* 无极滚动 */}
          <Section title={ro.infiniteScroll} desc={ro.infiniteScrollDesc}>
            <ToggleGroup
              value={options.infiniteScroll ? "enable" : "disable"}
              items={[
                { value: "enable", label: ro.enable },
                { value: "disable", label: ro.disable },
              ]}
              onChange={(v) => onChange({ infiniteScroll: v === "enable" })}
            />
          </Section>

          {/* 自动翻页间隔 */}
          <Section title={ro.autoPageInterval}>
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
          </Section>
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
