---
name: writing
description: How prose is written in Vavilov Explorer. Use it before writing or revising anything a person will read, a document under docs/, a skill, a doc comment, a commit message, a GitHub issue, and the text the app shows its users, its labels, messages and errors. Chat replies follow the same principles.
---

# Writing

This is the writing skill of popnei (`/Users/jose/devel/popnei/.claude/skills/writing/SKILL.md`),
with the readers and the forms of Vavilov Explorer. Its principles were
tested there, on the cases under `cases/` beside that file.

## The readers

What is written here is read by one of three people.

The first is the owner, a population geneticist who programs in Python
and Rust. They know the biology, the data and the decisions in `docs/`.
They have written web applications with the assistant but are not a web
or desktop developer: a word of the web or of Tauri, a webview, the DOM, a
render, IPC, a channel, a capability, a WebGL context, a focus ring, is a
name they do not have until the text says what it does in this app. A
problem is written as what a user would see or be unable to do: "a lasso
started in the map window loses its first press on macOS" tells the owner
what is wrong; "acceptFirstMouse is false" does not.

The owner was not in the session: they did not see the files opened, the
commands run, or the names that came up along the way. So a text starts
with a sentence or two of context: what was being worked on and what the
question was.

The second reader arrives later, a contributor or another session of the
assistant, who has only the page.

The third is a user of the app, a biologist who knows their data and may
not program. They read the app's text in the middle of their work, to
decide what to do next ("The text of the app", below).

The owner and the second reader read in order to do something: to decide,
to build, or to check. A text is good when its reader gets through it
once, without asking a question and without opening anything else, and
can then do what they came to do.

`docs/design.md` is the voice to match: facts and numbers, each
measurement with what it was measured on, headings that name their
subject, almost no bold, and no sentence about the text itself.

## Before writing: the sketch

The order of a text is decided before its sentences. A text whose order is
found while writing uses its terms before it defines them and gives its
reasons before its subject. So write a sketch first, a few lines that are
not part of the text:

1. The subject in one sentence, with each option or thing named by what it
   is: "whether the 2D plots are drawn with D3 in SVG or on a canvas".
2. What the reader should know or be able to do when they finish, in the
   words you would use with a colleague across the table. When that cannot
   be said yet, the problem is in the thinking and no sentence will fix it.
3. The terms the text will need, each with its definition, in the order
   they will be used.
4. The points, one line each, in the order the reader needs them. A point
   that leans on another comes after it.
5. What is left out, and where it goes.

Then write from the sketch. The opening of the text is the first two lines
of the sketch, in full sentences. When the text is written, find the first
use of each term in line 3 and check that its definition comes before it.

## The principles

### Write the contents, not the name of the category

"The module holds the selection logic" gives the reader nothing. "The
module holds the selection as one bit per individual, the commands that
set, add to and clear it, and the revision of each change" does. Logic,
machinery, infrastructure, handling, semantics are names of bags. Write
what is in the bag. When the list cannot be written, the thing is not yet
understood.

A problem is written as what can go wrong, not as the rule it breaks: "two
windows would each keep their own selection, and a lasso in one would not
show in the other" says what happens; "it breaks the single source of
truth" does not.

An adjective in the place of a number is the same fault: fast, large,
negligible, most. Put the fact in: "a change reaches the other window in 1
to 3 ms at the median on the owner's Mac". Taking the adjective out and
leaving the rest leaves a sentence that still says nothing.

### A number comes with what it was measured on

The data, the machine, the build (debug or release), the program, and the
date when the measurement is not from the work being reported. The date
is the one the session was told, not one worked out from other dates. A
comparison has both sides in the same units, and says which side is
better when the reader could doubt it.

A trade-off gives up one kind of thing to get another, and each kind is
named, with each option's value in both: "Drawing in SVG keeps every bar
an element the tests can count; a canvas would draw 50,000 points where
SVG cannot, but the histogram has 30 bars." A word keeps one meaning
through a sentence.

### Context before the name

A term that does work in a sentence is explained before that sentence or
inside it. The reader lacks four kinds of names:

- Labels made up during the session: step numbers, the nickname of a
  script, "the spike". Say what the thing is.
- Names from the code. That a type is called `Session` does not make it a
  word the reader has. Say what it is, then use the name.
- Ordinary words that mean something narrower here: a classification, a
  population, the selection, the hover (`docs/design.md`, section 1).
- Notation and abbreviations, a label in a table included.

One name for each thing, and the name `docs/design.md` gives it. Before a
new name is added, count the ones already used for the same thing.

### What the reader came for goes first

In a document, what it is about and what it decides. In a section, what
the thing does, in words, before the type or the signature. In a reply,
the answer to the question that was asked. The work happened in the
opposite order, and the temptation is to tell it in that order.

### Only what the reader can use

For each sentence, what can the reader do with it? These go out: the story
of how the work went; sentences about the text ("briefly", "this section
describes"); sentences about the reader's reaction ("notably",
"surprisingly"); answers to an objection nobody raised; sentences that only
give a verdict ("there is a catch") and leave the fact to the next one.
The test is to delete the clause: when no fact is lost, it stays deleted.

Two things stay although they look like the story of the work: a trap the
next person would fall into, and a measurement that closed an option.

### Everything at its true strength

A choice is written as a choice, with the goals it serves and what would
have to be true for another option to win, not as "forced" or "the only
way". What was measured is kept apart from what was assumed or read
somewhere: "that has not been measured here". A claim that holds only in
part is given with its condition, "on macOS", "with throttling off".

### Plain sentences that stand on their own

Short sentences, active verbs, ordinary words. Every count has its noun,
every pronoun an antecedent the reader can see. After an edit, read the
sentence before and the sentence after, because a deletion can take an
antecedent with it. A list for parallel items, a table for measurements,
prose for reasoning. Bold marks the terms a list defines and nothing else.

## The text of the app

The users are biologists. The principles above hold, and one more sets
the tone: nothing misleads without saying so. The app neither hides a
problem nor raises one that is not there.

- **A label** names the thing in the words of the field: "Latitude
  column", "Classification", not "lat col" or "group var".
- **An error** says what happened and how to put it right, in plain words
  and with the names from the user's own file: "accessions.csv could not
  be imported: line 1,203 has 14 fields where the header has 12, read
  with the semicolon as the separator." The way to put it right has to be
  one that works. No "invalid", no "oops", no apology, nothing of the
  code: a stack trace, NaN, an id, a revision.
- **A notice** of something the app did says what it did and how to undo
  it.
- **A count of what a view cannot show**, "312 individuals without
  coordinates", is given wherever rows are left out.

No text leans on where a thing is or on its colour, "the button on the
right", "the points in red": a user may not see either. A button says
what it does.

## The forms

- **Documents under `docs/`.** The opening paragraph says what the
  document is, its date, what it decides and where the related documents
  are.
- **Doc comments.** What the item is or does in the words of the domain,
  the units and the shape of each value, and what a caller must know: that
  a missing value is marked, that a revision only grows. How it is
  implemented stays out unless the caller sees it.
- **Commit messages.** A lower case subject that says what changed, and a
  body with the why and the numbers. Nothing about the session. The
  attribution lines the system asks for go at the end.
- **A recommendation**, in a reply or a document, in this order: what is
  being decided, with the options spelled out; the recommendation in a
  full sentence; the reasons, each with its numbers; what is not known;
  what is asked of the reader.
- **A request for a decision.** The options, what each gives and takes,
  the recommendation, and what happens next in each case. It is ready
  when the reader can answer without asking anything back. What the
  writer can decide alone is decided and not asked.
- **A chat reply** opens with a sentence that says what it is about, then
  the answer in a full sentence. When several things are true, the one
  that changes what the owner does goes first. A longer reply is sketched
  before it is written.

## Before handing a text over

The writer cannot see what is missing from the page, because they know
it. So a document under `docs/`, a skill, or an issue goes to the
`first-reader` subagent, and so do the words of a window, with a user of
the app as the reader. It gets the path or the text, one sentence that says who reads it and what for,
and three to five questions the reader should be able to answer from it.
Compare its summary and answers with what was meant: where they differ,
the text is wrong, not the reader. Fix what it reports, and send it again
when the fix was large.

A commit message, a doc comment or a chat reply does not go to the
subagent. Read it once more against "Only what the reader can use" and
"Context before the name".

## When a text is sent back

The text is corrected, and so is this skill: find the principle that
allowed the failure, or that is missing, and revise it where it stands.
The skill does not grow by one entry per failure; a correction becomes a
new paragraph only when no principle covers it.
