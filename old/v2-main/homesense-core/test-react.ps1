[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$r = Invoke-RestMethod -Uri 'http://localhost:3000/api/chat' -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes('{"text":"打开B站"}')) -ContentType 'application/json; charset=utf-8'
$r.data | ConvertTo-Json -Depth 5
