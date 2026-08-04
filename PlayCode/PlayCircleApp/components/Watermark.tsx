import React from 'react';
import { Image, Platform, View } from 'react-native';

/**
 * Rendered once, globally, in app/_layout.tsx — not per-screen. Deliberately
 * subtle (bottom-right, translucent) so it doesn't compete with real
 * buttons several screens anchor in that same corner (Start Match, Add
 * Expense, Join). Skipped entirely on auth screens, which get the full
 * prominent logo instead.
 *
 * Uses 'fixed' positioning on web specifically — 'absolute' anchors to the
 * full scrollable content height, not the visible viewport, so on any
 * screen taller than the window it renders below the fold and never
 * actually shows up without scrolling all the way down.
 */
export default function Watermark() {
  return (
    <View
      style={{
        position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute',
        bottom: 12,
        right: 12,
        zIndex: 999,
        pointerEvents: 'none',
      }}
    >
      <Image
        source={require('../assets/images/logo-icon.png')}
        resizeMode="contain"
        style={{
          width: 52,
          height: 45, // matches logo-icon.png's current crop aspect ratio
          opacity: 0.35,
        }}
      />
    </View>
  );
}
