# Public site, trial funnel, memberships, shop and wholesale

Design approved on 2026-10-07. Source: the gap list from comparing NüHabit
with "The Yard Gym, System Analysis Brief" (6 Oct 2026).

## Decisions

- SEO (metadata, sitemap, JSON-LD) is out of scope for this round.
- NüHabit runs its own branches in Indonesia; IDR only. The franchise form
  is a CRM lead form, wholesale is a B2B portal for partner gyms and
  resellers, and the region switcher becomes a branch switcher.
- Membership products: the existing credit packs plus paid-in-full passes
  (unlimited booking for a number of days). No weekly-billed contracts.
- Public checkout identifies the buyer by phone and WhatsApp OTP, or by
  Google sign-in. No Apple sign-in.
- Content pages are fixed; staff edit their copy and images. Articles and
  public events get a simple editor. No block page builder.
- The Expo app stays untouched; no store links.

## Approach

One new Go module `site` owns public content, branch public profiles,
articles, public events, the trial lead and the analytics settings. The
gym, shop, CRM and member-portal modules take the behaviour that belongs
to them. Every route runs in Go behind the Next proxy, as the rest of the
API does.

## Public site

A `(site)` route group with its own shell: a two-tier header, a cart
badge, "Coba Gratis" and "Buka Cabang" CTAs, four slide-over panels
(timetable, trial, membership, cart) with focus trap and Esc, and a footer
with a branch switcher, social links and the partner-portal link.

Routes: `/` (home for visitors; signed-in staff keep the desktop),
`/training`, `/space`, `/brand`, `/locations`, `/locations/[slug]`,
`/news`, `/news/[slug]`, `/events/[slug]`, `/join`, `/apparel` (the
default shop), `/franchise`, `/equipment`, `/contact`, `/wholesale`,
`/privacy`, `/terms`. Careers stays at `/career`. Mobile first, brand
tokens (lime fill with forest text).

## Branches

`configuration.branches` gains a public profile: slug, lat and lng, phone,
email, Instagram, directions, hero image, benefits, accordions (facilities,
parking, team, community), extras, testimonials and `is_public`, edited in
the existing branch settings. `/locations` sorts by distance after an
explicit "Gunakan lokasi saya" tap (haversine; no prompt on load), searches
name, city and postcode, and draws pins with OpenLayers on OSM tiles, which
the repo already uses.

## Timetable

`GET /api/public/site/branches/{slug}/sessions?week=` reads published
sessions from gymscheduling: day, time, duration, class type, coach and
seats left. The panel has week navigation and day tabs. Each session links
to `/member/classes/[id]`, so booking is one login away.

## Trial funnel

A dedicated form: branch, name, email, phone with a country-code picker
(E.164), email and SMS consent. `POST /api/public/site/trial` creates a
CRM lead with the new source `website` (the check constraint widens; TS
and Go mappings follow), stores each consent in `crm.lead_consents`
(timestamp, IP hash, user agent, consent text version), records UTMs and
the source page, and raises `lead.created`. Rate limited per IP.

## Membership

Packages get a `kind`: `credits` (today) or `pass`. A pass grants unlimited
bookings for `validity_days` from activation, recorded in
`gym.member_passes`; booking and check-in skip the credit deduction while
a pass is active. `gym.package_branch_prices` overrides the price per
branch. `/join` lists the branch's plans, identifies the buyer (phone and
OTP, creating the member on first purchase, or Google sign-in matched by
verified email; a new buyer still gives a phone), pays through the existing
Xendit invoice flow and lands on a status page. Seeded passes: 4 weeks,
8 weeks, 6 months and a 1-week holiday pass.

## Shop

Storefront grouped by collection (product category), Buy Now on the
product sheet, size change inside the cart, and `preorder_until`, which
allows checkout at zero stock with a label and the expected date.

## Wholesale

`/wholesale`: partner accounts in `shop.wholesale_accounts` (email and
password, created by staff in the dashboard) with a price tier (percent
off) and payment terms (Xendit invoice or pay later). Partners see
wholesale prices and minimum quantities, place orders and see their order
history. Orders carry the account id.

## Lead forms

Franchise (18 fields), equipment and contact are seeded as CRM forms, so
the form builder, UTM capture, honeypot and rate limits apply; each gets a
fixed route that renders it. Careers already exists.

## Content

A "Situs" area in the dashboard edits home (hero video, partner logo,
pillars, mission quote, community reel), training (class types, phases,
laws), space, brand story, social links and the legal pages (markdown).
Articles (`site.articles`: slug, category, cover, markdown body,
published_at) with a category filter on `/news`. Public events
(`site.events`) with an optional embedded CRM form. Member-only events and
challenges stay in CRM.

## Analytics

GTM container id and Meta Pixel id live in site settings; the site layout
injects them when set. dataLayer events: `trial_open`, `studio_select`,
`lead_submit`, `plan_select`, `add_to_cart`, `checkout_start`, `buy_now`.

## Delivery

Six waves, each committed and tested on its own:

1. Branch profile, `site` module, shell and content pages.
2. Timetable and trial funnel.
3. Passes and `/join` with Google sign-in.
4. Shop and wholesale.
5. Lead forms, articles, events.
6. Analytics and a browser pass over every public page.

Go integration tests per module, Vitest for the site components, the route
manifest regenerated so the proxy forwards the new prefixes.
