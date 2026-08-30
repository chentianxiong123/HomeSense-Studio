const r = await fetch('http://localhost:3000/api/chat', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({text: '打开B站'})
});
const d = await r.json();
console.log(JSON.stringify(d, null, 2));
