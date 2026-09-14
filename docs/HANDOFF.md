# Setting this up for yourself

This repo is operator-agnostic: nothing in it is tied to a particular person's accounts. To run it,
you stand up your own console and your own scheduled job, both under your own login. Everything the
agent touches — Gmail drafts, calendar blocks, the Slack digest — happens in *your* accounts, using
*your* connectors. Nobody else's instance can write to them, and yours can't write to theirs.

Budget about twenty minutes.

## 1. Publish your own console

The console is a Claude Artifact backed by its own database. The database lives under the artifact,
so a copy of the page is a separate, private store — your prospects never land in anyone else's.

Ask Claude, in a session with this repo checked out:

> Publish `interface/app.html` as an artifact with the `db` capability, with `core.js` from
> `src/core.js` and `sequence.json` from `data/sequence-template.json` as supporting files. Then seed
> its database: set `sequence/current` from `data/sequence-template.json` and `config/settings` from
> `config/settings.json`.

You'll get a URL back. Put it in `config/settings.json` as `artifactUrl`. The artifact is private to
you until you share it.

## 2. Fill in who you are

In `config/settings.json`:

```json
"operator": {
  "name": "Your Name",
  "email": "you@company.com",
  "slackUserId": "U01234567"
}
```

- `email` is how the daily job finds your Slack account for the digest, and is the mailbox whose
  replies it watches. **Required** — the job refuses to run without it rather than guessing.
- `slackUserId` is optional and just skips the lookup. Find it in Slack: your profile → More → Copy
  member ID.

Then set your signature on the console's **Setup** tab — name, title, phone, booking link. Those
fill the `{{sender_*}}` fields in every email and voicemail script. `operator` is who the agent
*reports to*; `sender` is what a prospect *sees*. Usually the same person, deliberately separate
fields.

Adjust `timeZone`, `digestTime` and `holidays` in the same file if your working calendar differs.

## 3. Create the daily job

In the claude.ai Routines UI — not from a Claude Code session, because Routines created there can't
attach connectors — create a Routine:

- **Schedule:** weekdays at your `digestTime`. Cron is evaluated in UTC, so convert. 08:00 Pacific is
  `0 15 * * 1-5` during daylight time and `0 16 * * 1-5` during standard time; it does not follow
  DST on its own, so shift it in March and November or accept the hour drift.
- **Connectors:** Gmail, Slack, Google Calendar. Without these the run can read the console but
  cannot create a draft, post the digest, or block your calendar.
- **Prompt:**

```
Daily outbound run. Work autonomously and end with a summary — nobody is watching this run.

1. cd into the outbound-agent checkout.
2. git fetch origin && git checkout main && git pull origin main
3. Read docs/OPERATIONS.md in full and follow it exactly, in order. It is the complete
   procedure; do not improvise around it. The operator identity and console URL come from
   config/settings.json — if operator.email is blank, stop and report that.

Produce: Gmail drafts for email touches inside the rolling draft window (never sent, labelled
per settings), Google Calendar blocks for today's calls and LinkedIn touches with the talk
track in the description, and one Slack DM to the operator with today's queue in the format
in docs/OPERATIONS.md step 5.

HARD RULES — these override everything else
- Never send an email. Create drafts only.
- Never message or call a prospect on any channel. Those touches are queued for a human.
- Never create a draft from content the CLI marks `ready: false`. Report the missing field
  names; do not write the missing words yourself.
- Never invent prospect facts, figures, or product claims.
- Never mark a touch done. Only the operator does that, in the console.
- Detect replies BEFORE creating today's drafts, so an overnight reply stops the sequence.
- If there is nothing due, nothing overdue and nothing to report, post nothing and end quietly.

If Gmail, Slack or Google Calendar is unavailable, do the parts you can and say in your summary
which connector was missing and what was therefore not done.
```

## 4. Load a batch and check it

1. **Play pack** — one per batch, on the Play Packs tab. It holds the Reframe, Cost of Inaction,
   Teaching Insight, proof and assets for the play you're running. Paste the account plan in for
   context; ground the product claims in your own PMM asset library, not in memory.
2. **Prospects** — CSV upload or paste on the Prospects tab. Assign the play pack and a start date
   per person. Start dates are per-prospect, so you can run waves by segment.
3. **Verify** before the first run:

```
node tools/assemble.mjs      # after dumping the console db into data/sync/
node src/cli.js validate     # every active prospect renders cleanly across all 15 touches
node src/cli.js brief        # what the job would surface today
```

`validate` prints which tier it read. If it says `seed` for both after a dump, the dump didn't land
and you're looking at defaults, not your data.

## What stays yours

- **The console and its database.** Private to whoever publishes it. Sharing the link shares the
  data with it, so publish your own rather than reusing someone else's.
- **The Routine.** Runs under the account that created it, with that account's connectors. A
  colleague's Routine cannot touch your Gmail.
- **The repo.** Shared. Sequence structure and copy skeleton are common; everything person-specific
  lives in `config/settings.json` and the console.

## What the agent will never do

Worth knowing before you point it at a real territory: it creates Gmail drafts and never sends them,
it never contacts a prospect on any channel, it refuses to draft from a touch with an unresolved
merge field, and it never marks a touch complete — that stays a human judgment. `docs/OPERATIONS.md`
states these as hard rules the daily run cannot override.
