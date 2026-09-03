// 模拟前端加载逻辑测试
async function testScrollLoading() {
  console.log("=== 测试滚动加载逻辑 ===\n");
  
  // 第1次：获取最新20条
  console.log("1. 获取最新20条...");
  const res1 = await fetch('http://localhost:3000/api/messages?limit=20&direction=latest');
  const data1 = await res1.json();
  console.log("   返回:", data1.data.messages.length, "条");
  console.log("   oldestCursorId:", data1.data.pageInfo.oldestCursorId);
  console.log("   hasOlder:", data1.data.pageInfo.hasOlder);
  
  if (data1.data.pageInfo.hasOlder && data1.data.pageInfo.oldestCursorId) {
    // 第2次：获取更早的20条
    console.log("\n2. 使用游标", data1.data.pageInfo.oldestCursorId, "获取更早20条...");
    const res2 = await fetch(`http://localhost:3000/api/messages?limit=20&direction=older&cursorId=${data1.data.pageInfo.oldestCursorId}`);
    const data2 = await res2.json();
    console.log("   返回:", data2.data.messages.length, "条");
    console.log("   oldestCursorId:", data2.data.pageInfo.oldestCursorId);
    console.log("   hasOlder:", data2.data.pageInfo.hasOlder);
    
    if (data2.data.messages.length > 0) {
      console.log("\n   消息ID范围:", data2.data.messages[0].id, "-", data2.data.messages[data2.data.messages.length-1].id);
      console.log("   应该都小于游标", data1.data.pageInfo.oldestCursorId);
    }
  }
  
  console.log("\n=== 测试完成 ===");
}

testScrollLoading().catch(console.error);
