# Frontend conventions (WIT layout, NüHabit brand)

The back office (`/dashboard/*`) uses the WIT layout dressed in the NüHabit Brand Guideline 2026: a beige canvas (`#f3ece2`), mint cream cards (`#fdfff2`) without borders, one ink surface (`#131a1c`) for emphasis, and pale lime (`#daff59`) for the single most important thing on screen. Controls are pills. Headings (`h1`-`h3`, card and dialog titles) use Outfit, body text uses Manrope, and codes use JetBrains Mono.

## Reference pages

Copy these when you build or restyle a page.

| Page | Route | Shows |
|---|---|---|
| Executive dashboard | `/dashboard` | `PageHeader`, the "Perlu keputusan" attention card, the ink hero, the accent card, `StatCard`, a column chart with one accent bar, ranked rows |
| Sign-in | `/login` | split layout: ink hero with the brand pattern, white wordmark and the brand line, mint cream form card, title ending in a forest period |
| Employees | `/dashboard/employees` | an untouched list page that inherits the style through the tokens and the kit |

## Shell

`src/components/shared/app-sidebar.tsx` renders the canvas for every dashboard page:

- **Rail** (`md` and up): a floating ink rail. It collapses to icons from `md` to `xl` and expands to `w-60` from `xl`; the expand choice persists under `bcd.admin.rail`. In the collapsed rail, a section opens its pages as a flyout.
- **Header**: page title with "branch · date", the page search (`⌘K`, searches the user's IAM menu), the desktop link, theme, notifications and the account pill.
- **Phone** (below `md`): a floating ink bottom bar (Beranda, the first three menu sections, Lainnya) and a dark "Lainnya" sheet with every page.
- `main` is the scroll box. Keep pages free of negative-margin bleed (`-mx-*`), which turns into horizontal scroll.

Links that may cross the POS layout boundary use `NavLink` / `useNavigate` from `src/components/shared/nav-link.tsx`.

## Tokens

All tokens live in `src/app/globals.css`. The accent follows `--brand-primary`, so each tenant's brand colour from Appearance settings still applies.

| Class | Use |
|---|---|
| `bg-surface`, `bg-surface-2` | canvas, nested soft panel |
| `bg-card` + `shadow-card` + `rounded-card` | cards |
| `bg-ink`, `text-on-ink`, `text-on-ink-muted` | rail, hero card, active pill, tooltip |
| `bg-accent` + `text-accent-foreground` | the one highlight: a lime fill always carries forest text or icons |
| `bg-accent-strong` | the same lime behind small text (primary button, count badge) |
| `bg-accent-soft` | urgent tiles (lemon lime `#eeffb1`) |
| `text-forest`, `bg-forest`, `ring-forest` | accent marks on light surfaces: links, the title period, chart highlight bars, focus rings |
| `text-accent` | lime text or icons on ink only |
| `success`, `warning`, `info`, `danger` (+ `-soft`) | status tints; solid colour only on dots and bars |
| `text-muted-foreground` | secondary text |
| `text-body`, `text-silver` | paragraph text, timestamps and disabled marks |
| `shadow-float`, `shadow-glow`, `rounded-hero` | rail, dialogs, popovers; primary button; ink hero |

Naming differs from the skill in one place: shadcn's `muted` stays a background (`bg-muted`), so secondary text uses `text-muted-foreground`.

`globals.css` also maps the Tailwind `gray-*`, `slate-*`, `zinc-*` and `neutral-*` palettes onto the WIT neutral ladder, and `pink-*` onto a lime-to-forest scale (300 is lime, 700 is forest). Existing pages that spell those classes out follow the style without edits. Use the semantic tokens above in new code.

Contrast (WCAG 2.x, brand `#daff59`): forest on lime 14.0, lime on ink 15.5, `muted-foreground` on surface 4.75, `on-ink-muted` on ink 9.6, every status colour on its `-soft` tint 4.5 or more. Lime on beige measures 1.03, so lime never appears as text or an icon on a light surface; use `text-forest` there. When a tenant picks a different brand colour in Appearance, `pickForeground` chooses white, forest or black for text on it.

Logos live in `public/brand/` (dashboard and public pages) and `public/member-assets/brand/` (member portal, which only serves `/member-assets/`): `wordmark-black` on light, `wordmark-white` on ink, `mark-lime` for square slots on ink.

## Kit

| Component | File | Notes |
|---|---|---|
| `Button` | `ui/button.tsx` | pill; variants `default`/`primary` (lime with forest text), `ink`, `outline`, `secondary`/`soft`, `card`, `ghost`, `onInk`, `destructive`, `link` |
| `Card` | `ui/card.tsx` | variants `default`, `ink` (draws its own accent blob; never add a second), `accent` (the one urgent metric), `soft` |
| `Badge` | `ui/badge.tsx` | variants include `accent`, `ink`, `success`, `warning`, `info`, `muted` |
| `CountBadge` | `ui/count-badge.tsx` | nav and tab counters, hidden at 0, caps at 99+ |
| `StatCard`, `IconTile`, `Tone` | `ui/stat-card.tsx` | one tone union for tiles and stat cards; `href` makes the card a link |
| `PageHeader`, `Kicker` | `ui/page-header.tsx` | the page's `h1`, purpose sentence, actions that wrap on phones |
| `Tabs` | `ui/tabs.tsx` | `default` = pill tabs with an ink active pill; `line` = underline tabs with an accent underline |

The kit files carry their own types; there is no ambient declaration file. `Button` takes `asChild` to style a `<Link>` or `<a>` child as a button without nesting it in `<button>`. `Select` is generic over its value and defaults to `string`, so `onValueChange={setStatus}` type-checks.

Toasts come from `sonner` (`import { toast } from "sonner"`). The root layout mounts the only `<Toaster />`; pages never mount their own.

## Data access

- New server code (routes, server components, `src/lib/**`) writes SQL through `@/lib/db`: `query<Row>()`, `queryOne<Row>()` and `withTransaction(fn)`, with typed row interfaces and `$1` parameters. Run side effects outside the database (push, WhatsApp) through `afterCommit`.
- The PostgREST-style shim (`createPgClient` / `createServerPgClient` with `.from().select().eq()`) stays for existing routes only. Do not add new callers; convert a route to raw SQL when you rewrite it.
- Server-only modules (`@/lib/db`, `@/lib/pg/create-client`, `@/lib/iam/pg-client`, every `*-server.ts`) start with `import "server-only"`, so a client component that imports one fails the build. Keep pure helpers that the browser needs in a separate file without that import.
- Client components fetch through React Query hooks in the feature's `queries.ts` / `api.ts`, calling a dedicated API route. Never send SQL or table names from the browser.

## Rules

- One accent per screen region. When a region already has an accent card, make the next emphasis ink.
- No borders on cards, no gradient fills, no hex or rgb literals in class strings. Glows use `shadow-glow`.
- Every breakpoint-only grid starts with `grid-cols-1`; wrap `fr` tracks that hold truncating text in `minmax(0, …)`.
- One `h1` per page. Check new screens at 375 and 768 wide: `main.scrollWidth` must equal `main.clientWidth`.
