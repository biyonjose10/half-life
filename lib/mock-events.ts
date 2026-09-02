/**
 * Development / demo fixture for the Half-Life console.
 *
 * This file exists so the front end is fully developable and demoable before
 * `/api/run` is wired up. It is a faithful *shape* replica of a real run:
 * every fact mirrors a real row in `corpus/truth/upgrade-guide.mdx` (with the
 * real line number), every asset is a real published DEV.to tutorial from
 * `corpus/library/assets.json`, and every `staleSentence` below appears
 * verbatim in the segment it cites - the same invariant the real adjudicator
 * enforces in code.
 *
 * Nothing here is imported by the pipeline. It is UI scaffolding only.
 */

import type {
  Asset,
  Candidate,
  ChangedFact,
  Finding,
  MatchMethod,
  PipelineEvent,
  Repair,
  Segment,
} from '@/lib/pipeline/types';

const GUIDE = 'corpus/truth/upgrade-guide.mdx';

// ---------------------------------------------------------------------------
// fact builders - mirror lib/pipeline/stage1-diff.ts so the mock is
// indistinguishable from a real stage-1 payload
// ---------------------------------------------------------------------------

function slug(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 60);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classPattern(old: string): string {
  const base = old.replace(/-\*$/, '');
  const wildcard = old.endsWith('-*');
  return `(?<![\\w-])${escapeRegex(base)}${wildcard ? '[\\w./]+' : ''}(?![\\w-])`;
}

const silentByRenameTarget = (old: string) =>
  `\`${old}\` is still valid in v4 - it is the new name for a different ` +
  `v3 utility. v3 content using it renders a different result with no error.`;

const silentBySurface = (old: string) =>
  `\`${old}\` is still declared in the v4 utility source with different ` +
  `behaviour, so v3 content using it fails silently rather than erroring.`;

const breakingReason = (old: string) =>
  `\`${old}\` no longer resolves in v4, so the published step visibly fails.`;

function rename(
  old: string,
  next: string,
  line: number,
  why: 'rename-target' | 'v4-surface',
): ChangedFact {
  return {
    id: `rename:${slug(old)}->${slug(next)}`,
    kind: 'renamed',
    old,
    new: next,
    detail: `\`${old}\` was renamed to \`${next}\` in v4.`,
    severity: 'silent',
    severityReason:
      why === 'rename-target' ? silentByRenameTarget(old) : silentBySurface(old),
    source: 'upgrade-guide-rename-table',
    evidence: { file: GUIDE, line, quote: `${old} → ${next}` },
    pattern: classPattern(old),
  };
}

function removal(
  old: string,
  replacement: string | null,
  advice: string,
  line: number,
): ChangedFact {
  return {
    id: `removal:${slug(old)}${replacement ? `->${slug(replacement)}` : ''}`,
    kind: 'removed',
    old,
    new: replacement,
    detail: `\`${old}\` was removed in v4. ${advice}`,
    severity: 'breaking',
    severityReason: breakingReason(old),
    source: 'upgrade-guide-removal-table',
    evidence: { file: GUIDE, line, quote: `${old} — ${advice}` },
    pattern: classPattern(old),
  };
}

function codeblock(oldLines: string[], newLines: string[], line: number): ChangedFact {
  const old = oldLines.join('\n');
  const next = newLines.join('\n');
  return {
    id: `codeblock:${slug(old)}->${slug(next)}`,
    kind: 'behaviour-changed',
    old,
    new: next,
    detail: `v3 wrote:\n${old}\n\nv4 requires:\n${next}`,
    severity: 'breaking',
    severityReason: breakingReason(old),
    source: 'upgrade-guide-codeblock',
    evidence: { file: GUIDE, line, quote: oldLines.join(' / ') },
    pattern: oldLines.map(escapeRegex).join('|'),
  };
}

// ---------------------------------------------------------------------------
// Stage 1 output - 30 facts off the real upgrade guide
// ---------------------------------------------------------------------------

// The renamed shadow / radius / blur scale. Every one of these is `silent`:
// the v3 name still resolves in v4, it just means something else now.
const fShadowSm = rename('shadow-sm', 'shadow-xs', 224, 'rename-target');
const fShadow = rename('shadow', 'shadow-sm', 232, 'v4-surface');
const fDropShadowSm = rename('drop-shadow-sm', 'drop-shadow-xs', 240, 'rename-target');
const fDropShadow = rename('drop-shadow', 'drop-shadow-sm', 248, 'v4-surface');
const fBlurSm = rename('blur-sm', 'blur-xs', 256, 'rename-target');
const fBlur = rename('blur', 'blur-sm', 264, 'v4-surface');
const fBackdropBlurSm = rename('backdrop-blur-sm', 'backdrop-blur-xs', 272, 'rename-target');
const fBackdropBlur = rename('backdrop-blur', 'backdrop-blur-sm', 280, 'v4-surface');
const fRoundedSm = rename('rounded-sm', 'rounded-xs', 288, 'rename-target');
const fRounded = rename('rounded', 'rounded-sm', 296, 'v4-surface');
const fOutlineNone = rename('outline-none', 'outline-hidden', 304, 'v4-surface');
const fRing = rename('ring', 'ring-3', 312, 'v4-surface');

// Deprecated utilities dropped in v4. These fail loudly.
const fBgOpacity = removal('bg-opacity-*', 'bg-black/50', 'Use opacity modifiers like bg-black/50', 117);
const fTextOpacity = removal('text-opacity-*', 'text-black/50', 'Use opacity modifiers like text-black/50', 125);
const fBorderOpacity = removal('border-opacity-*', 'border-black/50', 'Use opacity modifiers like border-black/50', 133);
const fDivideOpacity = removal('divide-opacity-*', 'divide-black/50', 'Use opacity modifiers like divide-black/50', 141);
const fRingOpacity = removal('ring-opacity-*', 'ring-black/50', 'Use opacity modifiers like ring-black/50', 149);
const fPlaceholderOpacity = removal('placeholder-opacity-*', 'placeholder-black/50', 'Use opacity modifiers like placeholder-black/50', 157);
const fFlexShrink = removal('flex-shrink-*', 'shrink-*', 'shrink-*', 165);
const fFlexGrow = removal('flex-grow-*', 'grow-*', 'grow-*', 173);
const fOverflowEllipsis = removal('overflow-ellipsis', 'text-ellipsis', 'text-ellipsis', 181);
const fDecorationSlice = removal('decoration-slice', 'box-decoration-slice', 'box-decoration-slice', 189);
const fDecorationClone = removal('decoration-clone', 'box-decoration-clone', 'box-decoration-clone', 197);

// Annotated before/after fences in the guide.
const fPostcss = codeblock(
  ['"postcss-import": {},', 'tailwindcss: {},', 'autoprefixer: {},'],
  ['"@tailwindcss/postcss": {},'],
  33,
);
const fCli = codeblock(
  ['npx tailwindcss -i input.css -o output.css'],
  ['npx @tailwindcss/cli -i input.css -o output.css'],
  69,
);
const fDirectives = codeblock(
  ['@tailwind base;', '@tailwind components;', '@tailwind utilities;'],
  ['@import "tailwindcss";'],
  93,
);
const fOutlineWidth = codeblock(
  ['<input class="outline outline-2" />'],
  ['<input class="outline-2" />'],
  348,
);
const fSpaceY = codeblock(
  ['<div class="space-y-4 p-4">'],
  ['<div class="flex flex-col gap-4 p-4">'],
  406,
);
const fVarShorthand = codeblock(
  ['<div class="bg-[--brand-color]"></div>'],
  ['<div class="bg-(--brand-color)"></div>'],
  717,
);
const fArbitraryCommas = codeblock(
  ['<div class="grid-cols-[max-content,auto]"></div>'],
  ['<div class="grid-cols-[max-content_auto]"></div>'],
  731,
);

/** Stage 1 is deterministic and sorts by id, so the mock does too. */
export const mockFacts: ChangedFact[] = [
  fShadowSm, fShadow, fDropShadowSm, fDropShadow, fBlurSm, fBlur,
  fBackdropBlurSm, fBackdropBlur, fRoundedSm, fRounded, fOutlineNone, fRing,
  fBgOpacity, fTextOpacity, fBorderOpacity, fDivideOpacity, fRingOpacity,
  fPlaceholderOpacity, fFlexShrink, fFlexGrow, fOverflowEllipsis,
  fDecorationSlice, fDecorationClone,
  fPostcss, fCli, fDirectives, fOutlineWidth, fSpaceY, fVarShorthand,
  fArbitraryCommas,
].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// ---------------------------------------------------------------------------
// Library corpus - 22 real published DEV.to tutorials
//
// Only the segments the run actually cites carry text here; the rest are
// elided because the console never renders them.
// ---------------------------------------------------------------------------

function seg(idx: number, heading: string, kind: Segment['kind'], text: string): Segment {
  return { idx, heading, kind, text };
}

const DIRECTIVES_BLOCK = '```css\n@tailwind base;\n@tailwind components;\n@tailwind utilities;\n```';

function article(
  id: string,
  title: string,
  url: string,
  publishedAt: string,
  segments: Segment[] = [],
): Asset {
  return { id, title, url, publishedAt, type: 'article', segments };
}

export const mockAssets: Asset[] = [
  article(
    'devto-1328146',
    'How to install Tailwind CSS with Nuxt.js and Flowbite',
    'https://dev.to/themesberg/how-to-install-tailwind-css-with-nuxtjs-and-flowbite-20fj',
    '2023-01-13',
    [
      seg(19, 'Install Tailwind CSS', 'code', DIRECTIVES_BLOCK),
      seg(
        32,
        'Flowbite Components',
        'code',
        '```html\n<template>\n    <div>\n        <div class="flex justify-center p-4">\n            <button id="button" data-modal-toggle="modal" data-modal-target="modal" type="button" class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mr-2 mb-2 dark:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none dark:focus:ring-blue-800">Show modal</button>\n        </div>\n    </div>\n</template>\n```',
      ),
    ],
  ),
  article(
    'devto-1094565',
    'How to set up Ruby on Rails with Tailwind CSS and Flowbite',
    'https://dev.to/themesberg/how-to-set-up-ruby-on-rails-with-tailwind-css-and-flowbite-47ki',
    '2022-05-24',
    [
      seg(18, 'Install Tailwind CSS', 'code', DIRECTIVES_BLOCK),
      seg(
        36,
        'Create a homepage',
        'code',
        '```html\n<button data-tooltip-target="tooltip-default" type="button" class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800">Default tooltip</button>\n<div id="tooltip-default" role="tooltip" class="inline-block absolute invisible z-10 py-2 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg shadow-sm opacity-0 transition-opacity duration-300 tooltip dark:bg-gray-700">\n    Tooltip content\n    <div class="tooltip-arrow" data-popper-arrow></div>\n</div>\n```',
      ),
    ],
  ),
  article(
    'devto-1375063',
    'How to install Symfony with Flowbite and Tailwind CSS',
    'https://dev.to/themesberg/how-to-install-symfony-with-flowbite-and-tailwind-css-1o06',
    '2023-02-22',
    [
      seg(28, 'Install Tailwind CSS', 'code', DIRECTIVES_BLOCK),
      seg(
        38,
        'Install Tailwind CSS',
        'code',
        '```html\n<a href="#" class="text-gray-800 dark:text-white hover:bg-gray-50 focus:ring-4 focus:ring-gray-300 font-medium rounded-lg text-sm px-4 lg:px-5 py-2 lg:py-2.5 mr-2 dark:hover:bg-gray-700 focus:outline-none dark:focus:ring-gray-800">Log in</a>\n```',
      ),
    ],
  ),
  article(
    'devto-1469719',
    'How to build an application shell layout for Tailwind CSS',
    'https://dev.to/themesberg/how-to-build-an-application-shell-layout-for-tailwind-css-247k',
    '2023-05-16',
    [
      seg(
        15,
        'Building an app shell layout',
        'code',
        '```html\n<div class="antialiased bg-gray-50 dark:bg-gray-900">\n    <nav class="bg-white border-b border-gray-200 px-4 py-2.5 dark:bg-gray-800 dark:border-gray-700 fixed left-0 right-0 top-0 z-50">\n        <div class="flex justify-start items-center">\n                <div class="flex-shrink-0">\n          class="inline-block absolute invisible z-10 py-2 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg shadow-sm opacity-0 transition-opacity duration-300 tooltip"\n```',
      ),
    ],
  ),
  article(
    'devto-1527898',
    'How to install Angular with Tailwind CSS and the UI components from Flowbite',
    'https://dev.to/themesberg/how-to-install-angular-with-tailwind-css-and-the-ui-components-from-flowbite-2lkg',
    '2023-07-06',
  ),
  article(
    'devto-1101611',
    'How to install Django with Tailwind CSS and Flowbite',
    'https://dev.to/themesberg/how-to-install-django-with-tailwind-css-and-flowbite-2cmk',
    '2022-06-01',
  ),
  article(
    'devto-1477376',
    'How to Build a Modal Video with HTML, Tailwind CSS and Alpine.js',
    'https://dev.to/cruip_com/how-to-build-a-modal-video-with-html-tailwind-css-and-alpinejs-40n5',
    '2023-05-23',
    [
      seg(
        7,
        'Live Demo / Download',
        'code',
        '```html\n<!-- 1. The button -->\n<button\n    class="relative flex justify-center items-center focus:outline-none focus-visible:ring focus-visible:ring-indigo-300 rounded-3xl group"\n    @click="modalOpen = true"\n    aria-controls="modal"\n    aria-label="Watch the video"\n>\n```',
      ),
      seg(
        33,
        'Improving Accessibility',
        'prose',
        'We also want to remove the button’s outline on click while maintaining accessibility requirements. For this, we add some Tailwind CSS classes that remove the outline on click (`focus:outline-none`) and enable focus for keyboard users (`focus-visible:ring` `focus-visible:ring-indigo-300`).',
      ),
    ],
  ),
  article(
    'devto-1477382',
    'How to Build a Modal Video Component with Tailwind CSS and Next.js',
    'https://dev.to/cruip_com/how-to-build-a-modal-video-component-with-tailwind-css-and-nextjs-5io',
    '2023-05-23',
  ),
  article(
    'devto-1477384',
    'How to Build a Modal Video Component with Tailwind CSS and Vue',
    'https://dev.to/cruip_com/how-to-build-a-modal-video-component-with-tailwind-css-and-vue-aih',
    '2023-05-23',
  ),
  article(
    'devto-1572178',
    'Learn how to install Qwik with Tailwind CSS and Flowbite',
    'https://dev.to/themesberg/learn-how-to-install-qwik-with-tailwind-css-and-flowbite-4b54',
    '2023-08-18',
    [
      seg(
        32,
        'UI components',
        'code',
        '```html\n<div class="relative bg-white rounded-lg shadow dark:bg-gray-700">\n```',
      ),
    ],
  ),
  article(
    'devto-1614214',
    'Learn how to install Blazor (.NET) with Flowbite and Tailwind CSS',
    'https://dev.to/themesberg/learn-how-to-install-blazor-net-with-flowbite-and-tailwind-css-2inn',
    '2023-09-28',
  ),
  article(
    'devto-1668628',
    'How to Create an Awesome Landing Page with Tailwind CSS (Step-by-Step Guide)',
    'https://dev.to/creativetim_official/how-to-create-a-landing-page-with-tailwind-cssstep-by-step-guide-5b52',
    '2023-11-16',
    [
      seg(
        87,
        'Integrating Interactivity: Buttons, Forms, and Modals',
        'code',
        '```html\n<div\n class="pointer-events-none fixed inset-0 z-[999] grid h-screen w-screen place-items-center bg-black bg-opacity-60 opacity-0 backdrop-blur-sm transition-opacity duration-300"\n>\n```',
      ),
    ],
  ),
  article(
    'devto-1419548',
    'Getting Started with Next.js, Storybook, Tailwind CSS, and Playwright',
    'https://dev.to/jkadhuwa/getting-started-with-nextjs-storybook-tailwind-css-and-playwright-a-beginners-guide-34j8',
    '2023-03-30',
  ),
  article(
    'devto-1076131',
    'How to Setup and Start Using TailWind',
    'https://dev.to/codesphere/how-to-setup-and-start-using-tailwind-2khk',
    '2022-05-05',
    [
      seg(
        7,
        'Installation and Configuration',
        'prose',
        '`@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`',
      ),
    ],
  ),
  article(
    'devto-1099296',
    'Setup Tailwind CSS in a React project configured from scratch with Webpack',
    'https://dev.to/ivadyhabimana/setup-tailwind-css-in-a-react-project-configured-from-scratch-a-step-by-step-guide-2jc8',
    '2022-05-30',
  ),
  article(
    'devto-1334724',
    'Complete Guide On How To Install Tailwindcss Via NPM',
    'https://dev.to/kevvve/complete-guide-on-how-to-install-tailwind-css-via-npm-9mh',
    '2023-01-16',
  ),
  article(
    'devto-1543393',
    'Building a Simple CRUD Task Manager App with Angular',
    'https://dev.to/ayushdev_24/building-a-simple-crud-task-manager-app-with-angular-a-step-by-step-guide-for-beginners-2moo',
    '2023-07-20',
    [
      seg(
        17,
        'Step 2: Implementing the Navbar Template',
        'code',
        '```typescript\n<!-- components/navbar/navbar.component.html -->\n<nav class="flex items-center justify-between flex-wrap bg-indigo-400 p-4">\n  <div class="flex items-center flex-shrink-0 text-white mr-6">\n    <span class="font-semibold text-xl tracking-tight">Tasks</span>\n  </div>\n</nav>\n```',
      ),
    ],
  ),
  article(
    'devto-1958845',
    'How to Install and Set Up Tailwind CSS from Scratch',
    'https://dev.to/clare_codes/how-to-install-and-set-up-tailwind-css-from-scratch-3cn3',
    '2024-08-14',
  ),
  article(
    'devto-1932295',
    'How to Build a Chatbot with Next.js, TailwindCSS, and OpenAI Chat Completion API',
    'https://dev.to/abetavarez/how-to-build-a-chatbot-with-nextjs-tailwindcss-and-openai-chat-completion-api-full-tutorial-4ee1',
    '2024-07-22',
  ),
  article(
    'devto-1957261',
    'How to Install Radix UI: A Step-by-Step Guide',
    'https://dev.to/swhabitation/how-to-install-radix-ui-a-step-by-step-guide-56of',
    '2024-08-13',
    [
      seg(
        32,
        'Prerequisites',
        'code',
        '```jsx\n<Dialog.Content className="p-4 bg-white rounded-lg shadow-lg">\n```',
      ),
    ],
  ),
  article(
    'devto-1084463',
    'How to build a Tailwind CSS Select Dropdown component with Flowbite',
    'https://dev.to/themesberg/how-to-build-a-tailwind-css-select-dropdown-component-with-flowbite-4057',
    '2022-05-13',
    [
      seg(
        9,
        'Tailwind CSS Select',
        'code',
        '```html\n<select id="countries" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5">\n```',
      ),
    ],
  ),
  article(
    'devto-1090911',
    'How to build textarea components using Tailwind CSS and Flowbite',
    'https://dev.to/themesberg/how-to-build-textarea-components-using-tailwind-css-and-flowbite-18ol',
    '2022-05-20',
  ),
];

// ---------------------------------------------------------------------------
// Stage 3 output - what the adjudicator confirmed
// ---------------------------------------------------------------------------

function stale(
  fact: ChangedFact,
  assetId: string,
  segmentIdx: number,
  confidence: number,
  staleSentence: string,
  why: string,
): Finding {
  return { factId: fact.id, assetId, segmentIdx, verdict: 'STALE', confidence, staleSentence, why };
}

function fine(
  fact: ChangedFact,
  assetId: string,
  segmentIdx: number,
  confidence: number,
  staleSentence: string,
  why: string,
): Finding {
  return { factId: fact.id, assetId, segmentIdx, verdict: 'FINE', confidence, staleSentence, why };
}

const TOOLTIP_DIV =
  '<div id="tooltip-default" role="tooltip" class="inline-block absolute invisible z-10 py-2 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg shadow-sm opacity-0 transition-opacity duration-300 tooltip dark:bg-gray-700">';
const TOOLTIP_BUTTON =
  '<button data-tooltip-target="tooltip-default" type="button" class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800">Default tooltip</button>';
const DIRECTIVES_LINES = '@tailwind base;\n@tailwind components;\n@tailwind utilities;';
const NUXT_MODAL_BUTTON =
  '<button id="button" data-modal-toggle="modal" data-modal-target="modal" type="button" class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mr-2 mb-2 dark:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none dark:focus:ring-blue-800">Show modal</button>';
const SHELL_TOOLTIP =
  'class="inline-block absolute invisible z-10 py-2 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg shadow-sm opacity-0 transition-opacity duration-300 tooltip"';
const SYMFONY_LOGIN =
  'focus:ring-4 focus:ring-gray-300 font-medium rounded-lg text-sm px-4 lg:px-5 py-2 lg:py-2.5 mr-2 dark:hover:bg-gray-700 focus:outline-none dark:focus:ring-gray-800';
const LANDING_MODAL =
  'class="pointer-events-none fixed inset-0 z-[999] grid h-screen w-screen place-items-center bg-black bg-opacity-60 opacity-0 backdrop-blur-sm transition-opacity duration-300"';
const ALPINE_BUTTON =
  'class="relative flex justify-center items-center focus:outline-none focus-visible:ring focus-visible:ring-indigo-300 rounded-3xl group"';
const ACCESSIBILITY_PROSE =
  'We also want to remove the button’s outline on click while maintaining accessibility requirements. For this, we add some Tailwind CSS classes that remove the outline on click (`focus:outline-none`) and enable focus for keyboard users (`focus-visible:ring` `focus-visible:ring-indigo-300`).';

const findings: Finding[] = [
  // devto-1094565 - the worst offender: two silent, one breaking
  stale(
    fShadowSm,
    'devto-1094565',
    36,
    0.94,
    TOOLTIP_DIV,
    'The tooltip is styled with `shadow-sm`, which in v3 was the smallest shadow. In v4 that same class name is the renamed v3 `shadow`, so a reader copying this markup gets a visibly heavier shadow than the screenshots in the article. Nothing errors.',
  ),
  stale(
    fOutlineNone,
    'devto-1094565',
    36,
    0.91,
    TOOLTIP_BUTTON,
    'The trigger button relies on `focus:outline-none` to suppress the focus ring. v4 kept the class name but repointed it at `outline-style: none`, so the accessible fallback outline the article is describing no longer behaves as written.',
  ),
  stale(
    fDirectives,
    'devto-1094565',
    18,
    0.99,
    DIRECTIVES_LINES,
    'The setup step instructs the reader to put the three `@tailwind` directives in `application.tailwind.css`. Under v4 those directives are not recognised and the build produces no utilities at all.',
  ),
  fine(
    fRounded,
    'devto-1094565',
    36,
    0.88,
    'rounded-lg',
    'Only the bare `rounded` utility was renamed. `rounded-lg` is untouched in v4, so this markup renders identically.',
  ),

  // devto-1477376 - the prose one, which is the most quotable
  stale(
    fOutlineNone,
    'devto-1477376',
    33,
    0.96,
    ACCESSIBILITY_PROSE,
    'This paragraph teaches `focus:outline-none` as the accessible way to remove the outline. That advice inverted in v4: `outline-none` now genuinely removes the outline, and the accessible variant the author meant is called `outline-hidden`. The sentence still compiles and now teaches the opposite of its own intent.',
  ),
  stale(
    fRing,
    'devto-1477376',
    7,
    0.89,
    ALPINE_BUTTON,
    'The focus ring is set with the bare `ring` utility, which was 3px in v3 and is 1px in v4. The keyboard-focus affordance this tutorial is specifically teaching becomes almost invisible, with no error.',
  ),

  // devto-1328146
  stale(
    fDirectives,
    'devto-1328146',
    19,
    0.99,
    DIRECTIVES_LINES,
    'The Nuxt setup writes the three `@tailwind` directives into `assets/css/input.css`. v4 removed the directives in favour of `@import "tailwindcss"`, so the stylesheet compiles to nothing.',
  ),
  stale(
    fOutlineNone,
    'devto-1328146',
    32,
    0.9,
    NUXT_MODAL_BUTTON,
    'The Flowbite modal trigger carries `focus:outline-none`. The class still exists in v4 but now sets `outline-style: none` outright, dropping the forced-colors fallback this markup used to keep.',
  ),

  // devto-1469719
  stale(
    fShadowSm,
    'devto-1469719',
    15,
    0.92,
    SHELL_TOOLTIP,
    'The app-shell tooltip uses `shadow-sm`. In v4 that is the old `shadow`, so the tooltip sits noticeably heavier than the layout the article demonstrates.',
  ),
  stale(
    fFlexShrink,
    'devto-1469719',
    15,
    0.97,
    '<div class="flex-shrink-0">',
    '`flex-shrink-0` was removed in v4. The logo wrapper in this shell layout loses its no-shrink behaviour and the nav collapses at narrow widths.',
  ),
  fine(
    fRounded,
    'devto-1469719',
    15,
    0.85,
    'rounded-lg',
    '`rounded-lg` is unaffected by the radius rename; only the bare `rounded` shifted.',
  ),

  // devto-1375063
  stale(
    fDirectives,
    'devto-1375063',
    28,
    0.99,
    DIRECTIVES_LINES,
    'The Symfony/Encore setup step writes the three `@tailwind` directives into `assets/styles/app.css`, which v4 no longer understands.',
  ),
  stale(
    fOutlineNone,
    'devto-1375063',
    38,
    0.88,
    SYMFONY_LOGIN,
    'The navbar login link suppresses its outline with `focus:outline-none`, which changed meaning in v4 while keeping the same name.',
  ),

  // devto-1668628 - one line, two different failures
  stale(
    fBgOpacity,
    'devto-1668628',
    87,
    0.98,
    LANDING_MODAL,
    'The modal backdrop uses `bg-opacity-60`, one of the opacity utilities removed in v4. The backdrop renders fully opaque black and covers the modal.',
  ),
  stale(
    fBackdropBlurSm,
    'devto-1668628',
    87,
    0.93,
    LANDING_MODAL,
    'The same line uses `backdrop-blur-sm`. That name survived into v4 but now maps to the old `backdrop-blur`, so the blur behind the modal is stronger than the article shows - and unlike the `bg-opacity` failure next to it, nothing signals the change.',
  ),

  // devto-1543393
  stale(
    fFlexShrink,
    'devto-1543393',
    17,
    0.96,
    '<div class="flex items-center flex-shrink-0 text-white mr-6">',
    'The navbar brand block uses `flex-shrink-0`, removed in v4 in favour of `shrink-0`. The title squashes as soon as the task list grows.',
  ),

  // devto-1076131
  stale(
    fDirectives,
    'devto-1076131',
    7,
    0.99,
    DIRECTIVES_LINES,
    'The article walks the reader through adding the three `@tailwind` directives to their primary CSS file. That instruction produces an empty stylesheet on v4.',
  ),

  // Assets that were checked and came back clean
  fine(
    fShadow,
    'devto-1572178',
    32,
    0.9,
    '<div class="relative bg-white rounded-lg shadow dark:bg-gray-700">',
    'The bare `shadow` utility still resolves to the same value in v4 for backward compatibility - only the explicit `-sm` names shifted. This modal renders identically on both versions.',
  ),
  fine(
    fShadow,
    'devto-1957261',
    32,
    0.83,
    '<Dialog.Content className="p-4 bg-white rounded-lg shadow-lg">',
    'Semantic retrieval surfaced this on the shadow scale, but `shadow-lg` is unchanged in v4. No action.',
  ),
  fine(
    fRing,
    'devto-1084463',
    9,
    0.86,
    'focus:ring-blue-500',
    '`ring-blue-500` sets the ring colour, not its width, so the default-width change does not alter this select component.',
  ),
];

// ---------------------------------------------------------------------------
// Stage 2 output - candidates. Every finding above had a candidate; the rest
// is the noise a real retrieval pass produces and the adjudicator throws away.
// ---------------------------------------------------------------------------

function candidate(
  factId: string,
  assetId: string,
  segmentIdx: number,
  method: MatchMethod,
  score: number,
  snippet: string,
): Candidate {
  return { factId, assetId, segmentIdx, method, score, snippet };
}

const hitCandidates: Candidate[] = findings.map((f) =>
  candidate(
    f.factId,
    f.assetId,
    f.segmentIdx,
    f.verdict === 'STALE' && f.confidence > 0.9 ? 'exact' : 'semantic',
    f.verdict === 'STALE' && f.confidence > 0.9 ? 1 : Number((0.72 + f.confidence * 0.2).toFixed(3)),
    f.staleSentence.length > 220 ? `${f.staleSentence.slice(0, 220)}…` : f.staleSentence,
  ),
);

/**
 * Retrieval noise: real segments that mention a changed token but that the
 * adjudicator never confirmed. Counted, never rendered.
 */
const noisePlan: Array<[ChangedFact, string, number[], MatchMethod]> = [
  [fDirectives, 'devto-1527898', [23], 'exact'],
  [fDirectives, 'devto-1101611', [41], 'exact'],
  [fDirectives, 'devto-1334724', [8], 'exact'],
  [fDirectives, 'devto-1958845', [15], 'exact'],
  [fDirectives, 'devto-1099296', [30], 'exact'],
  [fDirectives, 'devto-1419548', [20], 'exact'],
  [fCli, 'devto-1328146', [17], 'semantic'],
  [fCli, 'devto-1101611', [39], 'semantic'],
  [fCli, 'devto-1076131', [9], 'semantic'],
  [fCli, 'devto-1958845', [11], 'semantic'],
  [fRounded, 'devto-1084463', [9, 11, 15, 19, 21], 'semantic'],
  [fRounded, 'devto-1090911', [12, 14, 19], 'semantic'],
  [fRounded, 'devto-1572178', [30, 34], 'semantic'],
  [fRounded, 'devto-1614214', [64], 'semantic'],
  [fRounded, 'devto-1543393', [58], 'semantic'],
  [fRing, 'devto-1090911', [12, 14], 'semantic'],
  [fRing, 'devto-1477382', [14], 'semantic'],
  [fRing, 'devto-1477384', [12], 'semantic'],
  [fOutlineNone, 'devto-1477382', [14], 'exact'],
  [fOutlineNone, 'devto-1477384', [12], 'exact'],
  [fOutlineNone, 'devto-1614214', [64], 'exact'],
  [fShadow, 'devto-1084463', [9], 'semantic'],
  [fShadow, 'devto-1932295', [12], 'semantic'],
  [fBlurSm, 'devto-1668628', [87], 'semantic'],
  [fFlexShrink, 'devto-1543393', [34, 50], 'exact'],
  [fPostcss, 'devto-1099296', [22], 'semantic'],
  [fPostcss, 'devto-1419548', [16], 'semantic'],
  [fSpaceY, 'devto-1668628', [61], 'semantic'],
  [fSpaceY, 'devto-1932295', [12], 'semantic'],
  [fOutlineWidth, 'devto-1477376', [7], 'semantic'],
  [fTextOpacity, 'devto-1668628', [87], 'semantic'],
  [fRingOpacity, 'devto-1477376', [7], 'semantic'],
];

const noiseCandidates: Candidate[] = noisePlan.flatMap(([fact, assetId, idxs, method]) =>
  idxs.map((idx, i) =>
    candidate(
      fact.id,
      assetId,
      idx,
      method,
      method === 'exact' ? 1 : Number((0.81 - i * 0.017).toFixed(3)),
      method === 'exact'
        ? `… ${fact.old.split('\n')[0]} …`
        : `… near-match on \`${fact.old}\` in segment ${idx} …`,
    ),
  ),
);

export const mockCandidates: Candidate[] = [...hitCandidates, ...noiseCandidates];

// ---------------------------------------------------------------------------
// Stage 4 output - grounded repairs, one per confirmed stale finding
// ---------------------------------------------------------------------------

function repair(f: Finding, corrected: string, pinnedComment: string): Repair {
  return { factId: f.factId, assetId: f.assetId, segmentIdx: f.segmentIdx, corrected, pinnedComment };
}

const staleFindings = findings.filter((f) => f.verdict === 'STALE');

const repairText: Record<number, [string, string]> = {
  0: [
    TOOLTIP_DIV.replace('shadow-sm', 'shadow-xs'),
    'Note for readers on Tailwind CSS v4: this tutorial was written for v3, and v4 renamed the shadow scale. `shadow-sm` now means what v3 called `shadow`, so the tooltip above renders a heavier shadow than the screenshots. Change it to `shadow-xs` for the original look. Nothing errors either way, which is exactly why it is easy to miss.',
  ],
  1: [
    TOOLTIP_BUTTON.replace('focus:outline-none', 'focus:outline-hidden'),
    'Update for Tailwind CSS v4: `outline-none` was renamed to `outline-hidden`, and the name `outline-none` was reused for a utility that really does set `outline-style: none`. Use `focus:outline-hidden` on this button to keep the forced-colors accessibility fallback the article intends.',
  ],
  2: [
    '@import "tailwindcss";',
    'Update for Tailwind CSS v4: the `@tailwind base/components/utilities` directives were removed. Replace all three lines in `app/assets/stylesheets/application.tailwind.css` with a single `@import "tailwindcss";`. On v4 the old directives compile to an empty stylesheet, so the app looks unstyled.',
  ],
  3: [
    'We also want to remove the button’s outline on click while maintaining accessibility requirements. For this, we add some Tailwind CSS classes that remove the outline on click (`focus:outline-hidden`) and enable focus for keyboard users (`focus-visible:ring-3` `focus-visible:ring-indigo-300`).',
    'Update for Tailwind CSS v4: the accessible utility described here is now called `outline-hidden`. In v4, `outline-none` sets `outline-style: none` for real, which removes the forced-colors fallback this section is specifically trying to preserve. Use `focus:outline-hidden` instead. The v3 wording still compiles on v4, so this one will not show up as an error.',
  ],
  4: [
    ALPINE_BUTTON.replace('focus-visible:ring ', 'focus-visible:ring-3 ').replace(
      'focus:outline-none',
      'focus:outline-hidden',
    ),
    'Update for Tailwind CSS v4: the bare `ring` utility went from 3px to 1px and its default colour is now `currentColor`. The keyboard focus ring this tutorial teaches becomes nearly invisible on v4 — use `focus-visible:ring-3` to keep the demo behaviour.',
  ],
  5: [
    '@import "tailwindcss";',
    'Update for Tailwind CSS v4: replace the three `@tailwind` directives in `assets/css/input.css` with `@import "tailwindcss";`. In v4 the directives are gone, so the Nuxt build emits no utility CSS at all.',
  ],
  6: [
    NUXT_MODAL_BUTTON.replace('focus:outline-none', 'focus:outline-hidden'),
    'Update for Tailwind CSS v4: `outline-none` was renamed to `outline-hidden`. Swap `focus:outline-none` for `focus:outline-hidden` on this modal trigger — the class name still works on v4, it just does something different now.',
  ],
  7: [
    SHELL_TOOLTIP.replace('shadow-sm', 'shadow-xs'),
    'Update for Tailwind CSS v4: `shadow-sm` in v4 is the shadow v3 called `shadow`. The tooltip in this shell layout will look heavier than the screenshots. Use `shadow-xs` to match. No build error accompanies this change.',
  ],
  8: [
    '<div class="shrink-0">',
    'Update for Tailwind CSS v4: `flex-shrink-0` was removed — use `shrink-0`. Without it the logo block in this shell collapses on narrow viewports.',
  ],
  9: [
    '@import "tailwindcss";',
    'Update for Tailwind CSS v4: swap the three `@tailwind` directives in `assets/styles/app.css` for `@import "tailwindcss";`. The v3 directives no longer compile under v4.',
  ],
  10: [
    SYMFONY_LOGIN.replace('focus:outline-none', 'focus:outline-hidden'),
    'Update for Tailwind CSS v4: use `focus:outline-hidden` on this navbar link. `outline-none` still exists in v4 but now means `outline-style: none`, which is not what this markup wanted.',
  ],
  11: [
    LANDING_MODAL.replace('bg-black bg-opacity-60', 'bg-black/60'),
    'Update for Tailwind CSS v4: the `bg-opacity-*` utilities were removed. Write the backdrop as `bg-black/60` instead of `bg-black bg-opacity-60`, otherwise the overlay renders fully opaque and hides the modal.',
  ],
  12: [
    LANDING_MODAL.replace('backdrop-blur-sm', 'backdrop-blur-xs'),
    'Update for Tailwind CSS v4: `backdrop-blur-sm` now maps to what v3 called `backdrop-blur`, so the blur behind this modal is stronger than intended. Use `backdrop-blur-xs` for the original look. Note this is on the same line as the `bg-opacity` fix, but unlike that one it produces no error — the page just looks wrong.',
  ],
  13: [
    '<div class="flex items-center shrink-0 text-white mr-6">',
    'Update for Tailwind CSS v4: `flex-shrink-0` was removed in favour of `shrink-0`. Change it in the navbar template or the brand title will squash once tasks are added.',
  ],
  14: [
    '`@import "tailwindcss";`',
    'Update for Tailwind CSS v4: this article predates v4, which removed the `@tailwind` directives entirely. A v4 project needs a single `@import "tailwindcss";` in the primary CSS file — the three directives shown here compile to nothing.',
  ],
};

const repairs: Repair[] = staleFindings.map((f, i) => {
  const [corrected, pinnedComment] = repairText[i];
  return repair(f, corrected, pinnedComment);
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * A complete, realistic run: 30 facts -> 60 candidates -> 15 confirmed stale
 * findings across 8 assets (plus 3 assets checked and cleared) -> 15 patches.
 */
export function mockEvents(): PipelineEvent[] {
  const events: PipelineEvent[] = [];

  // --- stage 1 -------------------------------------------------------------
  events.push({ type: 'stage-start', stage: 'diff' });
  for (const done of [7, 15, 23, mockFacts.length]) {
    events.push({ type: 'stage-progress', stage: 'diff', done, total: mockFacts.length });
  }
  events.push({ type: 'facts', facts: mockFacts });
  events.push({ type: 'stage-done', stage: 'diff', count: mockFacts.length, ms: 118 });

  // --- stage 2 -------------------------------------------------------------
  events.push({ type: 'stage-start', stage: 'retrieve' });
  const batches = [
    mockCandidates.slice(0, 21),
    mockCandidates.slice(21, 43),
    mockCandidates.slice(43),
  ];
  let scanned = 0;
  for (const batch of batches) {
    scanned += batch.length;
    events.push({
      type: 'stage-progress',
      stage: 'retrieve',
      done: scanned,
      total: mockCandidates.length,
    });
    events.push({ type: 'candidates', candidates: batch });
  }
  events.push({
    type: 'stage-done',
    stage: 'retrieve',
    count: mockCandidates.length,
    ms: 1_642,
  });

  // --- stage 3 -------------------------------------------------------------
  events.push({ type: 'stage-start', stage: 'adjudicate' });
  findings.forEach((finding, i) => {
    events.push({ type: 'finding', finding });
    events.push({
      type: 'stage-progress',
      stage: 'adjudicate',
      done: i + 1,
      total: findings.length,
    });
  });
  events.push({
    type: 'stage-done',
    stage: 'adjudicate',
    count: staleFindings.length,
    ms: 11_204,
  });

  // --- stage 4 -------------------------------------------------------------
  events.push({ type: 'stage-start', stage: 'repair' });
  repairs.forEach((r, i) => {
    events.push({ type: 'repair', repair: r });
    events.push({ type: 'stage-progress', stage: 'repair', done: i + 1, total: repairs.length });
  });
  events.push({ type: 'stage-done', stage: 'repair', count: repairs.length, ms: 8_931 });

  const staleAssets = new Set(staleFindings.map((f) => f.assetId)).size;
  events.push({ type: 'done', staleAssets, totalFindings: staleFindings.length });

  return events;
}
