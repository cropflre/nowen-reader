import 'package:flutter/material.dart';

import '../../data/api/comic_api.dart';
import '../../l10n/app_localizations.dart';
import 'novel_html_pages.dart';
import 'novel_settings.dart';

/// 章节标题下方的 AI 前情提要入口与可折叠提示卡片
class NovelChapterRecapCard extends StatelessWidget {
  final NovelSettings settings;
  final bool expanded;
  final bool loading;
  final ChapterRecap? recap;
  final String? error;
  final VoidCallback onExpand;
  final VoidCallback onCollapse;
  final VoidCallback onRefresh;

  const NovelChapterRecapCard({
    super.key,
    required this.settings,
    required this.expanded,
    required this.loading,
    required this.recap,
    required this.error,
    required this.onExpand,
    required this.onCollapse,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isDark = settings.isDark;
    final accentColor =
        isDark ? const Color(0xFFC084FC) : const Color(0xFF7E22CE);
    final borderColor = isDark
        ? const Color(0xFFA855F7).withAlpha(64)
        : const Color(0xFF9333EA).withAlpha(56);
    final buttonBgColor = isDark
        ? const Color(0xFFA855F7).withAlpha(26)
        : const Color(0xFF9333EA).withAlpha(18);
    final cardBgColor = isDark
        ? const Color(0xFFA855F7).withAlpha(18)
        : const Color(0xFF9333EA).withAlpha(14);

    return NovelPageAtomic(
      child: Padding(
        padding: const EdgeInsets.only(bottom: 20),
        child: !expanded
            ? Center(
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    key: const ValueKey('novel-chapter-recap-button'),
                    borderRadius: BorderRadius.circular(12),
                    onTap: onExpand,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: buttonBgColor,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: borderColor),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.auto_stories_outlined,
                            size: 15,
                            color: accentColor,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            l10n.viewChapterRecap,
                            style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w500,
                              color: accentColor,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              )
            : GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {},
                child: Container(
                  key: const ValueKey('novel-chapter-recap-card'),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: cardBgColor,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: borderColor),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            Icons.auto_stories_outlined,
                            size: 15,
                            color: accentColor,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              l10n.chapterRecapTitle,
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: accentColor,
                              ),
                            ),
                          ),
                          if (!loading && (recap != null || error != null))
                            _HeaderActionButton(
                              key: const ValueKey(
                                  'novel-chapter-recap-refresh'),
                              icon: Icons.refresh_rounded,
                              tooltip: l10n.regenerate,
                              color: settings.secondaryTextColor,
                              onTap: onRefresh,
                            ),
                          const SizedBox(width: 2),
                          _HeaderActionButton(
                            key: const ValueKey('novel-chapter-recap-close'),
                            icon: Icons.close_rounded,
                            tooltip: l10n.collapse,
                            color: settings.secondaryTextColor,
                            onTap: onCollapse,
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      _buildBody(context, l10n, isDark, accentColor),
                    ],
                  ),
                ),
              ),
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    AppLocalizations l10n,
    bool isDark,
    Color accentColor,
  ) {
    if (loading) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 15,
              height: 15,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: accentColor.withAlpha(180),
              ),
            ),
            const SizedBox(width: 8),
            Text(
              l10n.generatingChapterRecap,
              style: TextStyle(
                fontSize: 12.5,
                color: settings.secondaryTextColor,
              ),
            ),
          ],
        ),
      );
    }

    if (error != null) {
      final message = error!.trim().isNotEmpty
          ? error!.trim()
          : l10n.chapterRecapFailed;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            message,
            style: TextStyle(
              fontSize: 12.5,
              color: settings.secondaryTextColor,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              key: const ValueKey('novel-chapter-recap-retry'),
              onPressed: onRefresh,
              style: TextButton.styleFrom(
                foregroundColor: accentColor,
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              icon: const Icon(Icons.refresh_rounded, size: 15),
              label: Text(
                l10n.retry,
                style: const TextStyle(fontSize: 12.5),
              ),
            ),
          ),
        ],
      );
    }

    final data = recap;
    if (data == null || data.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Text(
          l10n.noChapterRecap,
          style: TextStyle(
            fontSize: 12.5,
            color: settings.secondaryTextColor,
          ),
        ),
      );
    }

    final characterColor =
        isDark ? const Color(0xFFD8B4FE) : const Color(0xFF7E22CE);
    final cliffhangerColor =
        isDark ? const Color(0xFFFCD34D) : const Color(0xFFB45309);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (data.summary.isNotEmpty)
          Text(
            data.summary,
            style: TextStyle(
              fontSize: 14,
              height: 1.65,
              color: settings.textColor.withAlpha(224),
              fontFamily: settings.fontFamily,
            ),
          ),
        if (data.keyCharacters.isNotEmpty) ...[
          if (data.summary.isNotEmpty) const SizedBox(height: 8),
          _RecapDetailRow(
            icon: Icons.person_outline_rounded,
            text: data.keyCharacters,
            color: characterColor,
          ),
        ],
        if (data.lastCliffhanger.isNotEmpty) ...[
          if (data.summary.isNotEmpty || data.keyCharacters.isNotEmpty)
            const SizedBox(height: 6),
          _RecapDetailRow(
            icon: Icons.bolt_rounded,
            text: data.lastCliffhanger,
            color: cliffhangerColor,
          ),
        ],
      ],
    );
  }
}

class _HeaderActionButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final Color color;
  final VoidCallback onTap;

  const _HeaderActionButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(4),
            child: Icon(icon, size: 16, color: color),
          ),
        ),
      ),
    );
  }
}

class _RecapDetailRow extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color color;

  const _RecapDetailRow({
    required this.icon,
    required this.text,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(icon, size: 14, color: color),
        ),
        const SizedBox(width: 5),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 12.5,
              height: 1.5,
              color: color,
            ),
          ),
        ),
      ],
    );
  }
}
