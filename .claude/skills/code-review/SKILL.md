---
name: code-review
description: How code is reviewed in Vavilov Explorer and what is done with the findings. Use it only when the owner asks for a review, of a commit, a range of commits, a feature or a module. The session sends one code-reviewer subagent per category, each with a fresh context, evaluates every finding, fixes the ones that hold, and reports to the owner.
---

# Code review

A review is made when the owner asks for one, not after every change: the
windows are tried and changed freely while they take shape, and a review
of a window that will change tomorrow is spent on code that will not
last. The owner asks when a feature has settled, before a release, or
when something feels wrong.

The writer of a piece of code cannot review it, for the same reason the
writer of a text cannot: they know what it was meant to do and read that
into it. So the review is done by subagents that start with nothing but
the code, the design and the `coding` skill, one for each category, and
the session the owner asked is the orchestrator: it sends them out, and
then it acts on what they find. This is popnei's and popnei_web's
`code-review` skill, for a project without specs or plans.

## Before sending the reviewers

1. **Fix the scope**: the commits, or the feature or module the owner
   named, and from it the files and the functions in scope. The review is
   of those, and of what calls them and is called by them. A defect seen
   elsewhere goes at the end of a report as seen outside the scope,
   unless it loses the user's data, shows a wrong state or crashes the
   app, and then it is a finding like any other.
2. **Write what the change was meant to do.** There is no spec, so the
   reviewers get it from the session: the decisions of `docs/design.md`
   the change rests on, and what the owner decided in chat that the code
   implements, in a few lines. A reviewer needs it to tell a defect from a
   decision.
3. **Run the checks** of the `coding` skill once and keep their output. A
   reviewer does not spend its time finding what clippy or ESLint prints.
4. **For a change to a window**, take the screenshots of its states
   (`testing.md`, "Seeing the windows") and give their paths.
5. **Note what the reviewers cannot know from the code**: a choice the
   owner made on purpose, a window that is deliberately unfinished, a
   measurement that justified something odd. Most wrong findings come
   from missing context.

## The categories

Each is described in `categories.md`, beside this file. Send every one
that applies, in parallel, in one message.

| category | applies when |
|---|---|
| `intent` | always: the code against what was agreed |
| `tests` | always: whether each test can fail, and the numbers the change claims |
| `errors` | always: panics, errors dropped or turned into defaults, what the user is told |
| `state` | the change touches the shared state, a command, a message, a revision or the copy a window keeps |
| `numbers` | the change has integer or float arithmetic, casts, indices, or values read from a file |
| `api` | the change adds or alters types, names, defaults or doc comments |
| `frontend` | the change touches a window, a view, a controller, a plot or a point view |
| `security` | the change touches the capabilities, the CSP, a command's arguments, a file read or written, or text from the user's files |
| `accessibility` | the change touches what the user sees or operates |
| `platform` | the change touches the windows, input, files, or uses a web feature new to the code |
| `ux` | only when the owner asks for it |

When in doubt, send it. A reviewer with nothing to report costs little.

The subagent is `code-reviewer`. Its prompt gives the category, the
commits or files in scope, what the change was meant to do, the output of
the checks, the paths of the screenshots, and the context of step 5.

`intent`, `tests`, `accessibility` and `platform` run the code, the tests
or the windows, so they are sent with `isolation: "worktree"`, each in its
own tree, because two agents that build or edit one checkout overwrite
each other. A worktree starts on `main`: the prompt gives the commit and
tells the reviewer to check it out and confirm it with `git rev-parse
HEAD`, and to run `npm ci`, before anything else, and gives each one its
own `E2E_PORT` for the harness, 1431, 1432 and on. The other categories
only read, and share the checkout.

## Acting on the findings

When the reports are in, the orchestrator acts on them; it does not hand
the owner a list.

A finding is to be taken very seriously. The reviewer read the code
without knowing what it was meant to do, which is how its next maintainer
will read it, and often it ran the case. It is not set aside because it
is inconvenient or because the writer remembers meaning something else.

A finding is not the law either: a reviewer lacks context, misreads a
line, assumes an input that cannot occur, or suggests a fix worse than
another. So each finding is evaluated on its evidence:

1. **Check it yourself.** Open the line, run the case, drive the window,
   look at the screenshot.
2. **Decide what it is:**
   - It holds, and the fix changes nothing the user sees: fix it. For a
     bug, a test that fails first, then the fix (`CLAUDE.md`). The
     suggested fix is a suggestion.
   - It holds, and the fix changes what the user sees or does: it goes to
     the owner as a question with a recommendation, not into the code
     (`CLAUDE.md`: ask before any change to the UI).
   - It holds, and does not belong in this review: a GitHub issue, written
     as the `writing` skill says, so that it is not lost.
   - It does not hold. Say why, with what was checked and what the
     reviewer did not have. A reason is one the reviewer would accept if
     it saw it.
3. **A serious finding that can be neither confirmed nor refuted** goes
   back to the reviewer with the missing context, or to the owner. A
   finding about lost data, a crash or a wrong state is never closed as
   not holding on a doubt.

Fix one finding at a time, with the smallest change that settles it. A
fix that fails its checks is reverted whole. When all are handled, run
the checks again, all of them, and take the screenshots again when a fix
changed a window. Two reviewers reporting the same thing from different
sides is evidence, not repetition: handle it once and count it as more
certain.

When a finding shows that the `coding` skill allowed the defect, the rule
goes into the file of the skill it belongs to, so that the next writer
knows it before the next reviewer.

## What the owner gets

A reply in chat, as the `writing` skill describes replies: what was
reviewed, what was found that mattered and is now fixed, each finding not
taken with its reason in a line, the questions that are the owner's with
a recommendation each, and what became an issue. A finding is said in
what it does to a user, "a lasso in the map loses its first press on
macOS", not in the name of a rule. No report is saved; the commit message
of a fix carries its why, and the issues carry what is left. Nothing is
committed until the owner asks.
