# Daily job runbook

The scheduled Routine fires a fresh Claude session every weekday at 08:00 America/Los_Angeles.
That session has no memory of this build, so this file is the whole procedure. Follow it in order.

**Console (source of truth):** https://claude.ai/code/artifact/bb71ad46-4511-4122-bb3d-58cfc69e9d7f

## Hard rules

These are not negotiable and override anything else in this file.

1. **Never send an email.** Only `create_draft`. If a tool call would send, stop and report instead.
2. **Never contact a prospect on any channel.** LinkedIn messages and calls are queued for Caitlin to
   perform by hand — the job only tells her what to say.
3. **Never create a draft from content that is not `ready`.** `node src/cli.js drafts` marks each
   touch `ready: true/false`. A `false` means a merge field is unresolved or a LinkedIn message is
   over its limit. Report it; do not improvise the missing words.
4. **Never invent prospect facts, numbers, or Qumulo claims.** Everything comes from the console's
   play packs, the account plan, and the PMM Enablement Assets folder on Drive.
5. **Never mark a touch done.** Only Caitlin does that, in the console. The job creates drafts and
   queues work; she records what actually happened.

## Procedure

### 1. Pull the live state

```
node tools/assemble.mjs --dry-run   # confirm the working tree is clean first
```

Dump the console's database into `data/sync/`, one directory per collection, using the Artifact tool:

- `action: read_db`, `db_op: list`, `collection: prospects`, `out_dir: data/sync`
- same for `playpacks`, and `db_op: get` for `sequence/current` and `config/settings`

Then assemble and verify:

```
node tools/assemble.mjs
node src/cli.js validate
```

`validate` lists every active prospect whose 15 touches do not render cleanly. Those prospects are
reportable problems, not blockers for the rest — carry on with everyone who does render.

### 2. Detect replies before doing anything else

Order matters: a reply that arrived overnight must stop the sequence *before* today's drafts are made.

For each **active** prospect with an email address, search Gmail for inbound mail from them:

```
search_threads: from:<their email> newer_than:30d
```

A hit counts as a real reply **unless** the subject or the opening lines match an auto-responder hint
in `config/settings.json` (`out of office`, `automatic reply`, `undeliverable`, and the rest). Bounce
notifications (`mailer-daemon`, `delivery status notification`) mean status `bounced`, not `replied`.

For each real reply:

1. Set that prospect's status to `replied` in the console database:
   `action: write_db`, `db_op: update`, `collection: prospects`, `doc_id: <their id>`,
   `data: {status: "replied", statusChangedAt: "<today>"}`, pinned with the `if_version` you read.
2. Trash their unsent drafts: `list_drafts`, match on recipient, `trash_message` on each.
3. Record it for the digest.

Auto-responders and bounces are reported but never silently dropped.

### 3. Create the rolling Gmail drafts

```
node src/cli.js drafts
```

This returns only email touches falling within `draftLeadDays` (3) — a rolling window, so Drafts never
fills with a month of mail. For each entry where `ready` is `true`:

- Check `list_drafts` first. If a draft with the same recipient and subject already exists, skip it —
  the job must be safe to run twice in one day.
- `create_draft` with `to`, `subject`, `body`.
- Apply the `Outbound Agent` label (`list_labels`; `create_label` if it does not exist yet).

For each entry where `ready` is `false`, create nothing and list it in the digest under
"needs your words" with the exact missing field names.

### 4. Put calls and LinkedIn touches on the calendar

For every `call` and `linkedin` touch due today (from `node src/cli.js brief --json`):

- Create a Google Calendar event on today's date, 30 minutes, titled
  `Call: <First> <Last> — <Company>` or `LinkedIn: <First> <Last> — <Company>`.
- Put the rendered talk track in the description: opener, reframe, the three discovery questions,
  the objection handles, the voicemail script, and what you're going for. For LinkedIn, the message
  text and its character count.
- Check for an existing event with the same title on the same day first; do not double-book.

### 5. Post the digest to Slack

Resolve the destination first: `slack_search_users` for `cbercha@qumulo.com` to get Caitlin's user,
then send her a direct message. Do not post the digest into a shared channel — this is her work queue,
not a team update.

One direct message, in this shape. Keep it scannable; she reads it on a phone.

```
Outbound — <Day, DD Mon>

OVERDUE (n)
 • <Name> @ <Company> — <touch name> — <n>d late
DUE TODAY (n)
 CALLS (n)
 • <Name> @ <Company> — <one-line reframe>
 LINKEDIN (n)
 • <Name> @ <Company> — <action>
 EMAIL (n)
 • <Name> @ <Company> — draft ready in Gmail: "<subject>"

Replied overnight — sequence stopped (n)
 • <Name> @ <Company>
Needs your words (n)
 • <Name> @ <Company> — <touch> is missing <fields>

<console link>
```

If there is nothing due, nothing overdue, and nothing to report, **post nothing and end the run.**
A daily message that says "nothing to do" trains her to ignore the channel.

### 6. Report what changed

End the run with a short summary: drafts created, replies detected, events created, problems found.

## Safe to re-run

Every step checks before it writes: drafts are matched on recipient and subject, calendar events on
title and date, and status updates are pinned with `if_version`. Running the job twice in one day
produces no duplicates.

## When something looks wrong

Stop and report rather than guessing. Specifically:

- A prospect's dates look wrong → do not hand-correct them. `node src/cli.js schedule <id>` prints
  the computed schedule with any weekend or collision shifts explained.
- The play pack is missing fields → report the field names; never write the copy yourself.
- A Gmail or Slack call fails → report the failure and continue with the other steps.
