## ADDED Requirements

### Requirement: The chat route bounds and survives its model dependency

The chat route SHALL apply a time budget to any model call it makes, and SHALL return a successful response whether that call succeeds, fails, or expires.

#### Scenario: The budget expires into an answer

- **WHEN** a routing call exceeds its time budget
- **THEN** the route MUST abandon it and return the chat's unanswered response with a 200

#### Scenario: A provider outage is not the API's status

- **WHEN** the routing provider returns an error or refuses for quota
- **THEN** the route MUST return a 200 carrying the unanswered response, because a provider's availability is not this API's liveness

#### Scenario: The matcher path makes no outbound call

- **WHEN** a message the matcher answers is submitted
- **THEN** the route MUST perform no outbound model request, and its latency MUST NOT depend on the provider

### Requirement: The routing decision is in the request log

The API SHALL log how each chat message was answered, on the request's own log line.

#### Scenario: Each answer records its stage

- **WHEN** a chat message is answered
- **THEN** the log MUST carry whether it was matched, routed, or unanswered, the selected tool where one was selected, and the elapsed model time, as flat primitive fields alongside the request id

#### Scenario: Message content is not the log

- **WHEN** the routing decision is logged
- **THEN** the line MUST NOT carry the model's raw response or the credential used to obtain it

## MODIFIED Requirements

### Requirement: Responses never carry secret material

The API SHALL NOT return provider secrets, authorization keys, model credentials, raw model responses, or server signing material in any response.

#### Scenario: Financial metadata is filtered

- **WHEN** wallet or policy state is returned
- **THEN** it MUST contain only the address, the provider, the agent association, and a policy summary, and MUST NOT contain credentials or configuration that reveals them

#### Scenario: Configuration endpoints expose only public values

- **WHEN** demo configuration is served
- **THEN** it MUST contain only values safe for the browser — the parent name, the chain, public addresses, and public provider identifiers

#### Scenario: A missing secret fails before the external call

- **WHEN** a route requiring a provider secret is invoked without it
- **THEN** the failure MUST name the absent variable and MUST occur before any external request is made

#### Scenario: A model response is not passed through

- **WHEN** the chat route calls a model
- **THEN** the response body MUST carry only the answer assembled from reads and the stage that selected it, and MUST NOT carry the model's raw output, its prompt, or the provider's error payload
