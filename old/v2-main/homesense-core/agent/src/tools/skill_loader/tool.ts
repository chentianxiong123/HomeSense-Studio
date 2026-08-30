import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { readSkillSection, type SkillRegistryEntry } from "../skillsRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, "..");

export interface GrepSkillOptions {
  keywords: string[];
  capabilities?: string[];
  exposureLevel?: "summary" | "detail" | "progressive";
  maxResults?: number;
}

function getAllSkillFiles(): Array<{ tool: string; section: string; path: string }> {
  const results: Array<{ tool: string; section: string; path: string }> = [];
  const toolDirs = readdirSync(TOOLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const toolDir of toolDirs) {
    const skillsPath = join(TOOLS_DIR, toolDir.name, "skills");
    if (!existsSync(skillsPath)) continue;

    const skillFiles = readdirSync(skillsPath)
      .filter((f) => f.endsWith(".md"));

    for (const file of skillFiles) {
      const section = file.replace(".md", "");
      results.push({
        tool: toolDir.name,
        section,
        path: join(skillsPath, file),
      });
    }
  }

  return results;
}

export function grepSkills(options: GrepSkillOptions): SkillRegistryEntry[] {
  const { keywords, capabilities, exposureLevel, maxResults = 5 } = options;
  const allFiles = getAllSkillFiles();
  const matches: SkillRegistryEntry[] = [];

  for (const file of allFiles) {
    const entry = readSkillSection(TOOLS_DIR, file.tool, file.section);
    if (!entry) continue;

    const raw = readFileSync(file.path, "utf-8");
    const keywordMatch = keywords.some((keyword) => raw.includes(keyword));

    if (!keywordMatch) continue;

    if (capabilities && capabilities.length > 0) {
      const hasCapability = entry.metadata?.capabilities?.some((cap) =>
        capabilities.includes(cap)
      );
      if (!hasCapability) continue;
    }

    if (exposureLevel && entry.metadata?.exposure_level && entry.metadata.exposure_level !== exposureLevel) {
      continue;
    }

    matches.push(entry);
    if (matches.length >= maxResults) break;
  }

  return matches;
}

export function loadSkillsByKeywords(input: string, maxResults: number = 5): { loadedSkills: string[]; skillContents: string } {
  const keywords = extractKeywords(input);
  if (keywords.length === 0) {
    return { loadedSkills: [], skillContents: "" };
  }

  const matches = grepSkills({ keywords, maxResults });
  const loadedSkills = matches.map((m) => m.ref);
  const skillContents = matches
    .map((m) => `## ${m.ref}\n${m.content}`)
    .join("\n\n");

  return { loadedSkills, skillContents };
}

function extractKeywords(input: string): string[] {
  const stopWords = new Set(["我", "想", "要", "的", "了", "吗", "呢", "吧", "啊", "哦", "嗯", "在", "上", "下", "中", "和", "与", "或", "不", "也", "都", "就", "还", "又", "很", "太", "这", "那", "它", "他", "她", "把", "被", "让", "给", "对", "从", "到", "用", "可以", "能", "会", "请", "帮", "为", "什么", "怎么", "如何"]);

  const segments = input
    .replace(/[，。！？、；：""''（）【】《》\s]/g, " ")
    .split(/\s+/)
    .filter((s) => s.length > 0 && !stopWords.has(s));

  const bigrams: string[] = [];
  for (let i = 0; i < input.length - 1; i++) {
    const bigram = input.substring(i, i + 2);
    if (!stopWords.has(bigram) && !/[\s，。！？、；：""''（）【】《》]/.test(bigram)) {
      bigrams.push(bigram);
    }
  }

  return Array.from(new Set([...segments, ...bigrams]));
}
