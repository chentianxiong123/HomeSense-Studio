import { getMessagesPage } from "./src/tools/memory/chatDb.js";

console.log("测试游标分页...");

// 测试 1: 获取最新 20 条
const page1 = getMessagesPage(20, "latest");
console.log("\n=== 测试 1: 获取最新 20 条 ===");
console.log("返回消息数:", page1.messages.length);
console.log("oldestCursorId:", page1.pageInfo.oldestCursorId);
console.log("newestCursorId:", page1.pageInfo.newestCursorId);
console.log("hasOlder:", page1.pageInfo.hasOlder);
console.log("hasNewer:", page1.pageInfo.hasNewer);

if (page1.messages.length > 0) {
  // 测试 2: 使用游标获取更早的消息
  const cursorId = page1.pageInfo.oldestCursorId;
  if (cursorId != null) {
    const page2 = getMessagesPage(20, "older", cursorId);
    console.log("\n=== 测试 2: 使用游标获取更早的消息 ===");
    console.log("游标 ID:", cursorId);
    console.log("返回消息数:", page2.messages.length);
    console.log("oldestCursorId:", page2.pageInfo.oldestCursorId);
    console.log("newestCursorId:", page2.pageInfo.newestCursorId);
    console.log("hasOlder:", page2.pageInfo.hasOlder);
    
    if (page2.messages.length > 0) {
      console.log("\n第一条消息 ID:", page2.messages[0].id);
      console.log("最后一条消息 ID:", page2.messages[page2.messages.length - 1].id);
      console.log("应该小于游标 ID:", cursorId);
    }
  }
}

console.log("\n测试完成");
