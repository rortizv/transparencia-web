import { createAzure } from "@ai-sdk/azure";

const azure = createAzure({
  resourceName: new URL(process.env.AZURE_OPENAI_ENDPOINT!).hostname.split(".")[0],
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
});

export const gpt4o = azure(process.env.AZURE_OPENAI_GPT4O_DEPLOYMENT ?? "gpt-4o");

export const embeddingModel = azure.textEmbeddingModel(
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ?? "text-embedding-3-small"
);
