$body = @'
{"text":"打开B站"}
'@
Invoke-WebRequest -Uri 'http://localhost:3000/api/chat' -Method POST -Body $body -ContentType 'application/json'
