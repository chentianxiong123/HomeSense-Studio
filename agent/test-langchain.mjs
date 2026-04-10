import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

async function test() {
  console.log("Testing LangChain ChatOpenAI...");
  
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    apiKey: "sk-d468157c3ae2fa0b2ecc59e1f0c37048e69af3766c85e467585bfca04cb75918",
    configuration: { 
      baseURL: "https://daidai.rxwysystem.com"
    },
    temperature: 0,
    timeout: 30000,
    maxRetries: 1,
  });

  console.log("Model created, invoking...");
  
  try {
    const response = await model.invoke([
      new SystemMessage("你是一个助手，简短回复"),
      new HumanMessage("你是谁？"),
    ]);
    
    console.log("Response type:", typeof response);
    console.log("Response:", JSON.stringify(response, null, 2).slice(0, 500));
    console.log("Content:", response?.content);
  } catch (e) {
    console.log("Error type:", e?.constructor?.name);
    console.log("Error message:", e?.message);
    console.log("Error stack:", e?.stack?.slice(0, 500));
    console.log("Full error:", e);
  }
}

test();
