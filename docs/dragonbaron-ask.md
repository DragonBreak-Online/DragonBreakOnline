# /dragonbaron ask: install, enable and undo

`docs/dragonbaron-ask.md` · branch `feat/a1028-dragonbaron-ask` on `6d09ceb03` (origin/jake/dragonbaron-wip-20261028) · 28 Oct 2026

**What it is.** `/dragonbaron ask question:<text>` lets staff ask about the server. The answer is private (ephemeral). It reads a fixed list of server data and runs nothing. The build spec is `/root/dragonbreak-jake/dragonbaron-ai/SPEC.md`, Part A. The ask code is built and tested only. Nothing is deployed, nothing is registered and nothing is restarted.

**Jake's decisions (28 Oct), as built:**
- The AI is the local model, `qwen3.5:9b`, on the AI box (SPEC section 3).
- Staff only. The default roles are Owner, Dev, Lead GM and GM. An Owner can change them with `/dragonbaron config` (the `ask` node). Trial GM is not in by default (SPEC Q2).
- Read-only server data, private replies, and it never runs a command.
- Logging is metadata only: who, when, which sources, and the outcome. The question and the answer text are never written anywhere (not to the audit channel, not to the usage file, not to the backend log).
- No public notice.
- The held list: Owners only (see "Held staff reports" below).

## Files

New, under `skymp5-backend/`:

| File | What it does |
|---|---|
| `sources/discord/dragonbaronAsk.js` | The handler: checks, defer, answer, the reply, the audit line and the usage record |
| `sources/ai/aiSettings.js` | Reads the switch (every call) and the settings file (cached 60 s). Both fail closed |
| `sources/ai/localModel.js` | The Ollama client (probe, chat, one deadline) and the single-flight queue |
| `sources/ai/askRoute.js` | Routing by regex, with no model |
| `sources/ai/askSources.js` | The only data ask can read (a fixed list of readers) |
| `sources/ai/retrieve.js` | Server Rules and Staff Handbook chunks, and BM25 search |
| `sources/ai/askAnswer.js` | Template, model and excerpt answers, the prompt and the answer check |
| `sources/ai/outputScrub.js` | Cleans every line before it is shown |
| `sources/ai/rateLimit.js` | Per-user and site-wide limits, in memory |
| `sources/ai/askUsage.js` | The local usage record (metadata only) |
| `scripts/ask-eval.js` | The model eval (SPEC A13). Run it once the AI box is reachable |

Changed (small diffs on Jake's files): `dragonbaronCommand.js` (one dispatch line), `dragonbaronPermissions.js` (the `ask` node, `askTier`, `PANEL_EXEMPT`, `DRAGONBARON_PERMS_FILE` for tests, `_resetCache`), `dragonbaronUI.js` (one label), `scripts/dragonbaron-command.js` (the subcommand, plus `show`, `register`, `register --yes` and `register --from`).

There is no change to `bot.js` or `config.js`, and no new gateway intent.

## Runtime files (created at install, not by the code)

| Path | Mode | Contents |
|---|---|---|
| `/etc/dragonbreak/dragonbaron-ai` | 0644 root | The switch. Ship it as `ask=off model=off detect=off` |
| `/etc/dragonbreak/dragonbaron-ai.env` | 0644 root | The settings (SPEC 0.2). No secrets. The AI box URL goes here and nowhere in code |
| `/var/lib/dragonbreak/dragonbaron-ai/` | 0700 root | The folder for `ask-usage.jsonl` (0600, one line per ask, pruned to 90 days) |

The switch and the settings file are refused if they are not a regular file, are owned by a user other than root, or can be written by group or others. A refused switch means every key is off.

The settings file, as the spec writes it (put in the real URL from SPEC 0.2):

```
DRAGONBARON_AI_URL=<AI box URL, SPEC 0.2>
DRAGONBARON_AI_MODEL=qwen3.5:9b
DRAGONBARON_AI_NUM_CTX=16384
DRAGONBARON_AI_KEEP_ALIVE=-1
DRAGONBARON_AI_TIMEOUT_MS=60000
DRAGONBARON_AI_PROBE_MS=3000
DRAGONBARON_ASK_PER_MIN=3
DRAGONBARON_ASK_PER_HOUR=20
DRAGONBARON_ASK_SITE_PER_HOUR=60
```

Who may ask is never set in this file, and nothing in it turns question logging on. Such keys are ignored.

## Held staff reports (cross-part contract with the detector)

- File: `/opt/dragonbreak-tools/state/infraction-watch-held.jsonl`, written by `infraction-watch`. Owner root, mode 0600.
- One JSON object per line, `v` 1, with the fields of the 28 Oct contract (`at`, `guild`, `guild_id`, `channel`, `message_id`, `jump`, `author`, `staff_role`, `categories`, `rule_ids`, `reason`, `confidence`, `excerpt`).
- The detector prunes lines older than 30 days. Ask also shows nothing older than 30 days.
- **Who sees it:** only a viewer whose highest rank is Owner (the Owner role). The question must ask for held or staff reports (for example "show the held staff reports", "any staff hits this week?", "reports about GMs?").
- **Everyone else:** the source does not exist. The router never offers it, the reader returns nothing, the file is not even looked at, and the reply is the same as when there is no held file. The "what I can answer" list names it only to Owners.
- **The audit line never names it**, for anyone, because the audit channel is read by staff below Owner (rule 11.7).
- **What an Owner sees:** the newest 10 entries in one embed (an embed holds 4096 characters, so all 10 fit with an excerpt and a reason each). Each entry shows the time, the server and channel, the staff author and role, the category, the rule ids (only ids from SPEC 0.4), the confidence, and an `[open]` link. The link is built by code from the checked ids, after the scrub. A link whose server or message id does not match the entry is left out.
- **The entries never go to the model.**
- **Fail closed:** a missing file means "Nothing is held for the Owners." A file owned by another user, writable by group or others, not a regular file, or larger than 4 MB shows "not available". Lines that break the contract are skipped and counted ("N lines of the list could not be read").

## Install (needs approval; do not run anything before it)

These are the SPEC A14 steps, unchanged except where noted.

0. **Preconditions.**
   - A next-update post, approved by Jake or Nate.
   - Jake's decision on his WIP (SPEC Q1). Main must then be `6d09ceb03`, plus his test fixes, plus this branch.
   - Ship with the next planned backend restart (batch releases).
   - Check that claude-nate is not mid-release.
   - The route to the AI box is not needed, because ask ships with `model=off`.
1. **Claims.** `ops claim backend` and `ops claim github-main`. Push main with the claude-jake token, never printed.
2. **Drift check.** Re-hash the Dragonbaron and console files in `/opt/alduinak` against `git show 6d09ceb03:<file>`. `git -C /opt/alduinak status --short` must match the recorded list. If anything drifted, stop and ask Jake.
3. **Backup** to `/root/dragonbreak-jake/dragonbaron-ai/deploy/<UTC>/`:
   - `git -C /opt/alduinak diff > live.diff`
   - `git -C /opt/alduinak rev-parse HEAD > old-head`
   - a tar of the untracked Dragonbaron files.
4. **Fast-forward.** Use the path-limited `git stash push -u -m pre-ask-<UTC> -- <files>` from SPEC A14.4, then `git fetch` and `git merge --ff-only origin/main`. Keep the stash. Never use a `reset --hard` undo.
5. **Config.**
   - `install -m 0644 -o root -g root` the two files above, with the switch as `ask=off model=off detect=off`.
   - `install -d -m 700 /var/lib/dragonbreak/dragonbaron-ai`.
6. **Restart.** `systemctl restart dragonbreak-backend`, then check:
   - `/api/status` returns 200;
   - `[discord-bot] ready as Dragonbaron#5064`;
   - `[console] config: 8 pinned ids, 3 role ids`;
   - no `[dragonbaron` errors.
   - **Changed from the spec:** the line `[dragonbaron-ask] model: off, url set: yes, model qwen3.5:9b, num_ctx 16384` appears at the first `/dragonbaron ask`, not at the restart. The handler is loaded lazily (SPEC A1), so check it in step 8.
7. **Register.** Run the three `systemd-run ... scripts/dragonbaron-command.js` calls from SPEC A14.7:
   - `show --save <deploy dir>/dragonbaron-before.json`;
   - `register` (a dry run: read the plan);
   - `register --yes`.
   The `/dragonbaron` id must not change. If it does, the script exits 3 with a warning: re-allow the staff roles under Server Settings > Integrations.
8. **Smoke test.** Set the switch to `ask=on model=off`. As an Owner, ask:
   - "is the server up" (a template answer);
   - "what does D3 say" (excerpts);
   - "show the held staff reports" ("Nothing is held for the Owners." until the detector holds something).
   Then, as a Lead GM, ask "show the held staff reports". It must give an ordinary handbook answer that never mentions a held list. Check the audit lines: no question text, and no held source named.
9. **Ledger.** `ops log` with the undo below, then release the claims.
10. **Model on.** Set `model=on` only after the SPEC 3.3 steps 0-4 pass, including `node scripts/ask-eval.js` (A13 thresholds).

## Undo (fastest first)

1. Write `ask=off` in `/etc/dragonbreak/dragonbaron-ai`. This needs no restart and takes effect at the next ask. A missing or broken switch file also means off.
2. Put the old command back: `node scripts/dragonbaron-command.js register --from <deploy dir>/dragonbaron-before.json --yes`, under the same `systemd-run` wrapper as in step 7.
3. Put the old code back:
   - `git -C /opt/alduinak reset --keep <old-head>`
   - `git -C /opt/alduinak stash apply stash^{/pre-ask-<UTC>}`
   - `systemctl restart dragonbreak-backend`
   - revert this branch on main.
4. Optional cleanup: remove `/var/lib/dragonbreak/dragonbaron-ai/` (metadata only) and the two `/etc/dragonbreak/dragonbaron-ai*` files. The `ask` node in `data/dragonbaron-permissions.json` is harmless when unused, and `/dragonbaron config` can reset it.

## Things to know

- **Punishments for GMs.** `PUNISH_GM_ROLE_IDS` is not set (PROVEN in the spec), so a GM gets punish tier null. Ask then answers "Punishment records are not visible to your rank here." This is unchanged on purpose.
- **#bug-tracker.** The bug reader uses `DISCORD_ERROR_FORUM_CHANNEL_ID` when it is set, otherwise `1551740319974821949`. PROVEN on 28 Oct: the live value is that same forum. Threads tagged Exploit are never shown. If the forum has no Exploit tag, the live part refuses.
- **Version reader.** It asks `/api/version` on `127.0.0.1` at `process.env.PORT || 4000`, the same expression `server.js` listens on. There is no `config.port`.
- **Tests.**
  - Run: `cd skymp5-backend && TMPDIR=<build dir>/tmp systemd-run --scope -q -p MemoryMax=1G nice -n10 ionice -c3 node --test test/*.test.js`
  - On `6d09ceb03` the suite has 8 known failures: consolePunish 3, consoleStaff 2, punishActions 1, punishSend 2. This branch adds 86 tests, all passing, and leaves those 8 exactly as they were.
