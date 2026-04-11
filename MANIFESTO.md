# Plurics - Manifesto

*LLMs should reason about problems and compose tools to solve them. Code should compute. Workflows are how we orchestrate both.*

---

## 1. The Observation

When an LLM agent is asked to "analyze this dataset," what happens is rarely analysis. What happens is that the model writes a Python script that imports pandas and scikit-learn, executes it in a shell, captures the output, and interprets the result. The same model, asked the same question with the same data ten times, will write ten slightly different scripts that compute the same statistics. None of those scripts will be saved. None will be reused. None will be tested beyond the implicit "did the agent's interpretation make sense." The next question on the next dataset will produce the eleventh variation.

This is treated as normal. It is, in fact, the dominant pattern of how production agentic systems work today. LangChain, CrewAI, AutoGen, Claude Code, the entire generation of agentic frameworks built between 2023 and 2026 - they all assume that the natural mode of an LLM agent is to write code on demand, execute it, observe the result, and continue. The framework's job is to make that loop efficient: better tool dispatch, smarter context management, cleaner sandboxes, more reliable execution.

What none of them question is the loop itself.

Look at where an agent's tokens actually go in a typical run. A small fraction goes to the decisions that matter - what to investigate, how to interpret a result, what to conclude. The rest goes to recreating well-known computations that already exist as battle-tested library functions. The agent burns through context window writing `df.describe()` and variations on it. It burns through wall clock waiting for shells to execute scripts that do PCA. It burns through reliability budget on subtle bugs introduced by writing slightly wrong versions of well-known algorithms. And every workflow run starts from zero, because the code the agent wrote last time was thrown away when the run ended.

This is not a marginal inefficiency. It is the central waste of contemporary AI engineering, and it is invisible because everyone has accepted it as the cost of doing business.

## 2. The Thesis

LLMs should reason about problems and compose the tools that solve them. Code should compute. The job of a workflow engine is to orchestrate the boundary between the two.

The work an LLM does well has two faces that are easy to conflate and important to distinguish. The first is judgment: deciding what to investigate next, interpreting an ambiguous result, formulating a hypothesis, recognizing when something is surprising, structuring a report so a human can act on it. The second is composition: reading a problem, understanding which primitives from a toolset are relevant, figuring out how they connect, arranging them into a sequence that answers the question, and mediating the results as they come back. These are the two things that LLMs are uniquely good at, and that no library function can replace. Judgment without composition produces ideas that never become actions. Composition without judgment produces pipelines that do the wrong thing elegantly. Both matter, and a well-designed workflow node gives the LLM room for both.

A computation step is different in kind. Applying PCA to a matrix, fitting a regression, running a permutation test, parsing a CSV, computing an autocorrelation, simplifying a symbolic expression - these have known, validated, fast, correct implementations in libraries that have been tested for years. Asking an LLM to recreate them at runtime is wasteful in three independent dimensions - token cost, latency, correctness - and offers no benefit. The LLM should *choose* when and how to use PCA, understand its assumptions, interpret its loadings. It should not *implement* PCA, which is a solved problem that nobody should be solving again.

The implication is structural. A workflow is not a graph of "tasks the agent will perform." A workflow is a graph of *decisions and compositions* interleaved with *computations*. The decisions and the compositions are the domain of LLMs - this is where contextual understanding lives. The computations are the domain of a registry of validated tools - this is where determinism lives. The workflow engine exists to coordinate the two: it gives reasoning nodes the toolsets they need to compose, it lets them invoke tools via structured calls, and it ensures that the products of one step feed into the inputs of the next in a typed, traceable, resumable way.

Plurics is the workflow engine built on this thesis.

## 3. Fundamental Properties

A system built on this principle has properties that systems built on the dominant paradigm do not have.

**Cumulative capability.** The tool registry grows over time. Every workflow run adds value to all future workflow runs, because tools introduced for one use case become available to all others. The system becomes more capable the more it is used, not just better-tuned. A fresh installation of Plurics ships with seed tools covering the standard data science toolkit; a year-old installation has a registry shaped by the specific domains its users explored, and that shape is itself a scientific artifact about those domains.

**Correctness by composition.** A reasoning node that delegates computation to a registered tool inherits the correctness guarantees of that tool. If `sklearn.pca.fit_transform` is correct (and it is, by virtue of being tested by millions of users for years), then any reasoning node that invokes it is correct on the PCA step by construction. The agent cannot make an arithmetic error in PCA because the agent is not doing the arithmetic. This is qualitatively different from "the agent wrote a PCA implementation and we hope it's right." Hallucination is impossible when the operative verb is invocation.

**Token efficiency that compounds.** A reasoning node that invokes three tools to answer a question consumes a small fraction of the tokens that an agent writing three Python scripts would consume. The savings compound across nodes, across rounds, across workflows. The same Claude budget that runs three workflows in the dominant paradigm runs ten or twenty in this one. The difference is not 2x - it is closer to an order of magnitude when measured end-to-end on realistic pipelines.

**Typed composability.** Tools have typed input and output ports. A tool that produces a `FeaturesFrame` can be connected to any tool that consumes a `FeaturesFrame`. The workflow engine type-checks the composition statically before execution, catching entire categories of bugs that today only surface at runtime. The type system also makes it possible for an LLM to *know* what is composable: when a reasoning node receives the toolset description, it sees not just what each tool does but how the tools fit together. The space of valid compositions is discoverable, not guessable.

**Observable progress.** Because computation is delegated to registered tools, every state transition in a workflow has a known cost, a known correctness profile, and a known signature. The platform can record exactly what happened: which tool was invoked with which inputs, what outputs were produced, how much it cost in time and tokens, whether it succeeded or failed. The result is full traceability, reproducible runs, and the ability to diagnose problems by inspection rather than by re-running with logging enabled.

## 4. The Cognitive Architecture

In Plurics, the unit of work is not the agent. It is the **node**, and nodes come in two categories.

A **reasoning node** is one in which an LLM is given a purpose, a context, and a toolset drawn from the registry. The LLM thinks about the problem, figures out which tools from the toolset are relevant, composes them into an approach, and invokes them to produce the answer. The output is a structured signal - decisions, conclusions, references to artifacts produced - not a blob of text and not a pile of files. The reasoning node is where both judgment and composition live: judgment about what the problem requires and how to interpret what comes back, composition about which primitives to chain and how. Its prompt focuses on *how to think about the problem and what tools are available*, not on *how to write the code*. The preset for a reasoning node is dramatically shorter than for a traditional agent prompt because it does not need to teach the model how to use pandas - pandas is in the registry as a set of typed tools, and the model composes them with full awareness of their signatures.

A **tool node** is one in which a single registered tool is invoked with parameters from upstream nodes, deterministically, with no LLM in the loop. Tool nodes are how computations enter the workflow at points the workflow author has decided in advance - the OHLC fetcher at the start of a financial pipeline, the Lean compiler at the end of a theorem proving pipeline, the backtester at the end of a strategy pipeline. They are fast, predictable, and free of token cost.

The workflow YAML expresses the graph of these two node types. Reasoning nodes are where the workflow allows the LLM to decide. Tool nodes are where the workflow author has determined that no decision is needed, only execution. The proportion between the two is a design choice for each workflow: a workflow can be almost entirely tool nodes with reasoning only at branch points, or mostly reasoning nodes with tool nodes only at well-defined entry and exit points. Both extremes are valid, and the same engine handles both.

The registry is the third entity, sitting beneath the workflow layer and shared across all workflows installed on the same instance. It is the long-term memory of the system. Workflows come and go; the registry persists.

## 5. What Plurics Rejects

Plurics is opinionated, and its opinions are shaped by what it has observed in the agentic ecosystem. Several patterns that are common elsewhere are deliberately excluded.

**Plurics rejects ad-hoc code generation as the primary mode of computation.** When a workflow needs a computation, the answer is not "ask an LLM to write Python on the fly." The answer is "find the tool in the registry, or build it once and add it to the registry." Code generation by LLMs is a tool of last resort, not a default operating mode. The default is composition of pre-existing primitives.

**Plurics rejects the assumption that every problem deserves a fresh agent.** The dominant pattern in agentic systems is to spawn an agent per task, give it free rein, and trust it to figure things out. This produces systems that are simultaneously powerful and unreliable: powerful because the agent can do anything, unreliable because it usually does it differently each time. Plurics treats free rein as a failure mode. Reasoning nodes have constrained toolsets, structured outputs, and verifiable signals. Freedom is granted in the choice of *how to compose tools*, not in *whether to compose them at all*.

**Plurics rejects the conflation of reasoning and execution into a single loop.** Claude Code, Cursor, and similar tools merge "the model is thinking" and "the model is doing" into one continuous stream. This is appropriate for interactive coding sessions where a human is in the loop and can correct mistakes. It is inappropriate for autonomous workflows where errors compound silently. Plurics separates the two: reasoning and composition happen in reasoning nodes and produce structured signals; execution happens in tools that are deterministic, tested, and well-understood. The boundary is a synchronization point that the workflow engine controls.

**Plurics rejects cross-domain ambition as a design principle.** A system that tries to do everything ends up doing nothing well. Plurics is a workflow engine for domains where the structure of work can be expressed as a DAG of decisions and computations. This excludes pure conversational AI, real-time interactive assistants, and continuous streaming pipelines. It includes most of what scientific computing, automated research, formal verification, and structured analysis actually look like.

**Plurics rejects the framing of AI engineering as model selection.** "Should I use GPT-4 or Claude Opus or DeepSeek?" is not the central question. The central question is "what should the LLM be doing in this workflow at all, and what should be done by validated code?" Once that is answered, the choice of model is a tactical detail. The same workflow runs identically with different LLM backends, and the right backend for a node is the one that does the reasoning required for that node well enough at the lowest cost.

## 6. What Plurics Does Not Promise

Plurics is not magic, and pretending otherwise would be dishonest.

Plurics does not eliminate the need for domain expertise. Building a registry of useful tools for a domain still requires understanding that domain. Designing a workflow that does productive research still requires understanding what productive research looks like. The system gives leverage to expertise; it does not replace it. A user with no idea what PCA is for will not benefit from having it in the registry.

Plurics does not solve the problem of LLM hallucination at the reasoning level. Reasoning nodes can still draw wrong conclusions, propose wrong hypotheses, misinterpret correct tool outputs. What Plurics does is shrink the surface area where hallucination can cause damage: tool outputs are correct, so the LLM cannot poison downstream computation by writing buggy code. But the LLM can still reach a wrong conclusion from correct numbers, and the workflow design must include the verification steps (adversarial review, cross-validation, statistical guards) to catch this. The platform makes such verification cheap and convenient, but it does not perform it automatically.

Plurics does not make slow problems fast. A workflow that requires running a 20-minute backtest will still take 20 minutes per backtest. The savings are in the parts of the workflow that today are wasteful: the LLM token cost, the script-writing overhead, the redundant code generation. The wall clock of inherently expensive computations is unchanged. What changes is that those computations happen once, deterministically, in tools that have been validated, instead of happening in slightly different forms each time the workflow runs.

Plurics does not produce trustworthy results without verification. A workflow that runs and produces a finding is not, by virtue of having run, producing a true finding. Verification is the responsibility of the workflow author: building in adversarial nodes, cross-checks, statistical rigor, and human review at the right points. The platform makes verification structurally easy because everything is traceable and reproducible. But ease of verification is not verification.

Plurics is not finished. The thesis is firm; the implementation is a work in progress. The registry is initially small; the seed tools cover only the most common primitives; many design questions about versioning, sandboxing, type system extension, and registry sharing across machines are open. This document is a statement of intent, and the project's value will be measured by how well the implementation delivers on the intent over time.

---

*Plurics exists because we believe the next generation of AI systems will not be built by giving LLMs more freedom, but by giving them more leverage. Leverage comes from validated primitives they can compose, cumulative capability that grows across workflows, and clear separation between what LLMs do well - reasoning and composition - and what code does better. This manifesto is the foundation. The rest is engineering.*