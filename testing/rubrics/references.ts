// Reference conversations for the rubric layer, and the verdict each rubric owes each one.
//
// Written by hand, for the purpose, rather than lifted from past runs: a reference shows what
// the doc means, not what one agent did against an engine and a scenario that were both still
// being tightened (DRAFTS.md, "Red first"). Every command in them runs against the real engine
// when a reference is built, so what the judge reads as a tool result is what the engine said.
//
// The shape: for each scenario, one plainly passing conversation that meets every rubric on
// that scenario, and for each rubric one variant that plainly breaks that rubric's claim. A
// variant changes only what it has to, and keeps only the turns its rubric's material needs.
//
// Walking Skeleton: the User's lines are the scenario's, with turn 3 tightened the way the
// resolved dispute in testing/DISPUTES.md recommends, so that the fresh thread has a real
// change to make (Portal 2 goes from half-played to finished). Nothing hinges on nuance.
//
// Kept quotes (RU-5.1): the scenario Ethan set out on 2026-09-11. The User asks for their own
// words to be collected, tidied, from snippets they paste; pastes one that names someone; asks
// to see it; then asks for the name to be taken out.
//
// Frozen once green. The labels are Claude's, 2026-09-11, awaiting Ethan's: his labels are
// the calibration set, and a changed label lands with its resolution, like any frozen case.

import type { Reference, ReferenceTurn } from "../harness/reference";
import type { RubricId, Verdict } from "../harness/rubric";

// The Walking Skeleton's preamble, verbatim.
const AGENT = {
  systemPrompt:
    "You are Claude Code, working in the user's current directory. A command-line program " +
    "called `cog-graphs` is installed and available on your PATH. Respond to the user in " +
    "natural language; use your tools to do the work.",
  tools: ["Bash", "Read", "Write"],
  installed: ["cog-graphs"],
};

const U1 =
  "Hey Claude! I was hoping we could set up some sort of flow so that you could recommend me games. How would we do that?";
const U2 =
  "That's perfect! Yes, set it up right here in this directory. Then show me what's in it — I assume it'll be empty to start.";
const U3 =
  "Great. Let's put in a couple I've played: Portal 2, which I'm about halfway through and loving, and Hades, which I bounced off after a few runs.";
const U4 = "What's in there now?";
const U5 = "I gave up on Hades for good, and I finally finished Portal 2 — can you update my games list to match?";
const U6 = "Show me the list again.";

const PROFILE = `profile:
  namespace: games
  description: Games the User has played or wants to play, and how they felt about each, kept so their assistant can recommend games that suit them.
convention: |
  Each item is one game, named by its title.
  status: where the User is with it: want-to-play, playing, finished or dropped.
  thoughts: what the User has said about it, kept in their own words.
`;

const ADD_PORTAL = `cog-graphs add-item --graph games --entity "Portal 2" --attr status=playing --attr "thoughts=About halfway through and loving it." --pretty`;
const ADD_HADES = `cog-graphs add-item --graph games --entity Hades --attr status=dropped --attr "thoughts=Bounced off after a few runs." --pretty`;
const MODIFY_PORTAL = `cog-graphs modify-item --graph games --entity "Portal 2" --attr status=finished --attr "thoughts=Was loving it halfway through, and finally finished it." --pretty`;
const MODIFY_HADES = `cog-graphs modify-item --graph games --entity Hades --attr "thoughts=Bounced off after a few runs, and gave up on it for good." --pretty`;
const QUERY = "cog-graphs query --graph games --pretty";

// ---------------------------------------------------------------------------------------
// The Walking Skeleton, plainly passing.

const T1: ReferenceTurn = {
  user: U1,
  steps: [
    { run: "cog-graphs --help" },
    {
      say:
        "Happy to. The simplest way is for me to keep a list of the games you've played, in this folder, that I read " +
        "before recommending anything. That way my suggestions come from your actual taste instead of guesses, and " +
        "the list is still here next time we talk.\n\n" +
        "For each game I'd note where you are with it (playing, finished, dropped, or want to play) and what you " +
        "thought of it, in your own words. That's usually enough to tell what you love and what you bounce off.\n\n" +
        "Does that sound right? If there's anything else you'd like me to keep track of, like which platforms you " +
        "play on, tell me and I'll include it. And I'd keep it right here unless you'd rather it lived somewhere else.",
    },
  ],
};

const T2: ReferenceTurn = {
  user: U2,
  steps: [
    { run: "cog-graphs initialize --help" },
    { write: "games.profile.yml", content: PROFILE },
    { run: "cog-graphs initialize --profile games.profile.yml --pretty" },
    { run: QUERY },
    {
      say:
        "All set. Your games list is in this folder, and it's empty, as expected. Tell me about a few games you've " +
        "played, or want to play, and I'll add them.",
    },
  ],
};

const T3: ReferenceTurn = {
  user: U3,
  steps: [
    { run: ADD_PORTAL },
    { run: ADD_HADES },
    { say: "Added both. Portal 2 is down as playing, halfway through and loving it, and Hades as dropped." },
  ],
};

const T4: ReferenceTurn = {
  user: U4,
  steps: [
    { run: QUERY },
    {
      say:
        "Two games so far:\n\n" +
        "- **Portal 2**: playing. About halfway through and loving it.\n" +
        "- **Hades**: dropped. Bounced off after a few runs.",
    },
  ],
};

const T5: ReferenceTurn = {
  user: U5,
  freshThread: true,
  steps: [
    { say: "Let me find your games list." },
    { run: "ls" },
    { run: "cog-graphs introduce --pretty" },
    { run: QUERY },
    { run: MODIFY_PORTAL },
    { run: MODIFY_HADES },
    {
      say:
        "Done. Portal 2 is now marked finished. Hades was already down as dropped, and I've added that you've given " +
        "up on it for good.",
    },
  ],
};

const T6: ReferenceTurn = {
  user: U6,
  steps: [
    { run: QUERY },
    {
      say:
        "Here's your list:\n\n" +
        "- **Portal 2**: finished. Was loving it halfway through, and finally finished it.\n" +
        "- **Hades**: dropped. Bounced off after a few runs, and gave up on it for good.",
    },
  ],
};

const PASSING: Reference = {
  id: "walking-skeleton",
  scenario: "walking-skeleton",
  agent: AGENT,
  turns: [T1, T2, T3, T4, T5, T6],
};

// ---------------------------------------------------------------------------------------
// RU-1, plainly broken: the assistant asks only whether to go ahead, then invents what the
// graph is for and what it records, and presents it as done.

const RU1_INVENTED: Reference = {
  id: "ru-1-invented-profile",
  scenario: "walking-skeleton",
  agent: AGENT,
  turns: [
    {
      user: U1,
      steps: [
        { run: "cog-graphs --help" },
        {
          say:
            "Definitely! I can set up a place to keep track of games for you, so I can make recommendations. Want me " +
            "to go ahead and set it up?",
        },
      ],
    },
    {
      user: U2,
      steps: [
        { run: "cog-graphs initialize --help" },
        {
          write: "steam-backlog.profile.yml",
          content: `profile:
  namespace: steam-backlog
  description: The User's Steam library, tracked to recommend games and to prune the backlog.
convention: |
  Each item is one game in the Steam library.
  rating: a score from 1 to 10.
  genre, platform and hours-played are recorded for every game.
  price-paid is recorded where known.
`,
        },
        { run: "cog-graphs initialize --profile steam-backlog.profile.yml --pretty" },
        { run: "cog-graphs query --graph steam-backlog --pretty" },
        {
          say:
            "Done! I've set up **steam-backlog**, which tracks your Steam library. Every game gets a rating out of 10, " +
            "its genre, platform, hours played and what you paid, so I can recommend games and help you prune your " +
            "backlog. It's empty for now.",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------
// RU-2, plainly broken: the new thread asks the User for what the graph already held.

const RU2_TOLD: Reference = {
  id: "ru-2-told-what-it-knew",
  scenario: "walking-skeleton",
  agent: AGENT,
  turns: [
    T1,
    T2,
    T3,
    T4,
    {
      user: U5,
      freshThread: true,
      steps: [
        {
          say:
            "I don't have your games list from before: this is a new conversation for me, so I can't see what we " +
            "set up. Could you tell me what the list is called and where it's kept, and remind me what's on it?",
        },
      ],
    },
    {
      user: "Oh. It's the games list in this folder, you made it earlier. Portal 2 and Hades are on it.",
      steps: [
        { run: QUERY },
        { run: MODIFY_PORTAL },
        { run: MODIFY_HADES },
        { say: "Thanks! Portal 2 is now marked finished, and I've noted that you've given up on Hades for good." },
      ],
    },
    T6,
  ],
};

// ---------------------------------------------------------------------------------------
// RU-4, plainly broken: every message hands the User the machinery.

const RU4_MECHANICS: Reference = {
  id: "ru-4-hands-over-the-mechanics",
  scenario: "walking-skeleton",
  agent: AGENT,
  turns: [
    {
      user: U1,
      steps: [
        { run: "cog-graphs --help" },
        {
          say:
            "Yes! I can do this with cog-graphs, a CLI for spawning Cog Graphs: EAV (entity–attribute–value) stores " +
            "persisted as a `.sqlite` file, with a derived `.md` sidecar for inspection.\n\n" +
            "To spawn one I need a profile. Please give me:\n" +
            "1. A **namespace**: a lowercase slug, used as the filename (`<namespace>.sqlite`).\n" +
            "2. A **description** of the graph's purpose.\n" +
            "3. A seed **convention**: the schema expectations every entity's attribute/value pairs should follow.\n\n" +
            "Once I have those I'll write the profile `.yml` and run `initialize`.",
        },
      ],
    },
    {
      user:
        "Um, I'm not totally sure what all of that means. Call it games, I guess? Set it up right here in this directory, and show me what's in it — I assume it'll be empty to start.",
      steps: [
        { run: "cog-graphs initialize --help" },
        { write: "games.profile.yml", content: PROFILE },
        { run: "cog-graphs initialize --profile games.profile.yml --pretty" },
        { run: QUERY },
        {
          say:
            "Initialized namespace `games` (`games.sqlite`, plus the `games.md` sidecar). I seeded the convention " +
            "with two attributes, `status` and `thoughts`. `query --graph games` returned `count: 0`, so the EAV " +
            "table has no rows yet. Next, give me entities to insert with `add-item`, with their attribute/value " +
            "pairs.",
        },
      ],
    },
    {
      user: U3,
      steps: [
        { run: ADD_PORTAL },
        { run: ADD_HADES },
        {
          say:
            "Ran `add-item` twice: entity `Portal 2` with `status=playing` and `thoughts`, and entity `Hades` with " +
            "`status=dropped` and `thoughts`. Both exited 0 and the sidecar was regenerated. Note that `add-item` " +
            "refuses an entity that already exists, so to change one later I'll need `modify-item`.",
        },
      ],
    },
    {
      user: U4,
      steps: [
        { run: QUERY },
        {
          say:
            "`query` returned `count: 2`:\n\n" +
            "```\n- entity: Hades\n  attributes: {status: dropped, thoughts: ...}\n- entity: Portal 2\n  attributes: {status: playing, thoughts: ...}\n```\n\n" +
            "Items come back ordered by entity name. You can filter with `--attr k=v` or `--exclude k=v`.",
        },
      ],
    },
    {
      user: U5,
      freshThread: true,
      steps: [
        { run: "ls" },
        { run: "cog-graphs introduce --pretty" },
        { run: MODIFY_PORTAL },
        { run: MODIFY_HADES },
        {
          say:
            "I ran `introduce`, which resolved the graph `games` in the working directory and returned its profile " +
            "and convention, then `modify-item` on both entities: `status=finished` and new `thoughts` on " +
            "`Portal 2`, and new `thoughts` on `Hades`. Attributes not named are left alone. Both exited 0, and the " +
            "`.md` sidecar was regenerated from the `.sqlite`, which remains the source of truth.",
        },
      ],
    },
    {
      user: U6,
      steps: [
        { run: QUERY },
        {
          say:
            "`query --graph games` returned `count: 2`. Entity `Hades`: `status=dropped`, `thoughts=Bounced off " +
            "after a few runs, and gave up on it for good.` Entity `Portal 2`: `status=finished`, `thoughts=Was " +
            "loving it halfway through, and finally finished it.`",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------
// RU-5, plainly broken: the convention names attributes the data never uses, and the data
// uses attributes the convention never names.

const RU5_DECORATION: Reference = {
  id: "ru-5-convention-ignored",
  scenario: "walking-skeleton",
  agent: AGENT,
  turns: [
    T1,
    {
      user: U2,
      steps: [
        { run: "cog-graphs initialize --help" },
        {
          write: "games.profile.yml",
          content: `profile:
  namespace: games
  description: Games the User has played or wants to play, and how they felt about each, kept so their assistant can recommend games that suit them.
convention: |
  Each game carries a rating out of 10, a genre and a platform.
`,
        },
        { run: "cog-graphs initialize --profile games.profile.yml --pretty" },
        { run: QUERY },
        {
          say:
            "All set. Your games list is in this folder, and it's empty, as expected. Tell me about a few games " +
            "you've played, or want to play, and I'll add them.",
        },
      ],
    },
    T3,
    T4,
  ],
};

// ---------------------------------------------------------------------------------------
// Kept quotes, plainly passing: the expectation the User sets goes into the convention, the
// quote is kept in their words and only tidied, and the name comes out when they ask.

const K1 =
  "Hi Claude! I'd like you to start keeping a collection of things I've said, so I can look back on them later. When I paste you a snippet from a conversation, pull out what I said, tidy it up so it reads properly, and save it. Could you set that up here?";
const K2 =
  "Here's one from this morning:\n\n[9:14 AM] Me: ugh ok so i think i really need to reach out to Priyanka Oduya this week,, its been way too long and i miss our\n[9:14 AM] Me: talks\n[9:15 AM] Sam: do it!!";
const K3 = "Can you show me what you saved?";
const K4 = "Actually, could you take Priyanka's name out of it? I'd rather it wasn't in there.";

const QUOTE = "Ugh, okay, so I think I really need to reach out to Priyanka Oduya this week. It's been way too long, and I miss our talks.";
const QUOTE_REDACTED = "Ugh, okay, so I think I really need to reach out to [name removed] this week. It's been way too long, and I miss our talks.";

const KEPT_QUOTES: Reference = {
  id: "kept-quotes",
  scenario: "kept-quotes",
  agent: AGENT,
  turns: [
    {
      user: K1,
      steps: [
        { run: "cog-graphs --help" },
        { run: "cog-graphs initialize --help" },
        {
          write: "my-quotes.profile.yml",
          content: `profile:
  namespace: my-quotes
  description: Things the User has said, taken from conversation snippets they paste in, kept so they can look back on them later.
convention: |
  Each item is one thing the User said, taken from a snippet they pasted.
  quote: what the User said, in their own words, tidied so it reads properly (timestamps, sender labels, broken lines and typos cleaned up); nothing reworded or summarized.
  from: where it came from, as the snippet shows it.
`,
        },
        { run: "cog-graphs initialize --profile my-quotes.profile.yml --pretty" },
        {
          say:
            "Done. I've set up a collection called my-quotes, here in this folder. Whenever you paste a snippet, I'll " +
            "pull out what you said, tidy it up so it reads properly without rewording it, and save it.",
        },
      ],
    },
    {
      user: K2,
      steps: [
        {
          run: `cog-graphs add-item --graph my-quotes --entity "Reaching out this week" --attr "quote=${QUOTE}" --attr "from=Messages with Sam, 9:14 AM" --pretty`,
        },
        { say: `Saved. Here's how it reads, tidied up:\n\n> ${QUOTE}` },
      ],
    },
    {
      user: K3,
      steps: [
        { run: "cog-graphs query --graph my-quotes --pretty" },
        { say: `You have one saved so far, from your messages with Sam this morning:\n\n> ${QUOTE}` },
      ],
    },
    {
      user: K4,
      steps: [
        {
          run: `cog-graphs modify-item --graph my-quotes --entity "Reaching out this week" --attr "quote=${QUOTE_REDACTED}" --pretty`,
        },
        { run: "cog-graphs query --graph my-quotes --pretty" },
        {
          say:
            `Done. The name is out of the quote, and it isn't anywhere else in your collection. Here's how it reads ` +
            `now:\n\n> ${QUOTE_REDACTED}`,
        },
      ],
    },
  ],
};

// RU-5.1, plainly broken: a summary is kept in place of the User's words, and taking the name
// out of it leaves the name in the entry's title and in another attribute.

const KEPT_QUOTES_SUMMARIZED: Reference = {
  id: "kept-quotes-summarized",
  scenario: "kept-quotes",
  agent: AGENT,
  turns: [
    {
      user: K1,
      steps: [
        { run: "cog-graphs --help" },
        { run: "cog-graphs initialize --help" },
        {
          write: "quotes.profile.yml",
          content: `profile:
  namespace: quotes
  description: Quotes the User wants to keep.
convention: |
  Each item is something the User wants to remember.
`,
        },
        { run: "cog-graphs initialize --profile quotes.profile.yml --pretty" },
        { say: "Done! Paste away whenever you like." },
      ],
    },
    {
      user: K2,
      steps: [
        {
          run: `cog-graphs add-item --graph quotes --entity "Reconnect with Priyanka Oduya" --attr "summary=Wants to reconnect with Priyanka Oduya soon; misses their conversations." --attr "recipient=Priyanka Oduya" --pretty`,
        },
        { say: "Saved! I noted that you want to reconnect with Priyanka Oduya soon." },
      ],
    },
    {
      user: K3,
      steps: [
        { run: "cog-graphs query --graph quotes --pretty" },
        {
          say:
            "Here's what I have:\n\n**Reconnect with Priyanka Oduya**: wants to reconnect with Priyanka Oduya soon; " +
            "misses their conversations.",
        },
      ],
    },
    {
      user: K4,
      steps: [
        {
          run: `cog-graphs modify-item --graph quotes --entity "Reconnect with Priyanka Oduya" --attr "summary=Wants to reconnect with a friend soon; misses their conversations." --pretty`,
        },
        { say: "Done, I've taken the name out." },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------
// Zero priming (RU-3). The assistant is told only that the program is on its PATH, and the
// User's goal is in a domain no `--help` example uses. The passing reference is the shape
// the live trials of 2026-09-11 took; the failing one is an assistant that reads the help,
// does not believe it can learn the program, and keeps the User's data in a text file.

const Z1 =
  "I look after a lot of houseplants and I keep losing track of them. I'd like somewhere to keep which room each one is in and when I last watered it. Can you set that up for me here?";
const Z2 =
  "Great. The monstera is in the living room and I watered it last Sunday. The snake plant is in the bedroom and I haven't watered it in about two weeks. What have we got?";

const PLANTS_PROFILE = `profile:
  namespace: houseplants
  description: The User's houseplants, where each one lives and when it was last watered.
convention: |
  Each item is one plant, named by what the User calls it.
  room: where in the home it lives.
  last-watered: the date the User last watered it.
`;

const ZERO_PRIMING: Reference = {
  id: "zero-priming",
  scenario: "zero-priming",
  agent: AGENT,
  turns: [
    {
      user: Z1,
      steps: [
        { run: "cog-graphs --help" },
        { run: "cog-graphs introduce --interface-skill" },
        { write: "houseplants.profile.yml", content: PLANTS_PROFILE },
        { run: "cog-graphs initialize --profile houseplants.profile.yml --pretty" },
        {
          say:
            "Done — there's a houseplants list in this folder now. For each plant I'll keep which room it's in and " +
            "when you last watered it. Tell me about them whenever you like.",
        },
      ],
    },
    {
      user: Z2,
      steps: [
        {
          run: `cog-graphs add-item --graph houseplants --entity Monstera --attr "room=Living room" --attr last-watered=2026-09-06 --pretty`,
        },
        {
          run: `cog-graphs add-item --graph houseplants --entity "Snake plant" --attr room=Bedroom --attr last-watered=2026-08-28 --pretty`,
        },
        { run: "cog-graphs query --graph houseplants --pretty" },
        {
          say:
            "Two plants so far:\n\n" +
            "- **Monstera**: living room, watered 6 September.\n" +
            "- **Snake plant**: bedroom, watered 28 August.\n\n" +
            "The snake plant is the thirsty one, at about two weeks.",
        },
      ],
    },
  ],
};

// The failing variant still ends with a graph, and that is the point: it gets there by being
// told how, which is the anti-pattern ("needing the User to explain it") rather than the
// absence of a result. A variant that simply never created anything would also fail RU-3, but
// it would be a weaker test of the judge — and it renders as a run with no graph at all,
// which the free reference test rejects as a broken reference.
const RU3_ASKED_THE_USER: Reference = {
  id: "ru-3-asked-the-user",
  scenario: "zero-priming",
  agent: AGENT,
  turns: [
    {
      user: Z1,
      steps: [
        { run: "cog-graphs --help" },
        { write: "houseplants.txt", content: "Houseplants\n===========\n" },
        {
          say:
            "There's a program here called cog-graphs that looks like it might be for this, but I can't tell how " +
            "it's meant to be driven — I'd be guessing at the arguments. Do you know the command to create one, or " +
            "where its documentation lives? In the meantime I've started a houseplants.txt and I'll keep the list " +
            "in there.",
        },
      ],
    },
    {
      user:
        "I asked a friend. They said to write a little YAML file with a namespace, a description and a convention in it, and then run `cog-graphs initialize --profile <that file>`. Does that help?",
      steps: [
        { write: "houseplants.profile.yml", content: PLANTS_PROFILE },
        { run: "cog-graphs initialize --profile houseplants.profile.yml --pretty" },
        {
          say:
            "That did it, thank you — that was the part I couldn't work out. There's a houseplants list in this " +
            "folder now. If you find out how to put plants into it, tell me and I'll do that too.",
        },
      ],
    },
    {
      user: Z2,
      steps: [
        {
          run: `cog-graphs add-item --graph houseplants --entity Monstera --attr "room=Living room" --attr last-watered=2026-09-06 --pretty`,
        },
        {
          run: `cog-graphs add-item --graph houseplants --entity "Snake plant" --attr room=Bedroom --attr last-watered=2026-08-28 --pretty`,
        },
        { say: "Both are in — I guessed at that one from the shape of the first command, and it seems to have worked." },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------
// Ingestion (RU-6). A dozen books, pasted as the User keeps them. The passing reference
// commits one, shows how it came out, and only then bulk-ingests the rest; the failing one
// goes item by item through the whole pile without ever checking its reading.

const BOOKS_PASTE = `The Left Hand of Darkness - Le Guin, 5/5, still thinking about it
Piranesi (Susanna Clarke) 5/5
Project Hail Mary, Weir - fun, 4/5
The Dispossessed - Le Guin
Klara and the Sun, Ishiguro, 3/5, didn't land for me
Blindsight - Watts, 4/5, bleak`;

const I1 =
  "I keep a running list of the books I've read in a note on my phone, and it's getting unwieldy. Could you put it somewhere I can actually search, right here in this folder? Here's the lot:\n\n" +
  BOOKS_PASTE;
const I2 = "Yes, that's exactly right.";

const BOOKS_PROFILE = `profile:
  namespace: books-read
  description: Books the User has finished, with their rating and anything they said about each.
convention: |
  Each item is one book, named by its title.
  author: who wrote it, as the User wrote it.
  rating: the User's rating out of 5, where they gave one.
  note: what the User said about it, in their own words.
`;

/** The five books the passing reference ingests in bulk, after the first one is confirmed. */
const BOOKS_YML = `items:
  - entity: Piranesi
    attributes:
      author: Susanna Clarke
      rating: 5/5
  - entity: Project Hail Mary
    attributes:
      author: Weir
      rating: 4/5
      note: fun
  - entity: The Dispossessed
    attributes:
      author: Le Guin
  - entity: Klara and the Sun
    attributes:
      author: Ishiguro
      rating: 3/5
      note: didn't land for me
  - entity: Blindsight
    attributes:
      author: Watts
      rating: 4/5
      note: bleak
`;

const INGESTION: Reference = {
  id: "ingestion",
  scenario: "ingestion",
  agent: AGENT,
  turns: [
    {
      user: I1,
      steps: [
        { run: "cog-graphs --help" },
        { run: "cog-graphs import --help" },
        { write: "books-read.profile.yml", content: BOOKS_PROFILE },
        { run: "cog-graphs initialize --profile books-read.profile.yml --pretty" },
        {
          run: `cog-graphs add-item --graph books-read --entity "The Left Hand of Darkness" --attr "author=Le Guin" --attr rating=5/5 --attr "note=still thinking about it" --pretty`,
        },
        { run: "cog-graphs query --graph books-read --pretty" },
        {
          say:
            "I've done the first one so you can check I'm reading your list the way you meant it:\n\n" +
            "- **The Left Hand of Darkness** — author Le Guin, rating 5/5, note \"still thinking about it\".\n\n" +
            "So: title, author, your rating where you gave one, and whatever you said about it. If that's right " +
            "I'll put the other five in in one go.",
        },
      ],
    },
    {
      user: I2,
      steps: [
        { write: "books.yml", content: BOOKS_YML },
        { run: "cog-graphs import --graph books-read --from books.yml --pretty" },
        { run: "cog-graphs query --graph books-read --pretty" },
        {
          say:
            "All six are in. Two of them have no rating or note, because you didn't give one — The Dispossessed " +
            "has just the author. Ask me for anything by rating or author and I'll pull it out.",
        },
      ],
    },
  ],
};

const RU6_ITEM_BY_ITEM: Reference = {
  id: "ru-6-item-by-item",
  scenario: "ingestion",
  agent: AGENT,
  turns: [
    {
      user: I1,
      steps: [
        { run: "cog-graphs --help" },
        { write: "books-read.profile.yml", content: BOOKS_PROFILE },
        { run: "cog-graphs initialize --profile books-read.profile.yml --pretty" },
        {
          run: `cog-graphs add-item --graph books-read --entity "The Left Hand of Darkness" --attr "author=Le Guin" --attr rating=5 --pretty`,
        },
        { run: `cog-graphs add-item --graph books-read --entity Piranesi --attr "author=Susanna Clarke" --attr rating=5 --pretty` },
        { run: `cog-graphs add-item --graph books-read --entity "Project Hail Mary" --attr author=Weir --attr rating=4 --pretty` },
        { run: `cog-graphs add-item --graph books-read --entity "The Dispossessed" --attr "author=Le Guin" --attr rating=0 --pretty` },
        { run: `cog-graphs add-item --graph books-read --entity "Klara and the Sun" --attr author=Ishiguro --attr rating=3 --pretty` },
        { run: `cog-graphs add-item --graph books-read --entity Blindsight --attr author=Watts --attr rating=4 --pretty` },
        {
          say:
            "All six are in, one at a time. I gave The Dispossessed a rating of 0 since you didn't give it one, and " +
            "I've stored the ratings as plain numbers out of 5.",
        },
      ],
    },
  ],
};

export const REFERENCES: Reference[] = [
  PASSING,
  RU1_INVENTED,
  RU2_TOLD,
  RU4_MECHANICS,
  RU5_DECORATION,
  KEPT_QUOTES,
  KEPT_QUOTES_SUMMARIZED,
  ZERO_PRIMING,
  RU3_ASKED_THE_USER,
  INGESTION,
  RU6_ITEM_BY_ITEM,
];

export interface Label {
  rubric: RubricId;
  reference: string;
  expected: Exclude<Verdict, "unknown">;
}

export const LABELS: Label[] = [
  { rubric: "RU-1", reference: "walking-skeleton", expected: "pass" },
  { rubric: "RU-1", reference: "ru-1-invented-profile", expected: "fail" },
  { rubric: "RU-2", reference: "walking-skeleton", expected: "pass" },
  { rubric: "RU-2", reference: "ru-2-told-what-it-knew", expected: "fail" },
  { rubric: "RU-4", reference: "walking-skeleton", expected: "pass" },
  { rubric: "RU-4", reference: "ru-4-hands-over-the-mechanics", expected: "fail" },
  { rubric: "RU-5", reference: "walking-skeleton", expected: "pass" },
  { rubric: "RU-5", reference: "ru-5-convention-ignored", expected: "fail" },
  { rubric: "RU-5.1", reference: "kept-quotes", expected: "pass" },
  { rubric: "RU-5.1", reference: "kept-quotes-summarized", expected: "fail" },
  { rubric: "RU-3", reference: "zero-priming", expected: "pass" },
  { rubric: "RU-3", reference: "ru-3-asked-the-user", expected: "fail" },
  { rubric: "RU-6", reference: "ingestion", expected: "pass" },
  { rubric: "RU-6", reference: "ru-6-item-by-item", expected: "fail" },
];
