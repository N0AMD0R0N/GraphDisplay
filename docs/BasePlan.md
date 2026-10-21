This is a "System Graphing Project": a program that visualizes system structure and data via UI and provides an API for graph-based searches. The input is a JSON representation of a graph - representing the elements of a system (services, DBs, message queues, etc.) as nodes and the APIs between them as edges.
The program should expose the search routes via a REST API (the results of which should be sub-groups of the original JSON graph according to the filter in the request query - in a manner that allows the user to use the program UI to present only the queried sub-groups of the graph).
Before designing the program, inspect the provided JSON file and derive from it the structure and objects of the graph.
The program should answer the following criteria:
- support a querying structure that can divide the original graph into sub-groups representing routes from one element to another
    - the structure should support queries by properties of a certain element (e.g. only routes where the first element is "red" - assuming color is a property) or number of elements.
    - the structure should support queries with union, intersection or difference operations.
- optimized for search time (expecting a result for a standard query in 100ms range and a heavy query in a 500ms range)
    - this is read over write priority - if the JSON data needs to be organized differently to achieve this, utilize DB and SearchEngine like solutions to achieve this.
- written in the latest stable react version
- using react-flow as the graph presentation library
- using styled-components for styling UI elements
- create a dedicated test directory (and an npm test script)
    - tests should be static (no back and forth between the tests and the model)
    - tests should report a reliable success / failure (fail reason) output
    - the test script should run all tests in one of two modes: run all and log the result or run until the first fails to allow the model to debug it

Definition of a "route":
- route: a series of nodes connected by edges, where every node is connected to up to 2 other nodes, a route represents a possible direction of travel along the graph without going through the same node twice (no return, cycle or diverging through)
    - route is directed (using the edges from and to values)
    - a route must have a start node and an end node (a route can be defined with only 1 node serving as both start and end nodes but cannot be defined with no nodes)
    - a cycle in the graph may be considered as a route up to the point of return (e.g. "A->B->C->D->A->", where the last transition "->A" is replaced with a circle indication in the UI that will clearly reference A but will be distinct from a node, for the purpose of that case A is the first node and D is the last node)

Query model / language:
- we'll use Cypher (by neo4j) as the query language for the graph and routes

Result shape
- "Sub-groups of the original JSON graph": when filtering for routes based on query all routes that apply should be returned as an array of "Route" objects sorted by number of nodes longest to shortest, in the UI the app will show the first route with a selector for the other matching options and an indicator of the number of routes found for the query.
- node and edge objects in the result keep all original properties - this is intended for the user or external service to inspect and derive conclusions about the system.
- when showing a single route, edges in the result should not keep the grouped form of the input, but be normalised instead
- to avoid large sets and pagination issues we will show up to 200 nodes in the graph (top 200 nodes by edges to and from them), if a node is connected to undisplayed nodes, we will present it connected to an indicator that, when pressed, will load the nodes paths connected to the selected node (up to 200 nodes in the same manner with indicators to repeat if the connected paths are over 200 nodes long). another such indicator will be used for the node groups that are not connected to the currently displayed nodes in the graph.


Input lifecycle
- input is loaded via api, processed graphs should be stored in a cache structure such that switching between graphs will be quick if necessary (cache life-time is configurable, defaulting to 1 day) - for the purpose of this project, the npm "start" script will use the example json as the only json loaded
- graphs are to be validated upon post, missing nodes and edges are a special case - these are "incomplete" but can still be shown in the graph deriving the data about them from the other elements of the graph that reference them - if data is in an invalid format return a 401 error, if data is missing but can be derived/processed return a 207 response with 422 error and an appropriate message.

Performance targets
- "Standard" will refer to query of up to 20 conditions, "heavy" query will refer to query with up to 70 conditions
- we are expecting an initial scale of about 1000 nodes and 10000 edges, however we will keep an option for segmented graphs (i.e. a large graph of over 1000 nodes might be split between multiple JSON files and need to be connected at the backend level at some point, account for that by api but do not implement a solution yet)
- latency will not be measured during this stage of the project

Technology stack (partially specified)
- this part is open on purpose; a later plan iteration will specify it.
- layout is to be determined automatically (not relying on the json)
- both backend and frontend will be written in typescript and share interfaces for the API


UI requirements (barely specified)
- User will have a single panel for query editing (see query language).
    - Query builder generated from /schema, plus a raw JSON editor for advanced users.
- Use distinct coloring by node "kind" property, coloring should be mapped and cached in the backend to appear uniformly in all UI instances.
- On empty result show an appropriate message as overlay on the empty graph
- we should dedicate as much visual area for the graph as possible.
- Auto-layout left→right (callers on the left, callees on the right).
- A highlight mode (dim the rest) for when a route is selected when showing the whole graph.
- A node details tooltip when clicking on a node (should stay until clicked away - not on hover).


Testing
- "Tests should be static (no back and forth between the tests and the model)": it means deterministic, fixture-based tests whose expectations are hard-coded, not generated or adjusted by an AI agent during the run.
- use Jest as the test runner.
- use "npm test" (run all and write a report) and "npm run test:bail" (stop at the first failure)
- split tests into unit (parser, query engine), API (HTTP contract), and performance (only the response time for the API at the moment)
- "Log result": to a formatted json file.
- Add a simple synthetic generator to test scaling (up to the expected 1000 nodes and 10000 edges)

Missing non-functional items
- for now we will not introduce additional features (such as CORS, Auth, API versioning, etc.)
- a readme will be added at a later stage of the plan

JSON
- "incomplete" nodes and edges are to be derived and understood from the other elements of the graph JSON
- "to" field is clearly a union type (string | array<string>)
- when processing add unique ids to nodes and edges (however the field "name" should be treated as unique, duplicate node names are erroneous)
- some node and edge properties are optional (undefined by default), nodes must have "name", edges must have "from" and "to", unique "id" will be added automatically.
- "metadata" field is a dictionary of optional properties
- ignore "\n" terminations, and make sure all strings are formatted uniformly (trimmed, lower cased, etc.).
- detect cycles and missing elements at the parser level.