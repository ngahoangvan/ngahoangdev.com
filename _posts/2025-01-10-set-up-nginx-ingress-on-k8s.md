---
title: Set up a Nginx Ingress on k8s
author: nga
date: 2025-01-29 00:00:00 +0700
categories: [Technical sharing, Kubernetes, open-source]
tags: [k0s, k8s, oss]
render_with_liquid: false
image:
  path: /assets/img/posts/setup-a-nginx-ingress-on-k8s/k8s-ingress-nginx.webp
  alt: k0s
---

Hello everyone, it’s me again. Today is the first day of the Year of the Snake 2025, according to Eastern tradition. I wish you a new year full of health and energy for the challenges and opportunities ahead. In the previous article, we set up a Kubernetes cluster using k0s. Now, let's talk about how to expose services running inside the cluster to the outside world using `Ingress`.

`Kubernetes Ingress` is a powerful API object that manages external access to services, typically HTTP and HTTPS traffic. Instead of exposing each service with a separate LoadBalancer or NodePort, Ingress provides a more flexible and cost-effective way to route traffic using a single entry point.

## Prerequisites
- A working Kubernetes cluster set up using k0s (refer to [Part 1](/posts/set-up-k8s-cluster-using-k0s) of this blog series).
- At least one Worker Node.
- `kubectl` configured to access your cluster.
- A domain name (optional but recommended for practical Ingress usage).

## Deploying a Load Balancer with MetalLB
Since k0s does not come with an in-built load balancer, we need to deploy MetalLB to provide external IP addresses to services of type `LoadBalancer`.

Step 1: Install MetalLB

```bash
# Apply the MetalLB manifests
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/main/config/manifests/metallb-native.yaml
# Wait for the MetalLB pods to be in Running state
kubectl get pods -n metallb-system
```

Step 2: Configure an IP Address Pool

Create a configuration file for MetalLB:

```yaml
---
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: first-pool
  namespace: metallb-system
spec:
  addresses:
  - <ip-address-range-start>-<ip-address-range-stop>
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: example
  namespace: metallb-system
```

Apply the configuration:

```bash
kubectl apply -f metallb-config.yaml
```

Now, MetalLB will assign external IPs to LoadBalancer services in the cluster.

## Install an Ingress Controller
Kubernetes itself does not provide an Ingress Controller by default. We need to install one. For this guide, we'll use Nginx Ingress Controller.

First, apply the official Nginx Ingress Controller YAML manifest:
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
```

Wait for the Ingress Controller pods to be in Running state:

```bash
kubectl get pods -n ingress-nginx
```

Expected output:

```bash
NAME                                       READY   STATUS    RESTARTS   AGE
ingress-nginx-controller-xxxxxxxxxx-xxxxx   1/1     Running   0          1m
```

## Deploy a Sample Application
Now, let's deploy a simple application inside the cluster to test Ingress.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-world
  labels:
    app: hello-world
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hello-world
  template:
    metadata:
      labels:
        app: hello-world
    spec:
      containers:
      - name: hello-world
        image: ealen/echo-server
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: hello-world-service
spec:
  selector:
    app: hello-world
  ports:
  - protocol: TCP
    port: 80
    targetPort: 80
  type: ClusterIP
```

Apply this configuration:

```bash
kubectl apply -f hello-world.yaml
```

## Configure Ingress
Now, let's create an Ingress resource to route external traffic to our service.

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

Apply the Ingress resource:

```bash
kubectl apply -f ingress.yaml
```

## Test the Ingress
If you are using a domain, configure your DNS to point to the cluster’s external IP. If not, you can test using /etc/hosts:

```bash
echo "<INGRESS_IP> hello-world.local" | sudo tee -a /etc/hosts
curl http://hello-world.local
```

Expected reponse:
```json
{
  "host": "hello-world-service",
  "headers": { ... },
  "method": "GET"
}
```

## Conclusion

Using Kubernetes Ingress, you can efficiently expose services without relying on multiple LoadBalancers. With the Nginx Ingress Controller, routing HTTP traffic becomes easy and manageable. Try adding more rules to handle different paths or subdomains!

## References

Here are couple other articles that you can follow:
- [Install MetalLB](https://docs.k0sproject.io/v1.31.3+k0s.0/examples/metallb-loadbalancer/)
- [Insall Nginx Ingress](https://docs.k0sproject.io/v1.31.3+k0s.0/examples/nginx-ingress/)
