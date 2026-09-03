// 测试后端 API
fetch('http://localhost:3000/api/messages?limit=20&direction=latest')
  .then(r => r.json())
  .then(data => {
    console.log("=== 测试 1: 获取最新 20 条 ===");
    console.log("返回消息数:", data.data.messages.length);
    console.log("oldestCursorId:", data.data.pageInfo.oldestCursorId);
    console.log("hasOlder:", data.data.pageInfo.hasOlder);
    
    if (data.data.messages.length > 0 && data.data.pageInfo.oldestCursorId) {
      const cursorId = data.data.pageInfo.oldestCursorId;
      return fetch(`http://localhost:3000/api/messages?limit=20&direction=older&cursorId=${cursorId}`)
        .then(r => r.json())
        .then(data2 => {
          console.log("\n=== 测试 2: 使用游标获取更早的消息 ===");
          console.log("游标 ID:", cursorId);
          console.log("返回消息数:", data2.data.messages.length);
          console.log("oldestCursorId:", data2.data.pageInfo.oldestCursorId);
          console.log("hasOlder:", data2.data.pageInfo.hasOlder);
          
          if (data2.data.messages.length > 0) {
            console.log("\n第一条消息 ID:", data2.data.messages[0].id);
            console.log("最后一条消息 ID:", data2.data.messages[data2.data.messages.length - 1].id);
            console.log("应该小于游标 ID:", cursorId);
          }
        });
    }
  })
  .catch(console.error);
