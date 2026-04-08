import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface AdbConfig {
  deviceIp: string;
  devicePort: number;
  adbPath: string;
  timeoutMs: number;
  strategy?: Record<string, unknown>;
  perception?: Record<string, unknown>;
}

function loadConfig(): AdbConfig {
  const configPath = existsSync(join(__dirname, "config.yaml"))
    ? join(__dirname, "config.yaml")
    : join(__dirname, "../../../src/tools/adb/config.yaml");
  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = YAML.parse(content) || {};
    return {
      deviceIp: parsed.deviceIp || parsed.device?.ip || "127.0.0.1",
      devicePort: parsed.devicePort || parsed.device?.port || 5555,
      adbPath: parsed.adbPath || parsed.device?.adb_path || "adb",
      timeoutMs: parsed.timeoutMs || parsed.timeout_ms || parsed.device?.timeout_ms || 10000,
      strategy: parsed.strategy,
      perception: parsed.perception,
    };
  } catch {
    return {
      deviceIp: "127.0.0.1",
      devicePort: 5555,
      adbPath: "adb",
      timeoutMs: 10000,
    };
  }
}

export const adbTool = tool(
  async (input) => {
    const { action, ...params } = input;
    const config = loadConfig();

    const scriptPath = existsSync(join(__dirname, "adb.py"))
      ? join(__dirname, "adb.py")
      : join(__dirname, "../../../src/tools/adb/adb.py");
    const args = [scriptPath, action];
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        args.push(`${key}=${value}`);
      }
    }

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        TV_IP: config.deviceIp,
        TV_PORT: String(config.devicePort),
        ADB_PATH: config.adbPath,
      };

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
    name: "adb",
    description: "安卓设备控制，支持 tap、swipe、input_text、press_key、open_app、screenshot 等操作",
    schema: z.object({
      action: z.enum([
        "tap",
        "swipe",
        "input_text",
        "press_key",
        "key_event",
        "open_app",
        "back",
        "home",
        "enter",
        "screenshot",
        "get_ui_tree",
        "get_current_app",
        "find_text",
        "click_element",
        "ocr_local",
        "ocr_api",
        "multimodal_understand",
        "list_apps",
        "list_devices",
        "connect",
        "disconnect",
        "turn_on_tv",
        "turn_on_stb",
        "check_bilibili_installed",
        "open_dangbei",
        "search_bilibili",
        "install_bilibili",
        "open_bilibili",
      ]).describe("操作类型"),
      x: z.number().optional().describe("tap/swipe 的 x 坐标"),
      y: z.number().optional().describe("tap/swipe 的 y 坐标"),
      x1: z.number().optional().describe("swipe 起始 x"),
      y1: z.number().optional().describe("swipe 起始 y"),
      x2: z.number().optional().describe("swipe 结束 x"),
      y2: z.number().optional().describe("swipe 结束 y"),
      duration: z.number().optional().describe("swipe 持续时间"),
      text: z.string().optional().describe("input_text 的文本"),
      key: z.string().optional().describe("press_key 的按键名"),
      keycode: z.number().optional().describe("key_event 的键码"),
      package: z.string().optional().describe("open_app 的包名"),
      keyword: z.string().optional().describe("list_apps 的关键词"),
      ip: z.string().optional().describe("connect/disconnect 的 IP"),
      port: z.number().optional().describe("connect/disconnect 的端口"),
    }),
  }
);
