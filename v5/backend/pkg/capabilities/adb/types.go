package adb

import (
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Command struct {
	Bin     string
	Args    []string
	Timeout time.Duration
}

func run(cmd Command) (string, string, int) {
	timeout := cmd.Timeout
	if timeout == 0 {
		timeout = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	c := exec.CommandContext(ctx, cmd.Bin, cmd.Args...)
	out, err := c.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return "", "TIMEOUT", -1
	}
	if err != nil {
		errOut := string(out)
		if strings.Contains(errOut, "device offline") || strings.Contains(errOut, "device unauthorized") {
			return "", errOut, -2
		}
		if ee, ok := err.(*exec.ExitError); ok {
			return string(out), errOut, ee.ExitCode()
		}
		return "", errOut, -1
	}
	return string(out), "", 0
}

func shell(device string, cmd string, timeout time.Duration) (string, string, int) {
	args := []string{"shell", cmd}
	if device != "" {
		args = []string{"-s", device, "shell", cmd}
	}
	return run(Command{Bin: "adb", Args: args, Timeout: timeout})
}

func deviceCmd(device string, args ...string) (string, string, int) {
	cmdArgs := []string{}
	if device != "" {
		cmdArgs = append(cmdArgs, "-s", device)
	}
	cmdArgs = append(cmdArgs, args...)
	return run(Command{Bin: "adb", Args: cmdArgs})
}

type Device struct {
	Serial string `json:"serial"`
	State  string `json:"state"`
}

var (
	reIP       = regexp.MustCompile(`\d+\.\d+\.\d+\.\d+`)
	reRes      = regexp.MustCompile(`Physical size:\s*(\d+x\d+)`)
	reDensity  = regexp.MustCompile(`Physical density:\s*(\d+)`)
	reCurrent  = regexp.MustCompile(`act=(\S+)/(\S+)`)
)

type Request struct {
	Action   string `json:"action"`
	Device   string `json:"device,omitempty"`
	Path     string `json:"path,omitempty"`
	Dir      string `json:"dir,omitempty"`
	DstPath  string `json:"dst_path,omitempty"`
	DstDir   string `json:"dst_dir,omitempty"`
	X        int    `json:"x,omitempty"`
	Y        int    `json:"y,omitempty"`
	X1       int    `json:"x1,omitempty"`
	Y1       int    `json:"y1,omitempty"`
	X2       int    `json:"x2,omitempty"`
	Y2       int    `json:"y2,omitempty"`
	Text     string `json:"text,omitempty"`
	Key      string `json:"key,omitempty"`
	Package  string `json:"package,omitempty"`
	Timeout  int    `json:"timeout,omitempty"`
	Radius   int    `json:"radius,omitempty"`
	Duration int    `json:"duration,omitempty"`
	SrcFile  string `json:"src_file,omitempty"`
	DestFile string `json:"dest_file,omitempty"`
}

func keyEvent(name string) int {
	m := map[string]int{
		"back": 4, "home": 3, "enter": 66, "menu": 82,
		"volume_up": 25, "volume_down": 24, "power": 26,
		"wake": 26, "tab": 61, "space": 62, "delete": 67,
	}
	if v, ok := m[strings.ToLower(name)]; ok {
		return v
	}
	if v, err := strconv.Atoi(name); err == nil {
		return v
	}
	return 0
}

func fail(code, msg string) map[string]any {
	return map[string]any{"status": "error", "error": code, "message": msg}
}
