import 'dart:typed_data';

/// Public server identity, independent of the signed-in account.
class ServerBranding {
  static const defaultName = 'NowenReader';

  final String name;
  final Uint8List? iconBytes;
  final DateTime? fetchedAt;

  const ServerBranding({
    this.name = defaultName,
    this.iconBytes,
    this.fetchedAt,
  });

  static String normalizeName(Object? value) {
    final name = value is String ? value.trim() : '';
    return name.isEmpty ? defaultName : name;
  }
}

/// Cache identity stays stable when a verified server changes LAN/WAN routes.
class ServerBrandingTarget {
  final String key;
  final String baseUrl;

  const ServerBrandingTarget({this.key = '', this.baseUrl = ''});

  @override
  bool operator ==(Object other) =>
      other is ServerBrandingTarget &&
      key == other.key &&
      baseUrl == other.baseUrl;

  @override
  int get hashCode => Object.hash(key, baseUrl);
}
