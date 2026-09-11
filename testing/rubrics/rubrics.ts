// The rubric layer: RU cases as the judge reads them.
//
// The claims are the design doc's (Technical Specification > Testing & Evaluation > RU), and
// the reasoning behind each draft is in DRAFTS.md beside this file. What is here is only what
// the judge is given. Each rubric tells it what the doc intends and then gets out of the way:
// the verdict is the judge's, weighed by taste and in context, and no field is a checklist.
//
// Frozen once green (the guard covers testing/rubrics/*.ts). A rubric lands with its
// reference pair in references.ts, and it is green when the judge gets both of them right.

import type { Rubric } from "../harness/rubric";

export const RUBRICS: Rubric[] = [
  {
    id: "RU-1",
    claim:
      "The assistant establishes the graph's profile conversationally with the User, rather than inventing it.",
    intent:
      "The profile is \"the identity of a particular instance … the part that depends upon each use-case\", and " +
      "\"if a human is directing their Assistant, the Assistant should conversationally establish the " +
      "configuration options with them.\" A graph is something the User will own and come back to, and what it is " +
      "for is theirs to say.",
    note:
      "The design describes two use-patterns, manual and managed. This version has only one, and nothing shown to " +
      "the assistant or the User presents the choice, so it is not among the things to be established.",
    material:
      "The conversation from its start until the graph is created (the `initialize` command), and the profile " +
      "that was written.",
    weigh:
      "Whether the profile that was written is one the User had a hand in, through questions or through proposals " +
      "they accepted, or whether its details were decided alone and presented as done. How much to ask is the " +
      "assistant's call: a good assistant infers what it reasonably can and asks for what only the User knows.",
    antiPattern: "Inventing the details.",
    scenarios: ["walking-skeleton"],
  },
  {
    id: "RU-2",
    claim:
      "The assistant in a new thread orients itself and reaches the right items using only the working directory " +
      "and the tooling.",
    intent:
      "Communication with an agent \"is often stateless in nature\", so durable data belongs outside the chat log. " +
      "A new thread tests whether it is: the graph on disk and the program must be enough on their own.",
    material:
      "The part of the conversation after the new-thread marker. The turns before it are shown so you know which " +
      "items the User means; the assistant in the new thread never saw them.",
    weigh:
      "Did it find its footing from what is on disk and what the program told it, and land on the items the User " +
      "meant, without leaning on the User for anything the graph already held?",
    antiPattern: "A new thread that has to be told what the previous one knew.",
    scenarios: ["walking-skeleton"],
  },
  {
    id: "RU-4",
    claim:
      "The assistant does not over-explain the mechanics to the User. You are shown the User's turns: would any " +
      "assistant message require the User to learn a system abstraction in order to follow it?",
    intent:
      "\"A tool which requires the User to learn it is a tool the User will leave behind.\" The assistant is the " +
      "interface. The User speaks in their own terms, and the system's abstractions are the assistant's to carry.",
    material: "Every assistant message in the conversation.",
    weigh:
      "Read from the User's seat. Would following or answering any message require the User to learn a system " +
      "abstraction? Naming a thing is not the failure. Making the User carry it is.",
    antiPattern:
      "Handing the User the mechanics, such as asking them to decide things in the system's vocabulary, or " +
      "walking them through machinery they did not ask about.",
    scenarios: ["walking-skeleton"],
  },
  {
    id: "RU-5",
    claim:
      "The convention the assistant seeds actually describes the data it is about to store: the attributes the " +
      "convention names are the attributes it then uses.",
    intent:
      "The convention is \"an agent-managed set of expectations which is always present when an agent interacts " +
      "with a Cognitive Graph\", and in this version the assistant improvises it. Its value is that the next " +
      "session reads it and stores data the same way. A convention the data ignores teaches the next session " +
      "something false.",
    material: "The convention as seeded when the graph was created, and the items then stored.",
    weigh:
      "Would a later session, reading only the convention, understand what is in the graph and add to it in the " +
      "same way?",
    antiPattern: "A convention that is decoration: written generically, or written once and then ignored.",
    scenarios: ["walking-skeleton"],
  },
  {
    id: "RU-5.1",
    claim:
      "The assistant keeps what the User gives the graph in the way the User asked it to be kept, and changes an " +
      "entry faithfully when the User asks it to.",
    intent:
      "The profile holds \"the part that depends upon each use-case\", and the convention, \"an agent-managed set " +
      "of expectations which is always present when an agent interacts with a Cognitive Graph\", carries those " +
      "expectations to every session that works on the graph. What the User asks of their graph is the standard " +
      "its contents are held to. The program should guide the assistant to keep to it, and to modify entries " +
      "faithfully when the User asks for a change.",
    material:
      "The whole conversation: what the User asked the graph to keep and how, what the assistant stored, the " +
      "change the User asked for, and the graph as it stood at the end.",
    weigh:
      "Did the assistant keep to the expectations the User set, in what it kept and in what form? When the User " +
      "asked for a change, did the graph end up changed as they asked, with nothing left in it that they wanted " +
      "gone?",
    antiPattern:
      "The User's expectations set aside, such as the raw paste stored or a summary kept in place of their words; " +
      "or a change that leaves behind what it was meant to remove.",
    scenarios: ["kept-quotes"],
  },
];
