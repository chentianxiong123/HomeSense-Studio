import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  const configPath = join(__dirname, "src/tools/hami/config.yaml");
  const content = readFileSync(configPath, "utf-8");
  return YAML.parse(content);
}

async function test() {
  console.log("测试 xiaoai_execute...");
  
  const config = loadConfig();
  console.log("Config:", config);
  
  const scriptPath = join(__dirname, "src/tools/hami/hami.py");
  
  const env = {
    ...process.env,
    HAMi_URL: config.ha_url,
    HAMi_TOKEN: config.ha_token,
  };
  
  console.log("HAMi_URL:", env.HAMi_URL);
  console.log("HAMi_TOKEN length:", env.HAMi_TOKEN?.length);
  
  const proc = spawn("python", [scriptPath, "xiaoai_execute", "command=播放音乐"], { env });
  
  let stdout = "";
  let stderr = "";
  
  proc.stdout.on("data", (data) => { stdout += data.toString(); });
  proc.stderr.on("data", (data) => { stderr += data.toString(); });
  
  proc.on("close", (code) => {
    console.log("Exit code:", code);
    console.log("Stdout:", stdout);
    if (stderr) console.log("Stderr:", stderr);
  });
}

test().catch(console.error);
