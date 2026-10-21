# Kubernetes deployment

Kustomize manifests for the same services as `docker/compose.yaml`: Neo4j (StatefulSet with a volume), Redis, the DAL
(2 replicas behind its Service, which replaces the compose `dal-lb`), the ingestion service, the API server (2 replicas)
and the web client (nginx), plus an optional Ingress.

These manifests are generic: they contain no seed graph, local address or local port. For a working example on Docker Desktop run `./deploy-example.sh` from the repository root. It builds the images and adds an overlay with the example graph as the seed, then opens the UI on http://127.0.0.1:8090; stopping it (Ctrl+C) removes everything it created. See the root README, section *Kubernetes*.

For your own deployment, write an overlay with `resources: [<path to k8s>]` that sets your images (`images:`), secrets, access (Ingress host) and optionally a seed graph (`SEED_FILE`, `SEED_NAME`, `SEED_PIN` on the ingest Deployment).

## Addresses and ports

Nothing the applications read is hard-coded in the Deployments: every service address and port comes from `configmap.yaml` (`envFrom`), the same variables `docker/compose.yaml` takes from the environment (`.env.example`). The client's nginx proxy target is filled from the same ConfigMap. The port numbers of the Services, containers and probes in the manifests are plain Kubernetes fields: if you change a port in the ConfigMap, change them to match.

## Notes

- `secret.yaml` holds the development Neo4j password; replace it before deploying outside a local cluster.
- Neo4j Community Edition cannot be clustered, so it stays at one replica.
- Without a seed the app starts empty; graphs are uploaded from the UI or with `POST /graphs`.
