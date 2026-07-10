import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface WebSearchConfig {
  provider: string;
  apiKey: string;
  maxResults: number;
  timeoutMs: number;
}

function loadConfig(): WebSearchConfig {
  const configPath = join(__dirname, "config.yaml");
  try {
    const content = readFileSync(configPath, "utf-8");
    return YAML.parse(content);
  } catch {
    return {
      provider: "duckduckgo",
      apiKey: "",
      maxResults: 5,
      timeoutMs: 10000,
    };
  }
}

interface SearchResult {
  title: string;
  snippet?: string;
  url?: string;
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<{ results: SearchResult[] }> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  
  const response = await fetch(url);
  const data = await response.json() as { RelatedTopics?: Array<{ Text?: string; FirstURL?: string }> };
  
  const results: SearchResult[] = (data.RelatedTopics || [])
    .filter((topic) => topic.Text && topic.FirstURL)
    .slice(0, maxResults)
    .map((topic) => ({
      title: topic.Text?.split(" - ")[0] || "",
      snippet: topic.Text,
      url: topic.FirstURL,
    }));

  return { results };
}

export const webSearchTool = tool(
  async (input) => {
    const { query, maxResults } = input;
    const config = loadConfig();

    if (!query) {
      return JSON.stringify({ success: false, error: "Missing query" });
    }

    const results = maxResults || config.maxResults;

    try {
      let searchResult: { results: SearchResult[] };

      switch (config.provider) {
        case "duckduckgo":
        default:
          searchResult = await duckDuckGoSearch(query, results);
          break;
      }

      return JSON.stringify({
        success: true,
        query,
        results: searchResult.results,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Search failed: ${error}`,
      });
    }
  },
  {
    name: "web_search",
    description: "联网搜索，获取实时信息",
    schema: z.object({
      query: z.string().describe("搜索查询"),
      maxResults: z.number().optional().describe("最大结果数"),
    }),
  }
);
