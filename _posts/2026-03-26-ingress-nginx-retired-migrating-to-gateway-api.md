---
title: "Ingress NGINX is Dead — Migrating to Gateway API"
author: nga
date: 2026-03-26 10:00:00 +0700
categories: [Technical sharing, Kubernetes]
tags: [kubernetes, gateway-api, ingress, nginx, migration, ai-generated]
render_with_liquid: false
---

Hey everyone. If you followed my earlier post on [setting up an Nginx Ingress Controller on k0s](/posts/set-up-nginx-ingress-on-k8s), your cluster is now running software with no maintainer, no security patches, and no future. I want to make sure you know about that before it becomes a problem.

On March 24, 2026, the Kubernetes SIG Network and Security Response Committee officially retired Ingress NGINX. No more releases. No more bugfixes. No more CVE patches. The repositories are now read-only. The project is done.

This post walks through what that actually means for your cluster, why Gateway API is the right path forward, and how to migrate the exact setup from the previous post.

## What "Retired" Actually Means

The software doesn't stop working on your cluster. Pods still run, routes still resolve. What stops is any response to problems discovered after March 2026.

If a security researcher finds a remote code execution vulnerability in Ingress NGINX tomorrow — and this has happened before, notably with the "snippets" annotation class of bugs — nothing gets patched. You're on your own. For an internet-facing cluster, that's a real exposure, not a theoretical one.

The backstory is that the project survived for years on one or two volunteer maintainers working evenings and weekends. Eventually, the maintenance burden, combined with a design that accumulated serious security debt through its annotation system, made the project untenable. The SIG made the right call.

## Why the Old Ingress API Was Always a Bit Awkward

The core `Ingress` object in Kubernetes is intentionally minimal — just hosts, paths, and a backend service. Anything beyond that relied on annotations like `nginx.ingress.kubernetes.io/rewrite-target` or `nginx.ingress.kubernetes.io/ssl-redirect`. These annotations were controller-specific, non-portable, and in some cases became security liabilities.

More fundamentally, the `Ingress` resource merged two concerns that belong to different people: cluster operators (who own the load balancer and TLS certificates) and application developers (who own the routing rules). On a shared cluster, this made clean separation of responsibilities difficult.

Gateway API separates those concerns explicitly.

## Gateway API: The Successor

Gateway API was designed from the ground up as the replacement for Ingress. It introduces three primary resources:

- **GatewayClass** — defines the type of load balancer to provision. Owned by the infrastructure provider or cluster admin. Similar to `StorageClass` for volumes.
- **Gateway** — an instance of that class: specific ports, protocols, and TLS certificates. Owned by the cluster operator.
- **HTTPRoute** — the routing rules: hostnames, paths, header matching, backends. Owned by the application team.

This role-oriented split means your platform team can own the `Gateway` (and its certs), while individual teams deploy their own `HTTPRoute` objects into their own namespaces. No more cluster-wide annotation soup.

All three resources have been stable (GA) in `gateway.networking.k8s.io/v1` since Gateway API v1.0.

## Migration Walkthrough

Let's migrate the setup from my previous post: a `hello-world` app exposed at `hello-world.local` with a path-based Ingress rule.

### Step 1: Pick an Implementation

Gateway API is a spec, not an implementation. You still need a controller. For a homelab k0s cluster, I recommend either:

- **Envoy Gateway** — backed by the Envoy team, excellent docs, growing quickly
- **Traefik** — if you're already familiar with it; it supports Gateway API v1.5.1

I'll use Envoy Gateway here. Install it:

```bash
kubectl apply -f https://github.com/envoyproxy/gateway/releases/latest/download/install.yaml
kubectl wait --timeout=5m -n envoy-gateway-system \
  deployment/envoy-gateway --for=condition=Available
```

Envoy Gateway ships with its own `GatewayClass` named `eg` by default. Verify it's been registered:

```bash
kubectl get gatewayclass
# NAME   CONTROLLER                        ACCEPTED
# eg     gateway.envoyproxy.io/gatewayclass   True
```

### Step 2: Create the Gateway

This replaces the role that the Ingress Controller's `LoadBalancer` service played. Create a `Gateway` that listens on HTTP port 80:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: homelab-gateway
  namespace: default
spec:
  gatewayClassName: eg
  listeners:
  - name: http
    protocol: HTTP
    port: 80
    allowedRoutes:
      namespaces:
        from: Same
```

Apply it:

```bash
kubectl apply -f gateway.yaml
kubectl get gateway homelab-gateway
# NAME              CLASS   ADDRESS         PROGRAMMED
# homelab-gateway   eg      192.168.1.100   True
```

The `ADDRESS` field shows the external IP assigned by MetalLB — same as before, just coming from a different resource.

### Step 3: Create the HTTPRoute

This is what replaces your `Ingress` resource. Compare the two side by side.

The old Ingress from the previous post:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: hello-world-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
  - host: hello-world.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: hello-world-service
            port:
              number: 80
```

The equivalent HTTPRoute:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: hello-world-route
  namespace: default
spec:
  parentRefs:
  - name: homelab-gateway
  hostnames:
  - "hello-world.local"
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /
    backendRefs:
    - name: hello-world-service
      port: 80
```

Notice there are no annotations. The routing intent is expressed directly in the spec, not hidden in a string blob. The `rewrite-target` annotation from the old config isn't needed here since we're routing to `/` anyway — but if you need path rewriting, Gateway API has a first-class `URLRewrite` filter for that.

Apply it:

```bash
kubectl apply -f httproute.yaml
```

Test the same way as before:

```bash
curl -H "Host: hello-world.local" http://<GATEWAY_IP>/
```

### Step 4: TLS with cert-manager

For HTTPS, the annotation you're used to on an Ingress resource moves to the `Gateway` resource itself. Since cert-manager 1.15, Gateway API support is stable and no longer behind a feature flag.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: homelab-gateway
  namespace: default
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  gatewayClassName: eg
  listeners:
  - name: https
    protocol: HTTPS
    port: 443
    hostname: hello-world.local
    tls:
      mode: Terminate
      certificateRefs:
      - kind: Secret
        name: hello-world-tls
    allowedRoutes:
      namespaces:
        from: Same
```

cert-manager reads the `cert-manager.io/cluster-issuer` annotation on the `Gateway`, provisions a certificate, and writes it into the `Secret` named in `certificateRefs`. Your `HTTPRoute` doesn't change at all.

### Step 5: Use ingress2gateway to Convert Existing Rules

If you have more than a handful of Ingress resources, the `ingress2gateway` tool can automate the conversion. Install it:

```bash
go install github.com/kubernetes-sigs/ingress2gateway@v1.0.0
```

Run it against your cluster:

```bash
ingress2gateway print
```

It reads your existing `Ingress` objects and outputs equivalent `Gateway` and `HTTPRoute` YAML to stdout. Pipe it to a file, review it, then apply. It's a good starting point, though you should always review the output — especially for anything that relied on custom annotations.

### Step 6: Remove Ingress NGINX

Once you've verified routing works through the new Gateway, tear out the old controller:

```bash
kubectl delete -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
```

Check nothing still references `ingressClassName: nginx` in your cluster before you do:

```bash
kubectl get ingress --all-namespaces
```

## Common Pitfalls

**Annotation features without a direct equivalent.** Things like `nginx.ingress.kubernetes.io/rate-limit` or `nginx.ingress.kubernetes.io/lua-resty-*` don't map cleanly to Gateway API core features. Some implementations expose them as vendor extensions via policy attachments. Check your chosen implementation's docs before assuming parity.

**`rewrite-target` with capture groups.** The old NGINX pattern of `rewrite-target: /$1` using regex capture groups is replaced by the `URLRewrite` filter in HTTPRoute. The syntax is different — plan for this if you rely on path rewriting.

**cert-manager annotation placement.** The annotation moves from the `Ingress` to the `Gateway`. It's easy to put it on the `HTTPRoute` out of habit — it won't work there.

**Namespace routing permissions.** The `allowedRoutes` field on a `Gateway` listener controls which namespaces can attach `HTTPRoute` objects. If you're used to everything being in `default`, this is fine. On a shared cluster, you'll want to set this deliberately using namespace selectors.

**Run both controllers in parallel during migration.** There's no need to do a cutover. Install the Gateway API controller, route a test app through it, and leave Ingress NGINX running until you've migrated everything. Then remove it.

## Wrapping Up

The Ingress NGINX retirement feels abrupt, but the writing was on the wall for a while. Gateway API is genuinely better: cleaner resource model, proper role separation, first-class feature support instead of annotations. The migration for a simple homelab setup is maybe an hour of work.

If you're still running the setup from my [Nginx Ingress post](/posts/set-up-nginx-ingress-on-k8s) — note that post is now outdated and that setup should be replaced. Internet-facing or not, running unpatched ingress software is a risk worth fixing sooner rather than later.

Good luck with the migration. If something doesn't work on your k0s setup specifically, drop a comment — I've run through this on mine and can help troubleshoot.

## References

- [Ingress NGINX Retirement Announcement — kubernetes.io](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [Ingress NGINX: Statement from Kubernetes Steering and Security Response Committees](https://kubernetes.io/blog/2026/01/29/ingress-nginx-statement/)
- [Gateway API Documentation — gateway-api.sigs.k8s.io](https://gateway-api.sigs.k8s.io/)
- [ingress2gateway — kubernetes-sigs/ingress2gateway](https://github.com/kubernetes-sigs/ingress2gateway)
- [cert-manager Gateway API Support](https://cert-manager.io/docs/usage/gateway/)
- [Envoy Gateway Quickstart](https://gateway.envoyproxy.io/docs/tasks/quickstart/)
