---
title: "Building a Chatbot for This Blog — Part 1: The Plan and the Architecture"
author: nga
date: 2026-05-15 10:00:00 +0700
categories: [AI Generated, AI]
tags: [ai, chatbot, rag, aws, python, ai-generated]
render_with_liquid: false
---

Back in January, I wrote that 2026 was going to be the year I finally built a chatbot for this blog. Then in February, during Tết, I doubled down on it publicly — said I wanted "a small AI-powered companion that can help you find articles, answer questions based on what I have written, and generally make navigating the content here a lot easier." The Horse energy was strong that day.

It is now May. The Horse is still running. And I am finally writing the first build log.

This series is going to document the real process — the decisions, the dead ends, and the eventual working thing. Part 1 is all about figuring out what we are actually building and why I made the architecture choices I did. No code deployed yet. Just a solid plan, which is honestly where most projects go wrong anyway.

## What this chatbot actually needs to do

Before picking any tools, I wrote down the requirements as plainly as I could. Here is what I landed on.

**Answer questions grounded in real posts.** If you ask "how do you set up a k0s cluster?" the bot should pull from what I actually wrote, not hallucinate a confident but wrong answer. Grounding every response in source material — and linking back to the original post — is non-negotiable.

**Help readers discover related content.** The blog has posts scattered across Kubernetes, AWS, and general life stuff. A reader who finds the nginx ingress post might not know the k0s cluster post exists. The bot should surface connections that the static navigation does not.

**Cost nearly nothing to run idle.** This is a personal blog. I am not going to pay a monthly fee for a service that handles maybe a dozen queries on a good day. The target is effectively zero cost when idle, with costs that scale only when someone actually uses it.

**Not invent posts that do not exist.** This one sounds obvious, but it is surprisingly easy to get wrong. If a reader asks about something I have never written about, the bot needs to say so honestly rather than fabricating a plausible-sounding article.

Those four requirements point clearly toward a **Retrieval-Augmented Generation** (RAG) architecture. The short version: you embed your documents into a vector store, embed the user's question the same way, find the most relevant documents by similarity, then give those documents to a language model as context for its answer. The model generates from what it can see, not from its training memory. Citations come naturally because you know exactly which chunks were retrieved.

## Comparing the realistic options

I looked at three approaches seriously before deciding.

### Option 1: Amazon Bedrock Knowledge Bases

AWS launched Bedrock Knowledge Bases a while back, and in 2026 the managed agent story there has gotten genuinely good — OpenAI models are starting to show up on Bedrock in preview alongside Anthropic's Claude, which is a nice sign of where the platform is going. The appeal is obvious: upload your documents, configure a data source, and AWS handles chunking, embedding, vector storage, and retrieval for you. No servers to manage.

The problem is cost structure. Bedrock Knowledge Bases charges for storage and for every query, even at low volume. For a blog that might get a handful of chatbot queries per week, the baseline costs are hard to justify. There is also the learning angle — I would be configuring a managed service, not understanding the pieces underneath it. That feels like the wrong trade for a project where the learning is half the point.

### Option 2: Self-hosted FastAPI + vector DB on the k0s homelab

I already run a k0s cluster on my homelab (the setup is documented in earlier posts on this blog). I could deploy a FastAPI service there alongside a vector database like Qdrant or Chroma, run the whole RAG stack on my own hardware, and expose it through the Envoy Gateway I migrated to back in March.

This is genuinely appealing from a learning standpoint. I would get hands-on with Kubernetes-native deployments of ML workloads, vector database operations, and service mesh considerations. The cost is basically electricity.

The catch is reliability. My homelab goes down sometimes. A chatbot on a personal blog failing occasionally is acceptable, but building something that I then have to babysit feels like it defeats the purpose. I also do not want to route user traffic through my home IP address permanently.

### Option 3: Serverless Lambda + S3 embedded vector store

This is the one I am going with. The idea is a lightweight serverless backend: an AWS Lambda function that handles chat requests, a pre-built vector index stored as a file in S3, and a model API call (likely Claude via Bedrock, or possibly OpenAI via Bedrock once it is generally available) to generate the final answer.

The ingestion pipeline — the part that reads my posts, chunks them, and builds the vector index — runs separately, either locally or as a triggered Lambda, and writes the resulting index file to S3. The chat Lambda reads that file cold on startup and keeps it in memory for the duration of the invocation.

Cost profile: Lambda charges only for invocations. S3 storage for a vector index of a small blog is a few cents per month. There is no idle cost. The blog itself is already on S3 and CloudFront, so I am staying in the same infrastructure I know.

The learning value is high but in a focused way — I will get into embedding models, vector similarity search, and prompt engineering for grounded responses, without the operational overhead of a long-running service.

## The chosen architecture

Here is what the system looks like at a high level:

```
INGESTION (runs offline / on post publish)
_posts/*.md
    |
    v
[ Parser + Chunker ]  -- respects headings, splits long sections
    |
    v
[ Embedding model ]   -- e.g. Amazon Titan Embeddings or text-embedding-3-small
    |
    v
[ Vector index file ] -- stored in S3 as index.faiss + metadata.json


QUERY (runs on user request)
User question
    |
    v
[ Lambda: load index from S3 ]
    |
    v
[ Embed question + similarity search ] -- top-k chunks retrieved
    |
    v
[ Build prompt with retrieved chunks ]
    |
    v
[ LLM call (Bedrock / Claude) ]
    |
    v
Answer + source links  -->  Chat widget on blog
```

The widget itself will be a small piece of JavaScript embedded in the Jekyll layout, calling the Lambda via a CloudFront-fronted API Gateway endpoint. The blog stays fully static — the chatbot is purely an add-on layer.

## Sketching the ingestion pipeline

The ingestion side is where the interesting engineering decisions live. My posts are Markdown files with YAML front matter. I need to parse them, split them into chunks that preserve semantic meaning, embed each chunk, and save the index.

The main consideration for chunking is respecting the heading structure. A chunk that cuts in the middle of a section is worse than a chunk that ends at a heading boundary, because the heading gives the retrieval model important context about what the chunk is about.

Here is a rough sketch of what the chunker will look like:

```python
import re
from pathlib import Path
from dataclasses import dataclass

@dataclass
class Chunk:
    text: str
    source_file: str
    heading: str
    post_title: str
    post_url: str

def chunk_post(filepath: Path) -> list[Chunk]:
    raw = filepath.read_text(encoding="utf-8")

    # Strip YAML front matter
    body = re.sub(r"^---.*?---\s*", "", raw, flags=re.DOTALL)

    # Extract title from front matter for metadata
    title_match = re.search(r"^title:\s*[\"']?(.+?)[\"']?\s*$", raw, re.MULTILINE)
    title = title_match.group(1) if title_match else filepath.stem

    # Split on H2 headings, keeping the heading with its content
    sections = re.split(r"(?=^## )", body, flags=re.MULTILINE)

    chunks = []
    for section in sections:
        if not section.strip():
            continue
        heading_match = re.match(r"^## (.+)", section)
        heading = heading_match.group(1) if heading_match else "Introduction"
        chunks.append(Chunk(
            text=section.strip(),
            source_file=str(filepath),
            heading=heading,
            post_title=title,
            post_url=filepath_to_url(filepath),
        ))
    return chunks
```

This is deliberately simple for now. In Part 2, I will refine it — handle nested headings, add sliding-window overlap for better retrieval continuity, and wire it up to an actual embedding model and FAISS index builder.

## What is coming in Part 2 and Part 3

Part 2 will be the full ingestion pipeline: parsing all posts, chunking them properly, calling an embedding model, building a FAISS index, and uploading everything to S3. I will also write a small evaluation script that lets me query the index locally before any Lambda work happens — a sanity check that retrieval is actually finding the right posts.

Part 3 will be the chat API itself: the Lambda function, the prompt template, the Bedrock call, and the JavaScript widget that drops into the Jekyll layout. That is also where I will tackle the "do not hallucinate posts that do not exist" requirement properly — through careful prompt design and retrieval thresholds.

## A note on the moment we are in

It is hard to write about building an AI feature in 2026 without acknowledging how normalized this work has become. A Pragmatic Engineer survey earlier this year found that around 73% of engineering teams are using AI coding tools daily — up from 41% a year ago. AI is not a novelty anymore; it is just part of the toolbox. I think that actually makes projects like this one more interesting, not less. Everyone has access to the same managed services and API calls. The differentiation is in the details — what you choose to build, how you constrain the system, and whether the thing actually works well for your specific use case.

A blog chatbot grounded strictly in what I have written is a small thing. But small, well-scoped things that actually work are exactly what I want to build more of.

---

If you have built something similar — especially a RAG system on Lambda, or with a creative approach to the vector store — I would genuinely love to hear about it. Drop a comment or find me wherever the internet puts me these days. And if you have been waiting for the chatbot since Tết, thanks for your patience. We are getting there.

See you in Part 2.
