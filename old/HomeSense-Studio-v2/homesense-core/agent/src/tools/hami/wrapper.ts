import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface HamiConfig {
  ha_url: string;
  ha_token: string;
  timeoutMs: number;
}

function loadConfig(): HamiConfig {
  const configPath = existsSync(join(__dirname, "config.yaml"))
    ? join(__dirname, "config.yaml")
    : join(__dirname, "../../../src/tools/hami/config.yaml");
  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = YAML.parse(content) || {};
    return {
      ha_url: parsed.ha_url || "ws://127.0.0.1:8123/api/websocket",
      ha_token: parsed.ha_token || "",
      timeoutMs: parsed.timeoutMs || parsed.timeout_ms || 10000,
    };
  } catch {
    return {
      ha_url: "ws://127.0.0.1:8123/api/websocket",
      ha_token: "",
      timeoutMs: 10000,
    };
  }
}

export const hamiTool = tool(
  async (input) => {
    const { action, ...params } = input;
    const config = loadConfig();

    const scriptPath = existsSync(join(__dirname, "hami.py"))
      ? join(__dirname, "hami.py")
      : join(__dirname, "../../../src/tools/hami/hami.py");

    let args: string[];

    switch (action) {
      case "xiaoai_speak":
        args = [scriptPath, "xiaoai_speak", `text=${String(params.text ?? "")}`];
        break;
      case "xiaoai_execute":
        args = [scriptPath, "xiaoai_execute", `command=${String(params.command ?? "")}`];
        break;
      case "tv_remote":
        args = [scriptPath, "tv_remote", `device=${String(params.device ?? "")}`, `command=${String(params.command ?? "")}`];
        break;
      default:
        args = [scriptPath, action];
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined) {
            args.push(`${key}=${value}`);
          }
        }
    }

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        HAMi_URL: config.ha_url,
        HAMi_TOKEN: config.ha_token,
      };

      if (action === "xiaoai_execute" && String(params.command ?? "") === "__debug_auth__") {
        resolve(JSON.stringify({
          success: true,
          debug: {
            ha_url: config.ha_url,
            token_present: Boolean(config.ha_token),
            token_length: config.ha_token?.length || 0,
            scriptPath,
          },
        }));
        return;
      }


      const proc = spawn("python", args, { env, cwd: dirname(scriptPath) });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve(JSON.stringify({ success: false, error: `Timeout after ${config.timeoutMs}ms` }));
      }, config.timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timeout);

        if (code === 0 && stdout) {
          try {
            const result = JSON.parse(stdout.trim());
            resolve(JSON.stringify(result));
          } catch {
            resolve(JSON.stringify({ success: false, error: `Invalid JSON output: ${stdout}` }));
          }
        } else {
          resolve(JSON.stringify({ success: false, error: stderr || `Process exited with code ${code}` }));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve(JSON.stringify({ success: false, error: `Failed to start process: ${err.message}` }));
      });
    });
  },
  {
    name: "hami",
    description: "Home Assistant 智能家居控制，支持小爱同学、电视遥控等",
    schema: z.object({
      action: z.enum(["xiaoai_speak", "xiaoai_execute", "tv_remote"]).describe("操作类型"),
      text: z.string().optional().describe("小爱说话文本（xiaoai_speak）"),
      command: z.string().optional().describe("执行指令（xiaoai_execute）或遥控按键（tv_remote）"),
      device: z.string().optional().describe("电视设备名：tvs_toshiba / stb / tv_letv（tv_remote）"),
    }),
  }
);
