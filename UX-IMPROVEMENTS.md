# Prologue UX improvements

Implemented on `feature/ui-fixes02`. Local preview: http://localhost:8787/.

- Settings now contains duration and optional question limits. Language remains visible, with 10 minutes and unlimited questions as the defaults.
- Four accessible interview styles appear in both setup modes. Personal Story is selected initially; server-side style defaults guide prompts and survive guided intake. Legacy angle and custom-beat requests remain compatible.
- Unlimited no longer has an inferred question ceiling. At the final-minute answer boundary, the interviewer asks one closing question, waits for the complete answer, then thanks the interviewee. Explicit limits reserve the final question slot. Closing state persists and localized fallbacks keep the ending usable on model failure.
- A connected four-step journey supports keyboard and touch expansion.
- Responsive layouts, visible selection/focus, reduced-motion rules, and light/dark styling use the existing design system.

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`, and `git diff --check` pass; 31 tests pass.
- New tests cover defaults, styles in both languages, guided intake, legacy compatibility, explicit limits, exact closing threshold, overlong final answers, persistent closing state, malformed/unavailable model output, and consent gating.
- Existing regressions cover voice/text presentation, microphone permission fallback, transcripts, consent, privacy, content generation, email, PDF, copying, themes, and archive/history.
- Browser checks cover keyboard radio selection, Settings toggling and invalid-field focus, journey expansion, desktop/mobile layouts, and light/dark appearance. Narrow radio wrapping and dark focus backgrounds were corrected during inspection.
- Reduced motion was checked against the CSS rules. Conversation/model behavior and external delivery were tested with mocks; no fresh live microphone or paid-model interview was run.

## Direct room entry

Creation now navigates in the same tab to the real URL returned by the existing room API, for both manual and guided setup. The setup-only share panel and QR script are removed. A subtle loading indicator and disabled buttons prevent duplicate requests; errors restore the form for retry. Back navigation restores usable controls and synchronizes restored settings. Backend creation and operator capabilities are unchanged.

Verification: 35 tests, typecheck, lint, and diff checks pass. A real browser creation navigated directly into a room with Career Journey, Spanish, five minutes, and ten questions preserved. The room remained at its normal pre-interview screen; microphone initialization was not bypassed.

## Application-wide responsive layouts

Both pages now load shared screen-only responsive rules. Setup uses a stacked sidebar on tablets, balanced option grids, fluid spacing, wrapping navigation, and touch-sized controls. Interview headers, voice/text actions, consent choices, completion actions, and email forms reflow on smaller screens. Long names, questions, transcript text, and generated stories wrap without forcing horizontal scrolling. Short landscape layouts reduce excess vertical space. Printing keeps its existing styles.

Verification: the complete 36-test suite, typecheck, lint, and diff checks pass. The responsive regression also passes at 320, 390, 520, 600, 768, 1000, 1001, 1024, 1440, and 1920 pixels wide, plus 844×390 landscape, in light and dark themes. It exercises setup, guided mode, expanded settings/journey/archive, interview intro, live text and voice controls, operator transcript, consent, results, and email. Long unbroken strings and English/Spanish interview copy are included; reduced motion is enabled. Tests assert both page and component containment, and screenshots were inspected. Browser checks use Chromium; microphone hardware and paid services are mocked for layout tests.

## Matching green dropdowns

Language, question-limit, and theme dropdowns now use shared olive-green menus instead of the operating system's native selection color. The original select elements still supply form values and change events. Menus support arrow keys, Home/End, typing to find an option, Enter/Space, Escape, Tab, outside-click dismissal, and theme persistence. Popup positioning keeps menus within mobile viewports and above clipped layout containers.

The existing 36-test suite passed after integration; an additional focused browser test passes for keyboard behavior, selected colors in both themes, persistence, dismissal, and menu bounds at 320px. Lint now covers the new dropdown script. Local preview was restarted at http://localhost:8787/.

No data migration or new dependency is required. Changes remain uncommitted.
