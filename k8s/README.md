# Kubernetes deployment

Kustomize manifests for the same services as `docker/compose.yaml`: Neo4j (StatefulSet with a volume), Redis, the DAL
(2 replicas behind its Service, which replaces the compose `dal-lb`), the ingestion service, the API server (2 replicas)
and the web client (nginx), plus an optional Ingress.

```sh
docker compose -f docker/compose.yaml build        # builds graphdisplay-{dal,ingest,server,client}
# local cluster (kind / minikube): load the images, e.g. kind load docker-image graphdisplay-dal ...
kubectl apply -k k8s
kubectl -n graphdisplay port-forward service/client 8080:80   # http://127.0.0.1:8080
```

For a real cluster push the images to a registry and set `images:` in `kustomization.yaml`.

## Addresses and ports

Nothing the applications read is hard-coded in the Deployments: every service address and port comes from `configmap.yaml` (`envFrom`), the same variables `docker/compose.yaml` takes from the environment (`.env.example`). The client's nginx proxy target is filled from the same ConfigMap. The port numbers of the Services, containers and probes in the manifests are plain Kubernetes fields: if you change a port in the ConfigMap, change them to match.

## Notes

- `secret.yaml` holds the development Neo4j password; replace it before deploying outside a local cluster.
- Neo4j Community Edition cannot be clustered, so it stays at one replica.
- No graph is seeded. Upload one from the UI, or set `SEED_FILE` on the ingest Deployment to a mounted file.
