# Lenses

One paragraph per lens goes into one generator's brief, verbatim. A lens is a constraint on where to look, not a persona: it changes what the agent searches for, not its tone.

## Defaults per mode

| Mode | Defaults |
|---|---|
| `feature` | Baseline, Subtract, User's worst day, Time-boxed, Borrow, Contrarian |
| `architecture` | Baseline, Subtract, Extreme scale, Zero new infra, Operator, Buy or adopt |
| `topic` | Practitioner, Critic, Historian, Economist, Newcomer, Adjacent field |

Swap a default for another lens when the frame calls for it. Keep Baseline and one subtractive lens (Subtract or Invert) in every set.

## Engineering lenses

**Baseline.** Propose what an experienced engineer on this team would build first, given the stack and constraints. Include the conventional answer and its closest variants. This lens anchors the pool so the others have something to differ from.

**Subtract.** Solve the problem by removing something: a feature, a step, a setting, a service, a requirement. Ask what happens if this is never built, and what can be deleted so the problem disappears.

**Invert.** Describe how to make the problem as bad as possible, then flip each of those moves into an idea.

**Extreme scale.** Assume 100× the users, data, request rate or teams. Propose designs that still hold, and say which parts of the obvious design break first.

**Zero new infra.** Use only what already runs in this stack: no new service, datastore, queue or dependency. Push the existing pieces further than usual.

**Buy or adopt.** Find an existing product, open-source project, platform feature or standard that already solves most of this. Name it and say what gap remains.

**Borrow.** Pick a field outside software (logistics, biology, finance, games, aviation, retail) where a similar problem is solved, name the analogue, and translate its mechanism.

**User's worst day.** Start from the user at their most stressed: an outage, a deadline, a first visit, a bad network. Propose ideas that make that moment work, even if they help the average day less.

**Operator.** Start from the person on call: deploys, migrations, rollback, observability, cost at 3 a.m. Propose designs that are easy to run and to undo.

**Time-boxed.** Only ideas that ship to real users in two days or less. Find the smallest version that still tests the core bet.

**Long horizon.** Ideas that only make sense if this lives for two or more years and grows. Say what you'd build now to make the later version cheap.

**Contrarian.** Assume the framing of the problem is wrong. Reframe it at least two ways (a different user, a different job to be done, a different success metric) and propose ideas for each reframing.

## Topic lenses

**Practitioner.** What people who do this daily would say works, from experience, with the trade-offs they live with.

**Critic.** The strongest case against the common view, and the evidence behind it. Ideas that follow if the critic is right.

**Historian.** How this question was answered before, what changed, and which old answers are coming back.

**Economist.** Incentives, costs, who pays and who benefits. Ideas that change the incentives instead of the behaviour.

**Newcomer.** What someone with no context would find confusing or arbitrary, and ideas that start from there.

**Adjacent field.** The nearest neighbouring discipline that solved a version of this. Name it and translate its answer.
