import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class AppTheme {
  AppTheme._();

  // ─── 品牌色 ───
  // 深邃的靛蓝色，优雅而不张扬
  static const _seedColor = Color(0xFF4F46E5);

  // ─── 自定义色板 ───
  static const _warmGray50 = Color(0xFFFAFAF9);
  static const _warmGray100 = Color(0xFFF5F5F4);
  static const _warmGray200 = Color(0xFFE7E5E4);
  static const _warmGray400 = Color(0xFFA8A29E);
  static const _warmGray500 = Color(0xFF78716C);
  static const _warmGray800 = Color(0xFF292524);
  static const _warmGray900 = Color(0xFF1C1917);

  // ─── 圆角规范 ───
  static const double radiusXs = 6;
  static const double radiusSm = 10;
  static const double radiusMd = 14;
  static const double radiusLg = 20;
  static const double radiusXl = 28;

  // ─── 亮色主题 ───
  static final lightTheme = ThemeData(
    useMaterial3: true,
    colorSchemeSeed: _seedColor,
    brightness: Brightness.light,
    scaffoldBackgroundColor: _warmGray50,

    // 文字排版
    textTheme: _buildTextTheme(Brightness.light),

    // AppBar
    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      backgroundColor: _warmGray50.withOpacity(0.95),
      surfaceTintColor: Colors.transparent,
      systemOverlayStyle: SystemUiOverlayStyle.dark,
      titleTextStyle: const TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: _warmGray900,
        letterSpacing: -0.5,
      ),
      iconTheme: const IconThemeData(
        color: _warmGray800,
        size: 22,
      ),
    ),

    // 卡片
    cardTheme: CardThemeData(
      elevation: 0,
      color: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusMd),
      ),
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
    ),

    // 输入框
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: _warmGray100,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusMd),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusMd),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusMd),
        borderSide: const BorderSide(color: _seedColor, width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      hintStyle: TextStyle(
        color: _warmGray400,
        fontSize: 15,
        fontWeight: FontWeight.w400,
      ),
    ),

    // 填充按钮
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(double.infinity, 52),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
        textStyle: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.2,
        ),
        elevation: 0,
      ),
    ),

    // 轮廓按钮
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(double.infinity, 48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
        side: BorderSide(color: _warmGray200),
        textStyle: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w500,
        ),
      ),
    ),

    // 底部导航栏
    navigationBarTheme: NavigationBarThemeData(
      height: 68,
      elevation: 0,
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: _seedColor.withOpacity(0.1),
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const IconThemeData(size: 24, color: _seedColor);
        }
        return IconThemeData(size: 22, color: _warmGray400);
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: _seedColor,
          );
        }
        return TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: _warmGray500,
        );
      }),
    ),

    // 芯片
    chipTheme: ChipThemeData(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusSm),
      ),
      side: BorderSide.none,
      elevation: 0,
      pressElevation: 0,
    ),

    // 对话框
    dialogTheme: DialogThemeData(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusLg),
      ),
      surfaceTintColor: Colors.transparent,
      elevation: 8,
    ),

    // 底部弹出面板
    bottomSheetTheme: const BottomSheetThemeData(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
    ),

    // 分割线
    dividerTheme: DividerThemeData(
      color: _warmGray200.withOpacity(0.6),
      thickness: 0.5,
      space: 0.5,
    ),

    // 列表项
    listTileTheme: ListTileThemeData(
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusSm),
      ),
      visualDensity: const VisualDensity(vertical: -0.5),
    ),

    // 弹出菜单
    popupMenuTheme: PopupMenuThemeData(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusMd),
      ),
      surfaceTintColor: Colors.transparent,
      elevation: 4,
    ),

    // SnackBar
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusSm),
      ),
    ),

  );

  // ─── 暗色主题 ───
  static const _darkBg = Color(0xFF0F0F0F);
  static const _darkSurface = Color(0xFF1A1A1A);
  static const _darkCard = Color(0xFF222222);
  static const _darkBorder = Color(0xFF2E2E2E);

  static final darkTheme = ThemeData(
    useMaterial3: true,
    colorSchemeSeed: _seedColor,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: _darkBg,

    // 文字排版
    textTheme: _buildTextTheme(Brightness.dark),

    // AppBar
    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      backgroundColor: _darkBg.withOpacity(0.95),
      surfaceTintColor: Colors.transparent,
      systemOverlayStyle: SystemUiOverlayStyle.light,
      titleTextStyle: const TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: Colors.white,
        letterSpacing: -0.5,
      ),
      iconTheme: const IconThemeData(
        color: Colors.white70,
        size: 22,
      ),
    ),

    // 卡片
    cardTheme: CardThemeData(
      elevation: 0,
      color: _darkCard,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusMd),
      ),
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
    ),

    // 输入框
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: _darkSurface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusMd),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusMd),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusMd),
        borderSide: BorderSide(color: _seedColor.withOpacity(0.8), width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      hintStyle: const TextStyle(
        color: Color(0xFF666666),
        fontSize: 15,
        fontWeight: FontWeight.w400,
      ),
    ),

    // 填充按钮
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(double.infinity, 52),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
        textStyle: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.2,
        ),
        elevation: 0,
      ),
    ),

    // 轮廓按钮
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(double.infinity, 48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
        side: const BorderSide(color: _darkBorder),
        textStyle: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w500,
        ),
      ),
    ),

    // 底部导航栏
    navigationBarTheme: NavigationBarThemeData(
      height: 68,
      elevation: 0,
      backgroundColor: _darkBg,
      surfaceTintColor: Colors.transparent,
      indicatorColor: _seedColor.withOpacity(0.15),
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const IconThemeData(size: 24, color: Color(0xFF818CF8));
        }
        return const IconThemeData(size: 22, color: Color(0xFF555555));
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: Color(0xFF818CF8),
          );
        }
        return const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: Color(0xFF555555),
        );
      }),
    ),

    // 芯片
    chipTheme: ChipThemeData(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusSm),
      ),
      side: BorderSide.none,
      elevation: 0,
      pressElevation: 0,
    ),

    // 对话框
    dialogTheme: DialogThemeData(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusLg),
      ),
      surfaceTintColor: Colors.transparent,
      backgroundColor: _darkCard,
      elevation: 8,
    ),

    // 底部弹出面板
    bottomSheetTheme: BottomSheetThemeData(
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: _darkSurface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
    ),

    // 分割线
    dividerTheme: DividerThemeData(
      color: _darkBorder.withOpacity(0.6),
      thickness: 0.5,
      space: 0.5,
    ),

    // 列表项
    listTileTheme: ListTileThemeData(
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusSm),
      ),
      visualDensity: const VisualDensity(vertical: -0.5),
    ),

    // 弹出菜单
    popupMenuTheme: PopupMenuThemeData(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusMd),
      ),
      surfaceTintColor: Colors.transparent,
      color: _darkCard,
      elevation: 4,
    ),

    // SnackBar
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusSm),
      ),
    ),

  );

  // ─── 文字排版 ───
  static TextTheme _buildTextTheme(Brightness brightness) {
    final color = brightness == Brightness.light ? _warmGray900 : Colors.white;
    final subColor = brightness == Brightness.light ? _warmGray500 : const Color(0xFF999999);

    return TextTheme(
      displayLarge: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: color, letterSpacing: -1.0, height: 1.2),
      displayMedium: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: color, letterSpacing: -0.8, height: 1.2),
      displaySmall: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: color, letterSpacing: -0.5, height: 1.3),
      headlineLarge: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: color, letterSpacing: -0.4, height: 1.3),
      headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: color, letterSpacing: -0.3, height: 1.3),
      headlineSmall: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: color, letterSpacing: -0.2, height: 1.4),
      titleLarge: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: color, letterSpacing: -0.1),
      titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: color),
      titleSmall: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: color),
      bodyLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w400, color: color, height: 1.5),
      bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: color, height: 1.5),
      bodySmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: subColor, height: 1.4),
      labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: color, letterSpacing: 0.1),
      labelMedium: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: subColor),
      labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: subColor, letterSpacing: 0.3),
    );
  }
}
