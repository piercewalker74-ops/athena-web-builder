// ─── NEOFORM Visual Upgrade Packs ─────────────────────────────────────────────
// Three DISTINCT, internally-CONTINUOUS feature directions mined from the feature
// catalog. Each pack applies one coherent look across every section (3–4 features
// per section) with a single continuity thread that carries top-to-bottom.
// The UPGRADE button (Pipeline → Projects) queues an 'edit' job whose instruction
// is composed here; the edit agent applies the pack, picking the section-appropriate
// variant while keeping the shared thread.

export interface UpgradePack {
  id: string;
  name: string;
  tagline: string;
  thread: string;                         // the continuity motif that must carry section→section
  sections: Record<string, string[]>;     // archetype letter → feature ids (A hero, C marquee, D gallery, E pinned, F before/after, G stat, H testimonial, I ledger, J map, K cta, L offset)
  global: string[];                        // features applied site-wide
}

export const UPGRADE_PACKS: UpgradePack[] = [
  {
    id: 'kinetic-gradient',
    name: 'Kinetic Gradient',
    tagline: 'color & light in motion',
    thread: 'A pointer-reactive gradient wash and ambient glow orbs live behind EVERY section; headlines are gradient-clipped; every interactive element carries a light glare/shine sweep — so color and light flow unbroken from top to bottom. The same hue family and the same glow language must repeat on every section.',
    sections: {
      A: ['mouse-gradient-wash', 'gradient-text-headline', 'mask-text-rise', 'animated-scroll-hint'],
      C: ['gradient-text-headline', 'hover.shine_sweep', 'ambient-glow-orbs'],
      D: ['tilt-card', 'hover.shine_sweep', 'ambient-glow-orbs'],
      G: ['spec-count-up', 'gradient-text-headline', 'ambient-glow-orbs'],
      H: ['mask-text-rise', 'ambient-glow-orbs', 'hover.text_roll'],
      J: ['dark-mode-map-embed', 'ambient-glow-orbs'],
      K: ['frosted-glass-cta-card', 'hover.fill_sweep', 'evasive-no-magnetic-yes'],
      L: ['mouse-gradient-wash', 'gradient-text-headline', 'hover.shine_sweep'],
    },
    global: ['scroll.progress_bar', 'postfx-grade-stack'],
  },
  {
    id: 'depth-parallax',
    name: 'Depth & Parallax',
    tagline: 'cinematic layered 3D space',
    thread: 'Layered parallax and floating cutouts drift consistently on scroll, unified by a shared film-grain/vignette overlay and Lenis smooth scroll, so the whole page reads as one deep cinematic space. The SAME parallax depth bands and the SAME grain must persist on every section — never a flat section between deep ones.',
    sections: {
      A: ['floating-cutout-parallax', 'cinematic-composite-depth', 'scroll-linked-pill-reveal', 'animated-scroll-hint'],
      C: ['floating-cutout-parallax', 'hover.shine_sweep'],
      D: ['tilt-card', 'floating-polaroids-ambient', 'lightbox-gallery'],
      E: ['scroll.horizontal_track', 'stagger-group-reveal'],
      G: ['count-up-on-view', 'floating-photo-badge'],
      H: ['cinematic-composite-depth', 'stagger-group-reveal'],
      J: ['dark-mode-map-embed', 'floating-cutout-parallax'],
      K: ['frosted-glass-cta-card', 'evasive-no-magnetic-yes'],
      L: ['floating-cutout-parallax', 'floating-photo-badge', 'scroll-reveal'],
    },
    global: ['lenis-smooth-scroll', 'film-grain-vignette-overlay', 'scroll.progress_bar'],
  },
  {
    id: 'editorial-motion',
    name: 'Editorial Motion',
    tagline: 'refined typographic reveals',
    thread: 'An auto-wiring reveal system drives everything; EVERY heading uses mask-rise or line-by-line, media blurs in, and every hover is a text-roll or fill-sweep — motion is elegant, text-led, and restrained everywhere. The SAME reveal timing and the SAME hover language must repeat on every section; no loud effects that break the editorial calm.',
    sections: {
      A: ['mask-text-rise', 'typewriter-caret', 'animated-scroll-hint'],
      C: ['hover.text_roll', 'reveal.line_by_line'],
      D: ['css-masonry-gallery', 'reveal.blur_in', 'hover.shine_sweep'],
      G: ['spec-count-up', 'mask-text-rise'],
      H: ['reveal.line_by_line', 'stagger-group-reveal'],
      I: ['stagger-group-reveal', 'hover.fill_sweep'],
      J: ['dark-mode-map-embed', 'reveal.blur_in'],
      K: ['mask-text-rise', 'hover.fill_sweep', 'async-status-lead-form'],
      L: ['stagger-group-reveal', 'hover.fill_sweep', 'reveal.blur_in'],
    },
    global: ['scroll-reveal-system', 'reveal.blur_in', 'scroll-aware-nav', 'scroll.progress_bar'],
  },
];

export function packSummaries() {
  return UPGRADE_PACKS.map(p => {
    // Flatten every feature the pack composes (per-archetype sections + globals) into a
    // unique, ordered list — the Showcase presets tab reuses these as member demos.
    const members = [...new Set([...Object.values(p.sections ?? {}).flat(), ...(p.global ?? [])])];
    return { id: p.id, name: p.name, tagline: p.tagline, thread: p.thread, features: members };
  });
}

// Compose the natural-language instruction the edit agent runs, per upgrade mode.
export function composeUpgradeInstruction(
  mode: 'features' | 'redundancy' | 'section',
  opts: { packId?: string; description?: string } = {},
): string | null {
  const QA = ' Only ADD/enhance — never remove content or break links or forms. Reuse the existing motion tokens + reduced-motion guards. QA every page at 375/768/1280 with screenshots; loop back until clean.';
  if (mode === 'features') {
    const pack = UPGRADE_PACKS.find(p => p.id === opts.packId);
    if (!pack) return null;
    const perSection = Object.entries(pack.sections)
      .map(([arch, feats]) => `${arch}: ${feats.join(', ')}`)
      .join(' · ');
    return `VISUAL UPGRADE — apply the "${pack.name}" pack (${pack.tagline}) across EVERY section of this site. ` +
      `CONTINUITY THREAD (non-negotiable — it must carry unbroken section to section): ${pack.thread} ` +
      `Add 3–4 features per section, choosing the section-appropriate variant from these per-archetype options — ` +
      `${perSection}. Site-wide: ${pack.global.join(', ')}. ` +
      `You (Athena) pick which specific feature fits each real section, but the shared thread above must be present on all of them so the site reads as ONE designed system, not a bag of effects.` + QA;
  }
  if (mode === 'redundancy') {
    return `REDUNDANCY / ANTI-SAMENESS PASS — audit every section of this site: do the sections actually DIFFERENTIATE, or do several look the same (same layout, same archetype, same motion)? ` +
      `Wherever two sections read alike — especially adjacent ones — CHANGE ONE UP: give it a different layout/archetype treatment, a different signature interaction, or a different rhythm, so no two neighbors share the same look. ` +
      `Keep the site's existing theme and palette; add RANGE, not randomness. The goal is a site with variety and a clear one-signature-moment, never a monotonous stack.` + QA;
  }
  if (mode === 'section') {
    const d = (opts.description ?? '').trim();
    if (!d) return null;
    return `ADD A NEW SECTION — build and insert a new section described as: "${d}". ` +
      `Match the site's EXISTING visual language, palette, and motion vocabulary so it belongs. ` +
      `Place it where it flows best in the page order (not just appended at the end unless that's right), give it a distinct archetype from its neighbors, and wire any CTAs/links to real destinations.` + QA;
  }
  return null;
}
