import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
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
      timeoutMs: parsed.timeoutMs || parsed.timeout_ms || parsed.device?.timeout_ms || 30000,
    };
  } catch {
    return {
      deviceIp: "127.0.0.1",
      devicePort: 5555,
      adbPath: "adb",
      timeoutMs: 30000,
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

    const command = { action, ...params };
    const jsonArg = JSON.stringify(command);

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        TV_IP: config.deviceIp,
        TV_PORT: String(config.devicePort),
        ADB_PATH: config.adbPath,
      };

      const proc = spawn("python", [scriptPath, "run", jsonArg], {
        env,
        cwd: dirname(scriptPath),
      });

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
        resolve(JSON.stringify({ status: "error", error: `Timeout after ${config.timeoutMs}ms` }));
      }, config.timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timeout);

        if (stdout) {
          try {
            const result = JSON.parse(stdout.trim());
            resolve(JSON.stringify(result));
          } catch {
            resolve(JSON.stringify({ status: "error", error: `Invalid JSON output: ${stdout}` }));
          }
        } else {
          resolve(JSON.stringify({ status: "error", error: stderr || `Process exited with code ${code}` }));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve(JSON.stringify({ status: "error", error: `Failed to start process: ${err.message}` }));
      });
    });
  },
  {
    name: "adb",
    description: `ADB CLI - 安卓设备控制工具。使用 JSON 格式命令。

核心工作流：
1. 观察: get_ui_elements 查看屏幕内容
2. 行动: tap_element, input_text, press_key 等
3. 再观察: 屏幕变化后重新获取 UI 元素

可用操作：
- list_devices, connect, disconnect, ensure_connected
- screenshot, get_ui_elements, get_display_size
- tap, tap_ratio, swipe, tap_element
- input_text, press_key, back, home, enter
- launch_app, get_current_app, list_packages, check_package
- find_element, wait
- ocr_recognize (需配置 perception.ocr.enabled: true)
- vision_understand (需配置 perception.multimodal.enabled: true)`,
    schema: z.object({
      action: z.enum([
        "list_devices",
        "devices",
        "connect",
        "disconnect",
        "ensure_connected",
        "screenshot",
        "get_screenshot",
        "get_display_size",
        "get_ui_elements",
        "ui_elements",
        "get_ui_tree",
        "tap",
        "tap_ratio",
        "swipe",
        "tap_element",
        "input_text",
        "type",
        "press_key",
        "key",
        "back",
        "home",
        "enter",
        "launch_app",
        "launch",
        "get_current_app",
        "current_app",
        "list_packages",
        "list_apps",
        "check_package",
        "find_element",
        "find_text",
        "wait",
        "ocr_recognize",
        "ocr",
        "vision_understand",
        "vision",
      ]).describe("操作类型"),
      x: z.number().optional().describe("tap 的 x 坐标"),
      y: z.number().optional().describe("tap 的 y 坐标"),
      x_ratio: z.number().optional().describe("tap_ratio 的 x 比例 (0-1)"),
      y_ratio: z.number().optional().describe("tap_ratio 的 y 比例 (0-1)"),
      start_x: z.number().optional().describe("swipe 起始 x"),
      start_y: z.number().optional().describe("swipe 起始 y"),
      end_x: z.number().optional().describe("swipe 结束 x"),
      end_y: z.number().optional().describe("swipe 结束 y"),
      duration: z.number().optional().describe("swipe 持续时间(ms)"),
      text: z.string().optional().describe("input_text 的文本 或 tap_element/find_element 的元素文本"),
      index: z.number().optional().describe("tap_element 的元素索引"),
      key: z.string().optional().describe("press_key 的按键名"),
      package: z.string().optional().describe("launch_app/check_package 的包名"),
      package_name: z.string().optional().describe("launch_app 的包名 (别名)"),
      keyword: z.string().optional().describe("list_packages 的关键词"),
      seconds: z.number().optional().describe("wait 的秒数"),
      path: z.string().optional().describe("screenshot 的保存路径"),
      refresh: z.boolean().optional().describe("tap_element 是否刷新 UI 缓存"),
      question: z.string().optional().describe("vision_understand 提出的问题"),
    }),
  }
);
