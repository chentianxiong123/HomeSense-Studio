package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sipeed/picoclaw/pkg/agent"
	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// ---------------------------------------------------------------------------
// Scenario-aware mock: based on real user intents, some turns request the
// real "exec" tool so the full LLM -> tool -> result -> second LLM pipeline
// is exercised, exactly like the real /mnt/shared/.picoclaw conversations.
// ---------------------------------------------------------------------------

type intent struct {
	keywords []string
	command  string // real shell command passed to exec tool
}

var intents = []intent{
	{[]string{"内存", "memory", "ram", "mem"}, "free -m && echo --- && ps -eo pid,rss,comm --sort=-rss | head -12"},
	{[]string{"进程", "进程状态", "ps", "运行状态"}, "ps -eo pid,pcpu,pmem,comm --sort=-pcpu | head -12"},
	{[]string{"推送", "git push", "push"}, "git status --short && git log --oneline -3"},
	{[]string{"聊天记录", "聊天", "记录"}, "ls -la sessions/ 2>/dev/null | head"},
	{[]string{"天气", "weather", "wttr"}, "curl -s 'wttr.in/?format=3' 2>/dev/null || echo weather-ok"},
	{[]string{"时间", "几点", "date", "time"}, "date '+%F %T %Z'"},
	{[]string{"磁盘", "disk", "df", "存储"}, "df -h / | tail -1"},
	{[]string{"网络", "net", "ping", "通不通"}, "ping -c1 -W1 8.8.8.8 2>&1 | tail -2 || echo net-ok"},
}

func matchIntent(msg string) *intent {
	for i := range intents {
		for _, kw := range intents[i].keywords {
			if strings.Contains(msg, kw) {
				return &intents[i]
			}
		}
	}
	return nil
}

type mockProvider struct {
	mu        sync.Mutex
	latency   time.Duration
	toolEvery int
	callCount int
	toolCalls atomic.Int64
}

func newMockProvider(latency time.Duration, toolEvery int) *mockProvider {
	return &mockProvider{latency: latency, toolEvery: toolEvery}
}

func (m *mockProvider) GetDefaultModel() string { return "mock-model" }

func (m *mockProvider) Chat(
	_ context.Context,
	messages []providers.Message,
	tools []providers.ToolDefinition,
	model string,
	_ map[string]any,
) (*providers.LLMResponse, error) {
	m.mu.Lock()
	m.callCount++
	call := m.callCount
	m.mu.Unlock()

	if m.latency > 0 {
		time.Sleep(m.latency)
	}

	lastUser := ""
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" && messages[i].Content != "" {
			lastUser = messages[i].Content
			break
		}
	}

	// If the last message is a tool result, this is the second LLM call of a
	// tool turn -> produce the final answer.
	if len(messages) > 0 && messages[len(messages)-1].Role == "tool" {
		trunc := messages[len(messages)-1].Content
		if len(trunc) > 120 {
			trunc = trunc[:120]
		}
		return &providers.LLMResponse{
			Content:      fmt.Sprintf("工具执行完成。结果: %s", trunc),
			FinishReason: "stop",
		}, nil
	}

	// Tool-call phase: if intent matches and the round counter says so,
	// request the real exec tool. toolEvery<=0 disables tool calls entirely.
	intentMatched := matchIntent(lastUser)
	shouldTool := m.toolEvery > 0 && intentMatched != nil
	if shouldTool && call%m.toolEvery != 0 {
		shouldTool = false
	}
	if shouldTool {
		m.toolCalls.Add(1)
		args, _ := json.Marshal(map[string]any{
			"action":  "run",
			"command": intentMatched.command,
		})
		return &providers.LLMResponse{
			Content:      "",
			FinishReason: "tool_calls",
			ToolCalls: []providers.ToolCall{
				{
					ID:   fmt.Sprintf("call_%08d", call),
					Type: "function",
					Function: &providers.FunctionCall{
						Name:      "exec",
						Arguments: string(args),
					},
				},
			},
		}, nil
	}

	// Plain answer.
	return &providers.LLMResponse{
		Content:      fmt.Sprintf("[%s] 收到: %s", model, lastUser),
		FinishReason: "stop",
	}, nil
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

type stats struct {
	mu        sync.Mutex
	latencies []time.Duration
	toolTurns atomic.Int64
	timeouts  atomic.Int64
	done      atomic.Int64
	heapAt    []uint64
	rssMax    uint64
}

func (s *stats) add(d time.Duration, tool bool) {
	s.mu.Lock()
	s.latencies = append(s.latencies, d)
	s.mu.Unlock()
	if tool {
		s.toolTurns.Add(1)
	}
	s.done.Add(1)
}

func (s *stats) sampleHeap() {
	rss := rssKB()
	s.mu.Lock()
	s.heapAt = append(s.heapAt, heapAlloc())
	if rss > s.rssMax {
		s.rssMax = rss
	}
	s.mu.Unlock()
}

func (s *stats) percentiles() (p50, p95, p99 time.Duration, n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n = len(s.latencies)
	if n == 0 {
		return 0, 0, 0, 0
	}
	xs := make([]time.Duration, n)
	copy(xs, s.latencies)
	sort.Slice(xs, func(i, j int) bool { return xs[i] < xs[j] })
	at := func(p float64) time.Duration { return xs[int(float64(n-1)*p)] }
	return at(0.5), at(0.95), at(0.99), n
}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

type sim struct {
	cfg        *config.Config
	bus        *bus.MessageBus
	loop       *agent.AgentLoop
	stats      *stats
	violations atomic.Int64
	userIDs    []string
	agentIDs   map[string]string
	subs       map[string]chan bus.OutboundMessage
	subsMu     sync.Mutex
	cancel     context.CancelFunc
	timeout    time.Duration
	rounds     int
	thinkMin   time.Duration
	thinkMax   time.Duration
}

func buildConfig(users int, workspaces, corpus string, maxParallel int) *config.Config {
	cfg := config.DefaultConfig()

	cfg.Agents.Defaults.ModelName = "mock-model"
	cfg.Agents.Defaults.MaxParallelTurns = maxParallel
	cfg.Agents.Defaults.SteeringMode = "one-at-a-time"
	cfg.Agents.Defaults.MaxToolIterations = 8
	cfg.Agents.Defaults.SummarizeMessageThreshold = 1000
	cfg.Agents.Defaults.ContextManager = "legacy"
	cfg.Session.Dimensions = []string{"chat"}

	os.MkdirAll(workspaces, 0o755)
	cfg.Agents.Dispatch = &config.DispatchConfig{}
	for i := 0; i < users; i++ {
		id := fmt.Sprintf("u%03d", i)
		ws := filepath.Join(workspaces, id)
		if err := os.MkdirAll(ws, 0o755); err != nil {
			log.Fatalf("workspace mkdir: %v", err)
		}
		// Seed real persona + skills into each user's workspace.
		seedWorkspace(ws, corpus)

		cfg.Agents.List = append(cfg.Agents.List, config.AgentConfig{
			ID:        id,
			Name:      fmt.Sprintf("user-%d", i),
			Workspace: ws,
		})
		cfg.Agents.Dispatch.Rules = append(cfg.Agents.Dispatch.Rules, config.DispatchRule{
			Name:  "route-" + id,
			Agent: id,
			When:  config.DispatchSelector{Sender: id},
		})
	}
	return cfg
}

func seedWorkspace(ws, corpus string) {
	if corpus == "" {
		return
	}
	for _, name := range []string{"SOUL.md", "AGENT.md"} {
		src := filepath.Join(corpus, name)
		if b, err := os.ReadFile(src); err == nil {
			os.WriteFile(filepath.Join(ws, name), b, 0o644)
		}
	}
	skillsSrc := filepath.Join(corpus, "skills")
	if st, err := os.Stat(skillsSrc); err == nil && st.IsDir() {
		// copy shallow (skill dirs contain SKILL.md)
		dst := filepath.Join(ws, "skills")
		os.MkdirAll(dst, 0o755)
		entries, _ := os.ReadDir(skillsSrc)
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			md := filepath.Join(skillsSrc, e.Name(), "SKILL.md")
			if b, err := os.ReadFile(md); err == nil {
				d := filepath.Join(dst, e.Name())
				os.MkdirAll(d, 0o755)
				os.WriteFile(filepath.Join(d, "SKILL.md"), b, 0o644)
			}
		}
	}
}

// userCorpus loads real user messages from a JSON file (one string per line).
func userCorpus(path string) []string {
	if path == "" {
		return nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		log.Printf("corpus load: %v", err)
		return nil
	}
	var out []string
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

func (s *sim) runUser(ctx context.Context, userID string, wg *sync.WaitGroup, corpus []string) {
	defer wg.Done()

	agentID := s.agentIDs[userID]
	chatID := "chat_" + userID
	myCh := s.subscribe(chatID)
	defer s.unsubscribe(chatID)

	for r := 0; r < s.rounds; r++ {
		var content string
		if len(corpus) > 0 && rand.Intn(2) == 0 {
			content = corpus[rand.Intn(len(corpus))]
		} else {
			content = fmt.Sprintf("%s 第%d次提问: 看看现在内存状态", userID, r+1)
		}

		inbound := bus.InboundMessage{
			Channel:  "cli",
			SenderID: userID,
			ChatID:   chatID,
			Content:  content,
			Context: bus.InboundContext{
				Channel:  "cli",
				ChatID:   chatID,
				SenderID: userID,
			},
		}

		start := time.Now()
		if err := s.bus.PublishInbound(ctx, inbound); err != nil {
			log.Printf("[%s] publish error: %v", userID, err)
			return
		}

		isTool := matchIntent(content) != nil
		if ok := s.awaitResponse(ctx, userID, agentID, chatID, start, myCh, isTool); !ok {
			return
		}

		pause := s.thinkMin + time.Duration(rand.Int63n(int64(s.thinkMax-s.thinkMin)))
		select {
		case <-ctx.Done():
			return
		case <-time.After(pause):
		}
	}
}

func (s *sim) subscribe(chatID string) chan bus.OutboundMessage {
	s.subsMu.Lock()
	defer s.subsMu.Unlock()
	ch := make(chan bus.OutboundMessage, 64)
	s.subs[chatID] = ch
	return ch
}

func (s *sim) unsubscribe(chatID string) {
	s.subsMu.Lock()
	defer s.subsMu.Unlock()
	delete(s.subs, chatID)
}

func (s *sim) pump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case om := <-s.bus.OutboundChan():
			s.subsMu.Lock()
			ch, ok := s.subs[om.ChatID]
			s.subsMu.Unlock()
			if !ok {
				continue
			}
			select {
			case ch <- om:
			default:
				log.Printf("!! DROPPED outbound for %s (queue full)", om.ChatID)
			}
		}
	}
}

func (s *sim) awaitResponse(
	ctx context.Context,
	userID, agentID, chatID string,
	start time.Time,
	myCh chan bus.OutboundMessage,
	isTool bool,
) bool {
	timer := time.NewTimer(s.timeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-timer.C:
			s.stats.timeouts.Add(1)
			log.Printf("[%s] TIMEOUT waiting response", userID)
			return true
		case om := <-myCh:
			if om.AgentID != "" && om.AgentID != agentID {
				s.violations.Add(1)
				log.Printf("!! ISOLATION VIOLATION user=%s chat=%s got agent=%s want=%s",
					userID, chatID, om.AgentID, agentID)
			}
			s.stats.add(time.Since(start), isTool)
			return true
		}
	}
}

func run(users, rounds, maxParallel int, mockLatency time.Duration, toolEvery int, timeout time.Duration, thinkMin, thinkMax time.Duration, workspaces, corpus, corpusMsgs string) error {
	rand.Seed(time.Now().UnixNano())

	cfg := buildConfig(users, workspaces, corpus, maxParallel)
	mb := bus.NewMessageBus()
	mock := newMockProvider(mockLatency, toolEvery)

	loop := agent.NewAgentLoop(cfg, mb, mock)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		if err := loop.Run(ctx); err != nil {
			log.Printf("agent loop exited: %v", err)
		}
	}()

	s := &sim{
		cfg:      cfg,
		bus:      mb,
		loop:     loop,
		stats:    &stats{},
		subs:     make(map[string]chan bus.OutboundMessage),
		userIDs:  make([]string, 0, users),
		agentIDs: make(map[string]string, users),
		cancel:   cancel,
		timeout:  timeout,
		rounds:   rounds,
		thinkMin: thinkMin,
		thinkMax: thinkMax,
	}
	for i := 0; i < users; i++ {
		uid := fmt.Sprintf("u%03d", i)
		s.userIDs = append(s.userIDs, uid)
		s.agentIDs[uid] = uid
	}
	go s.pump(ctx)

	corpusMsgsList := userCorpus(corpusMsgs)

	var heapBefore uint64
	var wg sync.WaitGroup
	go func() {
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.stats.sampleHeap()
			}
		}
	}()

	heapBefore = heapAlloc()
	for _, uid := range s.userIDs {
		wg.Add(1)
		go s.runUser(ctx, uid, &wg, corpusMsgsList)
	}
	wg.Wait()

	heapEnd := heapAlloc()
	s.stats.sampleHeap()
	p50, p95, p99, n := s.stats.percentiles()
	done := s.stats.done.Load()
	var heapMax uint64
	s.stats.mu.Lock()
	for _, h := range s.stats.heapAt {
		if h > heapMax {
			heapMax = h
		}
	}
	s.stats.mu.Unlock()

	fmt.Printf("\n=== usersim result (real scenario) ===\n")
	fmt.Printf("users=%d rounds/user=%d max_parallel=%d mock_latency=%v tool_every=%d\n",
		users, rounds, maxParallel, mockLatency, toolEvery)
	fmt.Printf("turns completed : %d (tool_turns=%d, timeouts=%d, violations=%d)\n",
		done, mock.toolCalls.Load(), s.stats.timeouts.Load(), s.violations.Load())
	fmt.Printf("turn latency     : p50=%v p95=%v p99=%v (n=%d)\n", p50, p95, p99, n)
	fmt.Printf("heap             : before=%dKB peak=%dKB end=%dKB (delta=+%dKB)\n",
		heapBefore/1024, heapMax/1024, heapEnd/1024, (heapMax-heapBefore)/1024)
	s.stats.mu.Lock()
	rssMax := s.stats.rssMax
	s.stats.mu.Unlock()
	fmt.Printf("rss peak         : %dKB\n", rssMax)
	fmt.Printf("num goroutines   : %d\n", ngoroutines())
	if n > 0 {
		total := time.Duration(0)
		s.stats.mu.Lock()
		for _, d := range s.stats.latencies {
			total += d
		}
		s.stats.mu.Unlock()
		if total > 0 {
			fmt.Printf("throughput       : %.1f turns/sec (elapsed_sum=%v)\n",
				float64(done)/total.Seconds(), total)
		}
	}
	return nil
}

func ngoroutines() int {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return runtime.NumGoroutine()
}

func heapAlloc() uint64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return m.HeapAlloc
}

// rssKB reads peak resident set size from /proc/self/status.
func rssKB() uint64 {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				var v uint64
				fmt.Sscanf(fields[1], "%d", &v)
				return v
			}
		}
	}
	return 0
}

func main() {
	users := flag.Int("users", 16, "number of virtual users")
	rounds := flag.Int("rounds", 20, "turns per user")
	maxParallel := flag.Int("parallel", 8, "MaxParallelTurns (0/1 = sequential)")
	latencyMS := flag.Int("mock-latency-ms", 30, "mock provider latency in ms")
	toolEvery := flag.Int("tool-every", 2, "request real exec tool every N matching turns (0=never)")
	timeoutSec := flag.Int("timeout-sec", 60, "per-turn timeout")
	thinkMinMS := flag.Int("think-min-ms", 150, "min human-like pause between turns")
	thinkMaxMS := flag.Int("think-max-ms", 1200, "max human-like pause between turns")
	workspaces := flag.String("workspaces", "/tmp/usersim-ws", "base dir for per-agent workspaces")
	corpus := flag.String("corpus", "/tmp/opencode/corpus", "dir with SOUL.md/AGENT.md/skills to seed per-user workspace")
	corpusMsgs := flag.String("corpus-msgs", "", "file with real user messages (one per line)")
	flag.Parse()

	if *users <= 0 {
		fmt.Println("users must be > 0")
		os.Exit(1)
	}
	thinkMin := time.Duration(*thinkMinMS) * time.Millisecond
	thinkMax := time.Duration(*thinkMaxMS) * time.Millisecond
	if thinkMax <= thinkMin {
		thinkMax = thinkMin + time.Millisecond
	}

	if err := run(*users, *rounds, *maxParallel,
		time.Duration(*latencyMS)*time.Millisecond, *toolEvery,
		time.Duration(*timeoutSec)*time.Second, thinkMin, thinkMax,
		*workspaces, *corpus, *corpusMsgs); err != nil {
		fmt.Fprintln(os.Stderr, "usersim:", err)
		os.Exit(1)
	}
}
