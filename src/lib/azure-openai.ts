import { createAzure } from "@ai-sdk/azure";

function buildAzure() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!endpoint) throw new Error("AZURE_OPENAI_ENDPOINT is not set");
  return createAzure({
    resourceName: new URL(endpoint).hostname.split(".")[0],
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
  });
}

export function getGpt4o() {
  return buildAzure()(process.env.AZURE_OPENAI_GPT4O_DEPLOYMENT ?? "gpt-4o");
}

export function getEmbeddingModel() {
  return buildAzure().textEmbeddingModel(
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ?? "text-embedding-3-small"
  );
}
