package ipc

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type Response struct {
	Code       int    `json:"code"`
	Data       any    `json:"data,omitempty"`
	Error      string `json:"error,omitempty"`
	Message    string `json:"message,omitempty"`
	Retryable  bool   `json:"retryable,omitempty"`
	DurationMS int64  `json:"duration_ms"`
}

func Success(started time.Time, data any) {
	write(Response{
		Code:       0,
		Data:       data,
		DurationMS: time.Since(started).Milliseconds(),
	})
}

func Failure(started time.Time, code int, errCode string, message string, retryable bool) {
	if code == 0 {
		code = 1
	}
	write(Response{
		Code:       code,
		Error:      errCode,
		Message:    message,
		Retryable:  retryable,
		DurationMS: time.Since(started).Milliseconds(),
	})
}

func write(resp Response) {
	raw, err := json.Marshal(resp)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to encode response: %v\n", err)
		fmt.Println(`{"code":1,"error":"ENCODE_ERROR","message":"failed to encode response","duration_ms":0}`)
		return
	}
	fmt.Println(string(raw))
}
