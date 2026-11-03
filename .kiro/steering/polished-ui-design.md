---
inclusion: fileMatch
fileMatchPattern: "**/*.{tsx,jsx,vue,svelte,css,scss,html,astro}"
---

<!-- POLISHED-UI-SKILLS:BEGIN -->
# Polished UI Skills

Build product-specific, usable, accessible, responsive/adaptive UI. Detect the platform/framework first.

## Workflow
1. Understand product, task, platform, framework, existing tokens/components, and conventions.
2. Constrain hierarchy, type, color, spacing, radius, surfaces, icons, and controls.
3. Implement for the environment: responsive web or adaptive/touch-first mobile.
4. Complete relevant default, hover (web), focus, pressed, selected, disabled, loading, success, error, empty, and offline states.
5. Audit accessibility, content resilience, platform behavior, and visual restraint.

## Platform
- **Web:** responsive CSS, intrinsic layout, keyboard/pointer interaction, visible focus, semantic HTML.
- **React Native / Expo / Flutter:** mobile layout, touch, keyboard/IME, safe areas/insets, system gestures, adaptive layouts, target OS conventions.
- **SwiftUI / UIKit:** iOS navigation, Dynamic Type, safe areas, sheets, tab bars, familiar system behavior.
- **Jetpack Compose / Android Views:** Material/Android conventions, adaptive windows, system back, edge-to-edge/insets, large text.
- Do not copy desktop UI into a phone. Do not make iOS and Android identical when platform conventions improve usability.

## Visual rules
- Prefer hierarchy, whitespace, typography, imagery, and grouping before extra cards, borders, shadows, gradients, glow, pills, or badges.
- Avoid generic purple/indigo gradients, decorative glow, emoji UI chrome, card-everything layouts, rainbow accents, and meaningless status dots.
- Treat these as warning signs, not absolute bans.
- Prefer existing project components and semantic tokens.
- Never rely on web hover as a mobile interaction.
- Never shrink text or touch targets just to fit more content.

## Accessibility
- Use semantic/native controls with meaningful names, labels, roles, and states.
- Web: keyboard access, visible focus, logical DOM order, readable contrast.
- Mobile: screen-reader semantics, text scaling/large text, logical focus order, comfortable touch targets.
- Do not communicate essential meaning through color, animation, haptics, or sound alone.
- Respect reduced-motion and platform accessibility preferences.

## Responsive/adaptive resilience
- Web: test narrow mobile, tablet/laptop, and wide desktop.
- Mobile: test relevant phone/tablet/foldable sizes, orientation, safe areas, and keyboard states.
- Test long labels, localization, zero/one/many results, missing media, slow/offline loading, and large text.
- Avoid fixed heights for content that can grow.

## Pre-ship gate
- [ ] Clear task and primary action
- [ ] Product-specific visual identity
- [ ] Systematic visual tokens
- [ ] Correct platform/framework conventions
- [ ] No accidental overflow/clipping
- [ ] Complete relevant interaction states
- [ ] Keyboard/pointer or touch/gesture flow works
- [ ] Navigation/back behavior is predictable
- [ ] Accessibility semantics, labels, focus, text scaling, and non-color cues
- [ ] Safe areas/insets/keyboard behavior on mobile
- [ ] Loading/error/empty/offline states considered
- [ ] Final platform-specific audit completed
<!-- POLISHED-UI-SKILLS:END -->
