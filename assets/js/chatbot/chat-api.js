/*
  BlogChat API seam — MOCK implementation.
  Part 3 of the build-log series replaces the internals of sendMessage()
  with a fetch to the Lambda endpoint. The handler contract must not change.

  window.BlogChat.sendMessage(messages, handlers) -> { abort() }
    messages: [{ role: 'user' | 'assistant', content: string }, ...]
    handlers: { onDelta(chunk), onSources([{title, url}]), onDone(), onError(err) }
    Callers must abort() the previous handle before calling sendMessage again.
*/

(function () {
  'use strict';

  var STREAM_DELAY_MS = 40;
  var THINKING_DELAY_MS = 700;

  var FALLBACK = {
    answer:
      'I have not written about that yet, so I will not guess. ' +
      'You can browse everything I have published in the [archives](/archives/), ' +
      'or try one of the suggested topics below the input.',
    sources: []
  };

  var CATALOG = [
    {
      keywords: ['k0s', 'homelab', 'set up a cluster'],
      answer:
        'I run my homelab Kubernetes cluster on **k0s** — a single-binary, ' +
        'zero-friction distribution. The short version:\n\n' +
        '- Install the k0s binary on the controller node\n' +
        '- `k0s install controller --single` for a single-node setup\n' +
        '- `k0s start`, then grab the kubeconfig with `k0s kubeconfig admin`\n\n' +
        'The full walkthrough, including worker nodes, is in the post below.',
      sources: [
        { title: 'Set up a K8s cluster using k0s', url: '/posts/set-up-k8s-cluster-using-k0s/' }
      ]
    },
    {
      keywords: ['ingress', 'gateway', 'nginx'],
      answer:
        'Ingress NGINX was retired on **March 24, 2026** — no more releases or CVE patches. ' +
        'I migrated my cluster to **Gateway API** with Envoy Gateway: a `Gateway` resource ' +
        'owns ports and TLS, and an `HTTPRoute` replaces each old `Ingress`. ' +
        'My migration walkthrough covers the YAML translation and the common pitfalls.',
      sources: [
        {
          title: 'Ingress NGINX is Dead — Migrating to Gateway API',
          url: '/posts/ingress-nginx-retired-migrating-to-gateway-api/'
        },
        { title: 'Set up a Nginx Ingress on K8s (outdated)', url: '/posts/set-up-nginx-ingress-on-k8s/' }
      ]
    },
    {
      keywords: ['certbot', 'wildcard', 'certificate', 'tls', 'https'],
      answer:
        'For wildcard certificates I use **Certbot** with a DNS-01 challenge — ' +
        'you prove domain ownership via a TXT record, which is the only challenge ' +
        'type that works for `*.yourdomain.com`. The post walks through the full flow.',
      sources: [
        {
          title: 'Using Certbot to generate certificate for wildcard domain',
          url: '/posts/using-certbot-to-generate-ceritificate-for-wildcard-domain/'
        }
      ]
    },
    {
      keywords: ['jupyter', 'plotly', 'notebook'],
      answer:
        'I wrote about getting **Plotly** rendering properly inside **JupyterLab** — ' +
        'the extension setup and the renderer configuration that makes interactive ' +
        'charts actually show up.',
      sources: [
        { title: 'Setup Jupyter with Plotly', url: '/posts/setup-jupyter-with-plotly/' }
      ]
    },
    {
      keywords: ['cert', 'exam', 'saa', 'associate', 'study'],
      answer:
        'I passed the **AWS Solutions Architect Associate** and published my cheatsheet. ' +
        'This year I am working toward two more: the **Developer Associate** and the ' +
        '**Data Engineer Associate** — I committed to both publicly in my Tết post.',
      sources: [
        { title: 'AWS SAA Cheatsheet', url: '/posts/aws-saa-cheatsheet/' },
        { title: 'Happy Lunar New Year — Year of the Horse!', url: '/posts/happy-new-year-of-the-horse/' }
      ]
    },
    {
      keywords: ['built', 'website', 'jekyll', 'blog setup', 'how was this'],
      answer:
        'This blog is a static **Jekyll** site using the Chirpy theme, hosted on AWS: ' +
        '**S3** for storage, **CloudFront** as CDN, and **Route53** for DNS. ' +
        'I documented the whole build in a three-part series — Part 1 below is the place to start.',
      sources: [
        { title: 'How I built this website? - Jekyll and AWS (Part 1)', url: '/posts/how-i-built-this-website-part-1/' }
      ]
    },
    {
      keywords: ['chatbot', 'rag', 'assistant', 'who are you'],
      answer:
        'You are talking to it! I am the blog assistant Nga is building in public. ' +
        'The plan: a **RAG** pipeline — blog posts chunked and embedded into a FAISS index ' +
        'on S3, served by a Lambda function calling Bedrock. Right now I am running on ' +
        'mock answers while the UI gets polished. Follow the build-log series for the real thing.',
      sources: [
        {
          title: 'Building a Chatbot for This Blog — Part 1',
          url: '/posts/building-a-chatbot-for-my-blog-part-1/'
        }
      ]
    },
    {
      keywords: ['aws', 'bedrock', 'cloud', 's3', 'lambda'],
      answer:
        'I write about AWS regularly — most recently a curated take on the **2026 announcements** ' +
        'that actually matter for builders: OpenAI models and Codex on Bedrock, Cognito ' +
        'multi-Region replication, and more.',
      sources: [
        { title: 'AWS in 2026: The Announcements That Actually Matter', url: '/posts/aws-2026-announcements-that-matter/' }
      ]
    }
  ];

  function findEntry(text) {
    var q = text.toLowerCase();

    for (var i = 0; i < CATALOG.length; i += 1) {
      for (var j = 0; j < CATALOG[i].keywords.length; j += 1) {
        if (q.indexOf(CATALOG[i].keywords[j]) !== -1) {
          return CATALOG[i];
        }
      }
    }
    return null;
  }

  function sendMessage(messages, handlers) {
    var aborted = false;
    var last = messages[messages.length - 1];
    var text = last && typeof last.content === 'string' ? last.content : '';

    if (text.indexOf('__fail__') !== -1) {
      setTimeout(function () {
        if (!aborted) {
          handlers.onError(new Error('Simulated API failure'));
        }
      }, THINKING_DELAY_MS);
      return {
        abort: function () {
          aborted = true;
        }
      };
    }

    var entry = findEntry(text) || FALLBACK;
    var words = entry.answer.split(' ');
    var index = 0;

    function tick() {
      if (aborted) {
        return;
      }
      if (index >= words.length) {
        if (entry.sources.length > 0) {
          handlers.onSources(entry.sources);
        }
        handlers.onDone();
        return;
      }
      handlers.onDelta((index === 0 ? '' : ' ') + words[index]);
      index += 1;
      setTimeout(tick, STREAM_DELAY_MS);
    }

    setTimeout(tick, THINKING_DELAY_MS);

    return {
      abort: function () {
        aborted = true;
      }
    };
  }

  window.BlogChat = {
    sendMessage: sendMessage,
    _findEntry: findEntry
  };
})();
