## ADDED Requirements

### Requirement: A question the matcher misses is routed, not refused

The chat SHALL attempt a model-backed routing stage for a message its deterministic matcher does not recognise, and SHALL run that stage only after the matcher has declined. A message the matcher recognises SHALL be answered without any model call.

#### Scenario: An unmatched question reaches an intent

- **WHEN** an operator asks about the fleet in wording the matcher does not recognise
- **THEN** the chat MUST route the message to one of its existing intents and answer with that intent's read-derived answer

#### Scenario: A matched question never calls a model

- **WHEN** a message the matcher recognises is submitted
- **THEN** the answer MUST be produced by the matcher alone, and no model call MUST be made

#### Scenario: Near-miss intents stay with the matcher

- **WHEN** two intents differ only in word order — a request to set an agent's MCP endpoint and a question about what that agent's MCP server serves
- **THEN** each MUST be decided by the matcher, and the routing stage MUST NOT be consulted for either

### Requirement: The model chooses a read, never an answer

The routing stage SHALL emit a tool selection and arguments and nothing else. Model-generated text SHALL NOT appear in a rendered answer.

#### Scenario: The answer body is read-derived

- **WHEN** a model-routed answer is rendered
- **THEN** every displayed value MUST come from the same ENS, registry, permission and activity reads the matcher's answer for that intent would perform, carrying its own read time

#### Scenario: Model prose is discarded

- **WHEN** the routing response carries explanatory text alongside its tool selection
- **THEN** that text MUST NOT be rendered, stored, or returned in the response body

#### Scenario: An identical routed and matched answer

- **WHEN** the same intent is reached once by the matcher and once by routing
- **THEN** the two answers MUST be identical apart from the routing stage they declare

### Requirement: The model selects from live values and cannot invent one

Every argument the routing stage may supply SHALL be drawn from a closed set established for that request. An argument outside its set SHALL produce the unanswered state.

#### Scenario: An agent is selected from the fleet

- **WHEN** the routing stage names an agent
- **THEN** that agent MUST be one the store returned for this organization on this request, and a name absent from that set MUST NOT be looked up

#### Scenario: A record key is one this product defines

- **WHEN** the routing stage names a record key
- **THEN** it MUST be one of the endpoint and context keys the product defines, and any other key MUST be refused rather than planned for

#### Scenario: An amount is re-derived server-side

- **WHEN** the routing stage supplies a payment amount
- **THEN** the base-unit value MUST be computed by the server from the stated amount, and MUST NOT be taken from the model as base units

### Requirement: A routed write is still a plan

A write intent reached through the routing stage SHALL be answered with a plan and SHALL perform nothing.

#### Scenario: Routing cannot execute

- **WHEN** the routing stage selects an onboarding, grant, record-write, payment, or connect intent
- **THEN** the answer MUST be a plan naming the product routes that would do the work, and no chain transaction, store write, activity row, or outbound endpoint request MUST have occurred

#### Scenario: The operator still confirms

- **WHEN** a model-routed plan is displayed
- **THEN** it MUST require the operator's confirmation to run, on the same path a matched plan requires

### Requirement: An answer declares how it was routed

Every chat answer SHALL state whether its intent was selected by the matcher or by a model, and the console SHALL show that on a model-routed answer.

#### Scenario: Model routing is disclosed

- **WHEN** an answer was routed by a model
- **THEN** the console MUST show that a model selected the question's subject, distinguishably from the treatment used for verification or onchain confirmation

#### Scenario: A matched answer is unchanged

- **WHEN** an answer was produced by the matcher
- **THEN** it MUST render as it did before the routing stage existed

### Requirement: Routing failure degrades to the unanswered state

An unavailable, slow, or unusable routing response SHALL produce the chat's existing unanswered state with its suggestions, and the request SHALL succeed.

#### Scenario: A provider failure is not an error

- **WHEN** the routing provider is unreachable, refuses the request, exceeds its time budget, or returns something the tool surface does not accept
- **THEN** the chat MUST return the unanswered state with the questions it can answer, and MUST NOT return a server error

#### Scenario: No credential is a configuration state, not a failed console

- **WHEN** no routing credential is configured
- **THEN** the chat MUST behave exactly as it did before the routing stage existed

#### Scenario: The fallback is exercised, not assumed

- **WHEN** the routing stage is verified
- **THEN** a run with the credential removed MUST be recorded, because a fallback that has never been taken has not been shown to work

#### Scenario: A retry is bounded by the same budget

- **WHEN** the routing stage attempts a question more than once
- **THEN** every attempt MUST be spent inside the single time budget the request was given, and a provider failure or an expired budget MUST NOT be retried

### Requirement: Agent-supplied text reaching the router is untrusted

Agent labels, ENS names, record values, and any other text the fleet supplies SHALL enter the routing call as data and SHALL NOT be inserted into its system instruction or used to widen its tool surface.

#### Scenario: Instructions inside fleet data do not become instructions

- **WHEN** an agent's label or record value contains text resembling a command
- **THEN** it MUST be presented to the model as that agent's self-description, and MUST NOT change which tools exist or which arguments they accept

#### Scenario: An injection reaches no write

- **WHEN** a message or fleet value attempts to direct the routing stage to perform a write
- **THEN** the strongest available outcome MUST be a plan awaiting the operator, because the tool surface contains no executing tool

## MODIFIED Requirements

### Requirement: The console never fabricates state

The interface SHALL NOT display placeholder values, seeded scores, optimistic success, or model-generated content presented as read state.

#### Scenario: Loading states name what is loading

- **WHEN** an external read is in flight
- **THEN** the interface MUST name the system being read rather than show a generic spinner over fabricated content

#### Scenario: Completion follows confirmation, not submission

- **WHEN** provisioning is reported complete
- **THEN** chain reads MUST have confirmed the name, the resolver, the intended grants, and the absence of protected authority

#### Scenario: Empty states explain rather than fake

- **WHEN** there are no agents, no discovery matches, or no configured wallet
- **THEN** the interface MUST explain the absence, and MUST NOT show a disabled placeholder implying data exists

#### Scenario: Generated text never sits beside read state

- **WHEN** a model has taken part in producing an answer
- **THEN** no model-generated sentence MUST appear in that answer's title, caption, node labels, detail rows, or plan text, all of which MUST remain derived from reads or from fixed application copy

#### Scenario: The console's claim about itself is no stronger than the truth

- **WHEN** the console describes how its answers are produced
- **THEN** it MUST state that a question it cannot match directly is routed by a model, and MUST NOT claim that nothing is generated
