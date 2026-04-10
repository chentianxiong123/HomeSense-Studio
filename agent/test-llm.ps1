$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer sk-TeNQsX0g2bXB0odUnG6WngC0wDxS2Es1y4FduDS9IPWYMOvP"
}

$body = @{
    model = "gpt-5.1"
    messages = @(
        @{role = "user"; content = "你是谁" }
    )
    max_tokens = 200
}

$json = $body | ConvertTo-Json -Compress
$response = Invoke-RestMethod -Uri "http://new.xem8k5.top:3000/v1/chat/completions" -Method POST -Headers $headers -Body $json
Write-Host "Response:" $response
Write-Host "Content:" $response.choices[0].message.content
