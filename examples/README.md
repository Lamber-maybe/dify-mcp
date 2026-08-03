# dify-mcp Workflow Templates

This directory contains ready-made Dify workflow graph JSON templates to help you quickly test, build, and deploy workflows using `dify-mcp`.

## Available Templates

| File | Structure | Description |
|------|-----------|-------------|
| [`echo-input.json`](./echo-input.json) / [`minimal-workflow.json`](./minimal-workflow.json) | `start` → `end` | Echoes input text directly to the output. Useful for basic connectivity testing. |
| [`simple-llm.json`](./simple-llm.json) / [`llm-workflow.json`](./llm-workflow.json) | `start` → `llm` → `answer` | Passes user input to an LLM node and streams the answer. |
| [`rag-pipeline.json`](./rag-pipeline.json) / [`rag-workflow.json`](./rag-workflow.json) | `start` → `knowledge-retrieval` → `llm` → `answer` | Retrieves relevant document context from Dify datasets before feeding it into the LLM. |

## Usage Guide

You can use these templates via the `difywf` CLI or through your AI agent using MCP tools.

### 1. Offline Graph Validation

Before uploading a graph to Dify, validate its structure, node references, and connectivity offline:

```bash
difywf wf validate --graph examples/minimal-workflow.json
difywf wf validate --graph examples/llm-workflow.json
difywf wf validate --graph examples/rag-workflow.json
```

### 2. Syncing & Testing a Workflow

#### Step A: Create or locate your Dify app
```bash
# Create a new workflow app
difywf app create --mode workflow --name "my-example-workflow"
```

#### Step B: Sync the draft workflow graph
```bash
# Preview changes with dry-run (optional)
difywf wf draft sync <app-id> --graph examples/minimal-workflow.json --dry-run

# Save draft to Dify
difywf wf draft sync <app-id> --graph examples/minimal-workflow.json
```

#### Step C: Test-run the draft
```bash
difywf wf test <app-id> --input input_text="Hello from dify-mcp!"
```

#### Step D: Publish the workflow
```bash
difywf wf publish <app-id> --yes
```

### 3. Customizing the Templates

- **Node Schemas**: To check default settings and properties for any node type, run:
  ```bash
  difywf wf node defaults <app-id> <node-type>
  ```
- **Dataset IDs in RAG**: Replace `"sample-dataset-id"` or `"YOUR_DATASET_ID"` in RAG templates with your actual Dify dataset ID (`difywf rag list` to view dataset IDs).
- **Model Configs**: Adjust model provider or model name (e.g. `gpt-4o-mini`, `claude-3-5-sonnet`) under the `model` object in LLM nodes.
