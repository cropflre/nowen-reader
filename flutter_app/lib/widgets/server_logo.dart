import 'package:flutter/material.dart';

import '../data/models/server_branding.dart';

class ServerLogo extends StatelessWidget {
  final ServerBranding branding;
  final double size;

  const ServerLogo({super.key, required this.branding, this.size = 36});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final fallback = ColoredBox(
      color: colors.primaryContainer,
      child: Center(
        child: Icon(Icons.auto_stories_rounded,
            size: size * 0.5, color: colors.onPrimaryContainer),
      ),
    );
    return Semantics(
      label: '${branding.name} Logo',
      image: true,
      child: SizedBox.square(
        dimension: size,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(size * 0.25),
          child: branding.iconBytes == null
              ? fallback
              : Image.memory(
                  branding.iconBytes!,
                  fit: BoxFit.contain,
                  excludeFromSemantics: true,
                  errorBuilder: (_, __, ___) => fallback,
                ),
        ),
      ),
    );
  }
}
