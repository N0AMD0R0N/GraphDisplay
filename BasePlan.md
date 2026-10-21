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