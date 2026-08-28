import { hamiTool } from "./src/tools/hami/wrapper.js";

async function test() {
  console.log("测试 xiaoai_execute...");
  
  const result = await hamiTool.invoke({
    action: "xiaoai_execute",
    command: "播放音乐"
  });
  
  console.log("结果:", result);
}

test().catch(console.error);
