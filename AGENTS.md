# GAME DEVELOPMENT AGENT CONSTITUTION

You are working on a commercial multiplayer casual game designed primarily for messenger Mini Apps.

The target launch order is:

Bale → Eitaa → Telegram.

The project's primary business objective is to build a profitable, highly-retentive game. Feature count is not a goal.

## PRODUCT PRINCIPLES

The game must be:

- understandable within seconds;
- mobile-first;
- visually polished;
- fast to load;
- easy to play with one hand;
- suitable for short sessions;
- socially competitive;
- inexpensive to extend with new content;
- server-authoritative wherever economy, progression or competitive results are involved.

The intended emotional loop is:

PLAY → COMPETE → RESULT → REWARD → PROGRESS → REVENGE/RANK → PLAY AGAIN.

Do not add systems merely because they are common in games.

Every proposed feature must answer:

1. Which player problem does it solve?
2. Which metric should it improve?
3. Why is it needed now?
4. What is the smallest implementation that validates it?

If those questions cannot be answered, do not implement the feature.

## DEVELOPMENT PRIORITY

Priority order:

1. Core gameplay
2. Game feel
3. First-session experience
4. Retention
5. Social loop
6. Monetization
7. Content expansion

Never sacrifice core-game quality to increase feature count.

## TECH STACK

Primary client:

- TypeScript
- Phaser 4
- WebGL/Canvas fallback where appropriate
- mobile-first responsive shell

Art production:

- Blender
- Blender Python where automation is useful
- rendered 2.5D sprites
- PNG master assets
- optimized runtime WebP/texture atlases

Backend:

- TypeScript
- Node.js
- modular monolith
- PostgreSQL

Redis should not be introduced until a measurable technical requirement justifies it.

Avoid microservices.

## PLATFORM ARCHITECTURE

Game logic must never be tightly coupled to Bale, Eitaa or Telegram.

Use a PlatformAdapter abstraction.

Platform-specific functionality should live behind adapters for:

- authentication;
- initData handling;
- user information;
- theming;
- back button;
- fullscreen;
- haptics;
- share/invite;
- payments;
- opening external links;
- lifecycle events.

Implement:

BalePlatformAdapter
EitaaPlatformAdapter
TelegramPlatformAdapter
BrowserPlatformAdapter

Game code should consume the shared interface instead of checking platform names throughout the codebase.

## SECURITY

Treat the client as untrusted.

Never trust:

- currency values;
- inventory;
- timestamps;
- match results;
- rewards;
- player identity;
- premium entitlement;
- purchase status;
- upgrade cost calculated by the client.

Validate platform init data on the backend.

Important competitive and economic actions must be server-authoritative.

Use idempotency for operations that may be retried.

Do not allow duplicate:

- rewards;
- purchases;
- chest claims;
- match settlements;
- upgrades.

All premium/economy changes must be auditable.

## ECONOMY

Maintain an append-only or auditable economy ledger.

Every economy mutation should include:

- player;
- currency;
- amount;
- reason;
- source;
- previous balance;
- resulting balance;
- timestamp.

Do not introduce unnecessary currencies.

Initial economy should remain simple:

Coins = earned progression currency.

Gems/premium currency = premium/convenience/cosmetic currency.

Do not invent additional currencies without explicit approval.

## MULTIPLAYER

The initial multiplayer model is asynchronous competitive PvP.

Do not introduce real-time networking unless explicitly requested after the core product is validated.

Battle simulations should be reproducible/deterministic where practical.

Persist enough information to audit and replay important matches.

The client should display the result produced by the authoritative game system rather than independently deciding settlement.

## VISUAL QUALITY

Visual quality is a product requirement, not optional polish.

Never accept visually mediocre UI simply because functionality works.

Maintain a coherent Art Bible covering:

- camera;
- projection;
- lighting;
- shadows;
- palette;
- materials;
- proportions;
- line weight;
- icon language;
- typography;
- VFX;
- animation;
- UI geometry.

Do not mix incompatible visual styles.

AI-generated assets must be evaluated for consistency before use.

## BLENDER PIPELINE

Blender should primarily produce 2.5D source assets.

Prefer one controlled scene setup with:

- fixed orthographic camera;
- fixed lighting rig;
- fixed world settings;
- controlled material palette;
- standardized object scale;
- standardized render resolution.

Automate repetitive exports using Blender Python when beneficial.

Runtime assets should be optimized separately from source assets.

Never ship large Blender source assets to clients.

## GAME FEEL

Important actions should provide proportional feedback using combinations of:

- animation;
- squash/stretch;
- particles;
- sound;
- haptics;
- number animation;
- camera feedback;
- highlights;
- progress feedback.

Do not overuse camera shake or particles.

Feedback must improve readability rather than create noise.

## PERFORMANCE

Assume many users run low-end Android devices inside WebViews.

Performance is a requirement.

Monitor:

- startup time;
- bundle size;
- texture memory;
- draw calls;
- FPS;
- memory usage;
- long frames.

Provide reduced-effects behavior for weak devices when appropriate.

Do not add visually expensive effects without measuring their cost.

Prefer texture atlases and optimized assets.

Lazy-load content not required for the first playable screen.

## UX

The player should reach meaningful gameplay as quickly as possible.

Avoid:

- long tutorials;
- walls of text;
- unnecessary account setup;
- excessive menus;
- premature permission prompts.

Teach through interaction whenever possible.

Primary buttons and interactive elements must be comfortable on mobile screens.

Support common small-screen dimensions.

## ANALYTICS

No major user-facing flow is considered finished without required analytics.

Important events include:

- app/session start;
- tutorial progression;
- match start/end/quit;
- rewards;
- upgrades;
- progression milestones;
- shop and offer views;
- checkout;
- purchase success/failure;
- referral actions;
- revenge actions;
- daily/season actions.

Analytics event names and schemas must remain consistent.

Never silently rename production analytics events.

## REMOTE CONFIG

Values likely to require balancing should not be buried throughout application code.

Prefer structured config for:

- rewards;
- upgrade costs;
- progression;
- matchmaking thresholds;
- offers;
- event multipliers;
- timers.

Do not make everything configurable. Keep configuration focused on values reasonably expected to change.

## MONETIZATION

Monetization must be designed around player value, not frustration.

Initial monetization focuses on:

- starter pack;
- premium currency;
- season/pass system;
- cosmetics;
- limited/event offers;
- reasonable convenience.

Do not create aggressive pay-to-win mechanics.

Do not introduce deceptive purchase flows or dark patterns.

Payment completion must always be verified server-side.

## CODE QUALITY

Before editing:

1. Read relevant project documentation.
2. Inspect existing implementation.
3. Identify the smallest set of files that should change.
4. State the intended approach.
5. Identify meaningful risks.

Do not rewrite working architecture without justification.

Prefer:

- explicit types;
- small modules;
- understandable names;
- predictable data flows;
- schema validation;
- reusable domain logic.

Avoid:

- giant components;
- giant services;
- hidden global state;
- duplicated business logic;
- speculative abstractions;
- premature optimization;
- unnecessary dependencies.

## DATABASE

Use explicit migrations.

Never modify production schema manually.

Important writes involving economy, purchases or match settlement should be transactional.

Consider concurrency and duplicate requests.

## TESTING

Important domain logic must have automated tests.

At minimum test:

- economy calculations;
- upgrades;
- reward claims;
- match settlement;
- purchases;
- auth validation;
- idempotency;
- invalid input.

When bugs involve a reproducible rule, add a regression test whenever practical.

## GAME SIMULATION

For systems involving probabilities, matchmaking, progression or combat, prefer simulation over intuition.

Write scripts capable of simulating many players/matches when balancing needs it.

Use simulation to discover:

- impossible progression;
- runaway economies;
- dominant strategies;
- matchmaking problems;
- reward inflation.

## TASK DISCIPLINE

Work on one explicitly defined task at a time.

Do not opportunistically add unrelated features.

If an unrelated problem is discovered:

- report it;
- record it;
- do not broaden current scope unless it blocks the task.

## DEFINITION OF DONE

A task is not complete merely because the code compiles.

Before reporting completion:

- implementation works;
- type checking passes;
- relevant tests pass;
- build passes;
- error paths are handled;
- mobile behavior is considered;
- analytics are included where relevant;
- security implications are reviewed;
- visual result is checked when UI is involved;
- no obvious regression was introduced.

When appropriate, commit the validated work to the current branch and push it to the configured remote.

Report:

- what changed;
- files/modules affected;
- validation performed;
- tests run;
- known limitations;
- commit hash/message;
- push status.

## DECISION RULE

When uncertain between:

A) adding more systems

and

B) improving the quality, clarity, responsiveness, game feel or retention of an existing important system,

prefer B unless product direction explicitly requires otherwise.

The project is a commercial game.

Optimize for players returning and eventually paying — not for the repository looking technically impressive.
