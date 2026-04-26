---
title: "What's New in Kubernetes 1.36 (Haru)"
author: nga
date: 2026-04-26 10:00:00 +0700
categories: [Technical sharing, Kubernetes]
tags: [kubernetes, release, security, k8s, ai-generated]
render_with_liquid: false
---

It has been a busy spring for cluster operators. Ingress NGINX was [officially retired on March 24](/posts/ingress-nginx-retired-migrating-to-gateway-api/), which sent a lot of people scrambling to migrate. And now, just four days ago on April 22, Kubernetes v1.36 dropped. The release is named Haru — Japanese for spring (春), but also clear skies (晴れ) and something distant on the horizon (遥か). The logo is a gorgeous reimagining of Hokusai's Red Fuji with two cats standing guard. I appreciate the aesthetic.

More importantly: v1.36 is one of the more substantive security releases the project has shipped in a while. If you run your own cluster — homelab, small production, whatever — there are a few things here worth understanding before you upgrade.

## The numbers

70 enhancements total: 18 graduating to Stable (GA), 25 entering Beta, and 25 new Alpha features. The release theme leans hard into three pillars: security hardening, AI/ML workload support, and API scalability. Most of what I care about falls in that first bucket.

## User Namespaces — finally GA

This one has been cooking since v1.25. User Namespaces graduated to GA in v1.36, and it is the security improvement I am most excited about for homelab use.

The problem it solves is fundamental. When a process runs as root inside a container, the Linux kernel sees it as root on the host too. If a container escape happens — say, through a kernel vulnerability or a misconfigured volume mount — the attacker lands on your node as UID 0. Game over.

With User Namespaces enabled, the container still thinks it is running as root, but the kernel maps that UID to a high, unprivileged range on the host. A container escape no longer buys you node admin. Capabilities like `CAP_NET_ADMIN` become scoped to the container's namespace, not the host. The blast radius of a compromise shrinks dramatically.

The API is a single field in the pod spec:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: isolated-workload
spec:
  hostUsers: false
  containers:
  - name: app
    image: myapp:latest
    securityContext:
      runAsUser: 0
```

Setting `hostUsers: false` is all it takes. No image changes, no complex configuration. The one practical requirement is Linux kernel 6.3+ on your nodes — that is when tmpfs gained idmap mount support, which is needed for service account tokens and Secrets to work correctly. You also need containerd 2.0+ or CRI-O 1.25+. If you are running a reasonably current homelab setup, you are probably fine.

I have been wanting to enable this on my k0s cluster for a while. Now that it is GA, I have no excuse not to.

## Mutating Admission Policies — webhooks, but without the webhook

Mutating Admission Policies also graduate to GA in v1.36. This is one of those features that sounds bureaucratic until you have actually suffered through maintaining a mutating webhook, at which point it sounds like a rescue operation.

Mutating webhooks have always been a bit awkward. You need to run an external service, keep it highly available, manage TLS certificates for it, handle timeouts gracefully, and hope nothing goes wrong during admission. If your webhook is down, API calls can fail or time out depending on your `failurePolicy`. It is operational overhead that scales poorly.

`MutatingAdmissionPolicy` does the same job but runs in-process inside the API server, using CEL (Common Expression Language) expressions to describe the mutations. No external service, no TLS to manage, no network call.

Here is a simple example: adding a default resource limit label to pods in a specific namespace if one is not already set.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingAdmissionPolicy
metadata:
  name: set-default-resource-tier
spec:
  matchConstraints:
    resourceRules:
    - apiGroups:   [""]
      apiVersions: ["v1"]
      operations:  ["CREATE"]
      resources:   ["pods"]
  matchConditions:
  - name: missing-tier-label
    expression: "!('resource-tier' in object.metadata.labels)"
  mutations:
  - patchType: "JSONPatch"
    jsonPatch:
      expression: >
        [
          JSONPatch{
            op: "add",
            path: "/metadata/labels/resource-tier",
            value: "standard"
          }
        ]
```

And the binding that wires it to a scope:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingAdmissionPolicyBinding
metadata:
  name: set-default-resource-tier-binding
spec:
  policyName: set-default-resource-tier
  validationActions: [Deny]
  matchResources:
    namespaceSelector:
      matchLabels:
        apply-resource-defaults: "true"
```

You get full access to `object`, `oldObject`, `request`, and namespaceObject in your CEL expressions, and you can parameterize policies against ConfigMaps or custom resources. For teams already using `ValidatingAdmissionPolicy` (which went GA in 1.30), this is a natural complement.

## Fine-Grained Kubelet API Authorization — closing a real hole

This one graduated to GA from Beta, and the backstory is worth knowing.

Before this feature, almost every kubelet API path was authorized against a single RBAC subresource: `nodes/proxy`. That meant any workload needing to read node metrics, health status, or pod logs had to be granted `nodes/proxy` permission. And `nodes/proxy` also covers the ability to exec into any container on the node.

There was even a demonstrated WebSocket trick where a plain HTTP GET to the kubelet exec endpoint — which maps to `get` verb, not `create` — could be used to open an exec session without the RBAC check catching it properly. It was a real, exploitable gap for anything that had `nodes/proxy` access.

With `KubeletFineGrainedAuthz` now locked-to-enabled in GA, the kubelet maps API paths to specific subresources. `/stats/*` checks against `nodes/stats`. `/logs/*` checks against `nodes/log`. `/metrics/*` against `nodes/metrics`. And so on. A compromised monitoring agent that only needs metrics access can no longer pivot to exec.

The feature is backward-compatible: the kubelet tries the specific subresource first, and falls back to `nodes/proxy` if that check fails. So existing RBAC policies keep working. The practical action is to start tightening your RBAC for new deployments — grant `nodes/metrics` instead of `nodes/proxy` where you can.

## SELinux volume relabeling — faster pod startup

This one is less dramatic but practically useful if you run SELinux on your nodes (or if you are on RHEL-family systems where it is on by default).

Previously, when a pod with a volume was scheduled on a node, Kubernetes would recursively `chown` and relabel every file in the volume to match the pod's SELinux context. For large volumes, this could add seconds or even minutes to pod startup time — the operation is `O(n)` in the number of files.

In v1.36, this graduates to GA using a mount option instead of recursive relabeling. The kernel applies the SELinux label at mount time, making it an `O(1)` operation. The startup penalty for SELinux-enabled clusters on large volumes is essentially gone.

If you are not running SELinux, this does not affect you. If you are, this is a meaningful quality-of-life improvement.

## A couple of beta features worth watching

Two things in Beta caught my attention.

**Mixed Version Proxy** — when you are upgrading a multi-node cluster, there is a window where different nodes run different API server versions. Mixed Version Proxy lets requests be forwarded to an API server that can actually handle them, reducing the friction of rolling upgrades. For a small homelab cluster this is not urgent, but for anyone trying to do zero-downtime upgrades, it is useful.

**Server-Side Sharded List and Watch** — this is about API server performance at scale. The idea is to distribute large List and Watch operations across multiple API server instances so no single one becomes a bottleneck. Still Alpha, technically, but it is the kind of thing that matters if you are running a cluster with a high volume of controllers or CRDs.

## Practical upgrade notes

For small clusters, the upgrade path from 1.35 is straightforward. A few things to check before you pull the trigger:

- **`gitRepo` volume type is permanently removed.** It was deprecated since 1.11 and now it is gone. If you have any workloads still using it, they need to move to init containers or a git-sync sidecar before you upgrade.
- **`externalIPs` on Services is deprecated.** Not removed yet — the plan is v1.43 — but the deprecation warning is now present. Start planning if you use it.
- **Check deprecated APIs** in your manifests. `kubectl convert` and `pluto` are both useful for this. Read the deprecation guide before upgrading.

The k0s cluster I have been running since early 2025 is the main thing I will be upgrading. The User Namespaces and Kubelet authorization improvements are both compelling enough that I want to move sooner rather than later. I will probably write up the upgrade experience once I have done it.

## Closing thought

Spring has been eventful on the Kubernetes side. The ingress-nginx retirement forced a lot of overdue migration work. Now 1.36 ships with meaningful, concrete security improvements that have been in progress for years. User Namespaces reaching GA alone feels like a milestone worth noting — it closes a class of container escape risks that has existed since the beginning of the container era.

If you want the full picture, both the sneak peek post and the official release announcement are worth reading. Links below.

---

## References

- [Kubernetes v1.36 Release Announcement](https://kubernetes.io/blog/2026/04/22/kubernetes-v1-36-release/)
- [Kubernetes v1.36 Sneak Peek](https://kubernetes.io/blog/2026/03/30/kubernetes-v1-36-sneak-peek/)
- [User Namespaces GA in Kubernetes 1.36](https://kubernetes.io/blog/2026/04/23/kubernetes-v1-36-userns-ga/)
- [Fine-Grained Kubelet Authorization GA](https://kubernetes.io/blog/2026/04/24/kubernetes-v1-36-fine-grained-kubelet-authorization-ga/)
- [User Namespaces — Kubernetes Docs](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- [MutatingAdmissionPolicy — Kubernetes Docs](https://kubernetes.io/docs/reference/access-authn-authz/mutating-admission-policy/)
