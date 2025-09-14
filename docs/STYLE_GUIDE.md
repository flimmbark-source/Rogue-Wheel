# Style Guide

This document outlines styling conventions for the Rogue Wheel application to achieve a polished, game-like look.

## Fonts

Use **Poppins** for headings and **Inter** for body text. Include the fonts in your HTML:

```html
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&family=Inter:wght@400;700&display=swap" rel="stylesheet">
```

In `tailwind.config.js`, reference these fonts via `fontFamily.heading` and `fontFamily.text`.

## Tailwind Theme

Extend Tailwind’s default theme to include the following custom colours:

- `primary`: #84cc16 – player accent.
- `secondary`: #d946ef – enemy accent.
- `surface`: #0f172a – card backgrounds.
- `panel`: #1e293b – HUD panels.

Also define `fontFamily.heading` and `fontFamily.text` in your Tailwind config.

## Global styles

In `src/index.css` import the fonts and apply global styles:

```css
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&family=Inter:wght@400;700&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply text-surface bg-black font-text selection:bg-secondary selection:text-white;
}

.panel {
  @apply bg-panel/60 text-surface p-4 rounded-lg shadow-md;
}

.card {
  @apply bg-surface text-surface flex items-center justify-center rounded-lg shadow-lg border-2 border-panel hover:scale-105 transition-transform;
}

.btn-primary {
  @apply bg-primary text-white px-4 py-2 rounded-md hover:bg-primary/80;
}

.btn-secondary {
  @apply bg-secondary text-white px-4 py-2 rounded-md hover:bg-secondary/80;
}
```

This file is imported in your main entry to set up baseline styles.

## Layout recommendations

- **HUD panels**: Wrap the round indicator, phase label, goal, and action buttons in a flex container with space between items. Use `.panel` for the background.
- **Wheel containers**: Place each wheel in its own `.panel` card with rounded corners. Keep the card size responsive using Tailwind’s responsive utilities.
- **Hand cards**: Represent player cards with the `.card` class. Use flexbox to lay them out horizontally and allow wrapping on narrow screens.
- **Responsiveness**: Leverage Tailwind’s `sm:`, `md:`, and `lg:` prefixes to adjust spacing, typography, and layout across breakpoints.

## Further enhancements

- Replace placeholder emoji icons in the wheels with cohesive SVG icons.
- Use Framer Motion for smooth transitions when selecting cards and spinning wheels.
- Extract UI sections (HUD, Wheels, Card Hand) into reusable React components to maintain consistency and simplify styling changes.
