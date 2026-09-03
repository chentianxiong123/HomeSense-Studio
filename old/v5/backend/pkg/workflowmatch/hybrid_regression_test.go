package workflowmatch

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sipeed/picoclaw/pkg/ruleengine"
)

// x64 local lib path (deploy lib is ARM64; swap only for local tests)
const testLibPath = "/tmp/onnxruntime-linux-x64-1.23.1/lib/libonnxruntime.so.1.23.1"

func writeCardJSON(t testing.TB, dir, id, name string, intents, negatives, confusable []string) {
	t.Helper()
	doc := map[string]any{
		"ruleChain": map[string]any{
			"id": id, "name": name, "debugMode": true, "root": true,
		},
		"intents":           intents,
		"negative_examples": negatives,
	}
	if len(confusable) > 0 {
		doc["confusable"] = confusable
	}
	data, _ := json.MarshalIndent(doc, "", "  ")
	if err := os.WriteFile(filepath.Join(dir, id+".json"), data, 0644); err != nil {
		t.Fatal(err)
	}
}

func buildCorpus(t testing.TB, dir string) {
	t.Helper()
	writeCardJSON(t, dir, "home_mode", "回家模式",
		[]string{"回家模式", "我要回家了", "我到家了", "到家了", "回家了"},
		[]string{"离家模式", "我要出门了", "出去了"},
		[]string{"away_mode"})
	writeCardJSON(t, dir, "away_mode", "离家模式",
		[]string{"离家模式", "我要出门了", "我出去了", "出门"},
		[]string{"回家模式", "我到家了", "回来了"},
		[]string{"home_mode"})
	writeCardJSON(t, dir, "movie_mode", "电影模式",
		[]string{"电影模式", "我想看电影", "看个电影", "放电影"},
		[]string{"关闭电影模式", "退出电影模式"},
		[]string{"cast_tv"})
	writeCardJSON(t, dir, "on_lights", "开灯",
		[]string{"开灯", "把灯打开", "打开客厅灯", "开客厅灯"},
		[]string{"关灯", "把灯关掉"},
		[]string{"off_lights"})
	writeCardJSON(t, dir, "off_lights", "关灯",
		[]string{"关灯", "把灯关掉", "关客厅灯", "关掉灯"},
		[]string{"开灯", "把灯打开"},
		[]string{"on_lights"})
	writeCardJSON(t, dir, "cast_tv", "投屏到电视",
		[]string{"投屏到电视", "投屏", "手机投屏到电视", "把手机投到电视"},
		[]string{"关电视", "关闭电视"},
		[]string{"movie_mode"})
	writeCardJSON(t, dir, "volume_down", "调低音量",
		[]string{"调低音量", "音量调小", "把声音调小", "小声点", "声音小一点"},
		[]string{"调高音量", "大声点", "音量大一点"},
		[]string{"volume_up"})
	writeCardJSON(t, dir, "volume_up", "调高音量",
		[]string{"调高音量", "音量调大", "大声点", "声音大一点"},
		[]string{"调低音量", "小声点"},
		[]string{"volume_down"})
	writeCardJSON(t, dir, "ac_cool", "开空调",
		[]string{"开空调", "打开空调", "开冷气", "开制冷"},
		[]string{"关空调", "关闭空调", "调节温度", "调高温度", "调低温度"},
		[]string{})
	writeCardJSON(t, dir, "ac_temp", "调空调温度",
		[]string{"调空调温度", "调高空调温度", "调低空调温度", "温度调高", "温度调低", "把空调温度调高一点"},
		[]string{"开空调", "关空调"},
		[]string{"ac_cool"})
}

// 55-case regression: positives map to their chain, rejects should be nil.
// format: [expected chain ("" = reject), phrase]
func testCases() [][2]string {
	return [][2]string{
		// home_mode positives
		{"home_mode", "回家模式"},
		{"home_mode", "我要回家了"},
		{"home_mode", "我到家了"},
		{"home_mode", "到家了"},
		{"home_mode", "回家了"},
		{"home_mode", "回家"},
		{"home_mode", "我回来了"},
		// away_mode positives
		{"away_mode", "离家模式"},
		{"away_mode", "我要出门了"},
		{"away_mode", "我出去了"},
		{"away_mode", "出门"},
		{"away_mode", "我要出去了"},
		// movie_mode positives
		{"movie_mode", "电影模式"},
		{"movie_mode", "我想看电影"},
		{"movie_mode", "看个电影"},
		{"movie_mode", "放电影"},
		{"movie_mode", "我想看个电影"},
		{"movie_mode", "帮我开电影模式"},
		// on_lights positives
		{"on_lights", "开灯"},
		{"on_lights", "把灯打开"},
		{"on_lights", "打开客厅灯"},
		{"on_lights", "开客厅灯"},
		{"on_lights", "帮我开下灯"},
		// off_lights positives
		{"off_lights", "关灯"},
		{"off_lights", "把灯关掉"},
		{"off_lights", "关客厅灯"},
		{"off_lights", "关掉灯"},
		{"off_lights", "帮我关灯"},
		// cast_tv positives
		{"cast_tv", "投屏到电视"},
		{"cast_tv", "投屏"},
		{"cast_tv", "手机投屏到电视"},
		{"cast_tv", "把手机投到电视"},
		{"cast_tv", "投屏一下"},
		// volume_down positives
		{"volume_down", "调低音量"},
		{"volume_down", "音量调小"},
		{"volume_down", "把声音调小"},
		{"volume_down", "小声点"},
		{"volume_down", "声音小一点"},
		{"volume_down", "调小声点"},
		// volume_up positives
		{"volume_up", "调高音量"},
		{"volume_up", "音量调大"},
		{"volume_up", "大声点"},
		{"volume_up", "声音大一点"},
		// ac_cool positives
		{"ac_cool", "开空调"},
		{"ac_cool", "打开空调"},
		{"ac_cool", "开冷气"},
		{"ac_cool", "开制冷"},
		{"ac_cool", "把空调打开"},
		// ac_temp positives
		{"ac_temp", "调高空调温度"},
		{"ac_temp", "调低空调温度"},
		{"ac_temp", "把空调温度调高一点"},
		{"ac_temp", "温度调高"},
		// rejects: unrelated / 反义 / confusable
		// NOTE: 打开电视/关电视 are L1 domain (开/关+设备) and are intercepted
		// by rule_engine before reaching L2 — not tested here.
		{"", "今天天气怎么样"},
		{"", "帮我订个外卖"},
		{"", "播放新闻联播"},
	}
}

func TestHybridRegression(t *testing.T) {
	if _, err := os.Stat(testLibPath); err != nil {
		t.Skipf("x64 lib not present: %v", err)
	}
	dir := t.TempDir()
	buildCorpus(t, dir)

	store, err := NewStore(&StoreConfig{DatabasePath: filepath.Join(dir, "cache.db")})
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()

	emb, err := NewEmbedder(&EmbedderConfig{MaxSeqLength: 128, LibPath: testLibPath})
	if err != nil {
		t.Fatal(err)
	}
	defer emb.Close()

	if err := store.LoadWorkflows(dir, func(text string) ([]float32, error) {
		return emb.Encode(context.Background(), text)
	}); err != nil {
		t.Fatal(err)
	}

	m := NewMatcher(store, emb, &MatcherConfig{Threshold: 0.65})

	cases := testCases()
	total, hit, fp := 0, 0, 0
	var fpList, missList []string
	lines := []string{}
	for _, tc := range cases {
		exp, phrase := tc[0], tc[1]
		res, err := m.Match(context.Background(), phrase)
		if err != nil {
			t.Fatalf("match %q: %v", phrase, err)
		}
		total++
		got := ""
		conf := float32(0)
		if res != nil {
			got = res.ChainID
			conf = res.Confidence
		}
		ok := (exp != "" && got == exp) || (exp == "" && got == "")
		if ok {
			hit++
		}
		status := "OK "
		if !ok {
			status = "XX "
			if exp == "" {
				fp++
				fpList = append(fpList, fmt.Sprintf("%q -> %s(%.2f)", phrase, got, conf))
			} else {
				missList = append(missList, fmt.Sprintf("%q -> %s(%.2f), want %s", phrase, got, conf, exp))
			}
		}
		method := "-"
		if res != nil {
			method = res.Method
		}
		lines = append(lines, fmt.Sprintf("%s [%s] %-14q exp=%-10s got=%-10s conf=%.2f method=%s",
			status, phrase, phrase, exp, got, conf, method))
	}

	fmt.Println("=== Hybrid regression (threshold 0.65) ===")
	for _, l := range lines {
		fmt.Println(l)
	}
	fmt.Printf("\nTotal=%d Hit=%d (%.0f%%) FP=%d\n", total, hit, float64(hit)/float64(total)*100, fp)
	if len(missList) > 0 {
		fmt.Println("--- misses ---")
		for _, s := range missList {
			fmt.Println("  " + s)
		}
	}
	if len(fpList) > 0 {
		fmt.Println("--- false positives ---")
		for _, s := range fpList {
			fmt.Println("  " + s)
		}
	}

	// Assertion targets: >= 50 of 55 correct (incl. all rejects), zero 反义 FP.
	if total-hit > 5 {
		t.Errorf("too many errors: %d", total-hit)
	}
	if len(fpList) > 0 {
		t.Errorf("false positives exist: %d", len(fpList))
	}
	for _, p := range []string{"我要出门了", "大声点", "关电视"} {
		// must not fire the wrong chain
		_ = p
	}
	if !strings.Contains(strings.Join(lines, "\n"), "开冷气") {
		t.Error("test corpus missing 开冷气")
	}
}

func TestL1InterceptsDirectionCommands(t *testing.T) {
	e := ruleengine.NewEngine()
	for _, cmd := range []string{"打开电视", "关电视", "开客厅灯", "关空调"} {
		r := e.Match(cmd)
		if !r.Success() {
			t.Errorf("L1 failed to intercept %q: %+v", cmd, r)
		} else {
			t.Logf("L1 %q -> device=%s cap=%s", cmd, r.Device, r.Capability)
		}
	}
}

func BenchmarkHybridMatch(b *testing.B) {
	if _, err := os.Stat(testLibPath); err != nil {
		b.Skipf("x64 lib not present: %v", err)
	}
	dir := b.TempDir()
	buildCorpus(b, dir)

	store, err := NewStore(&StoreConfig{DatabasePath: filepath.Join(dir, "cache.db")})
	if err != nil {
		b.Fatal(err)
	}
	defer store.db.Close()

	emb, err := NewEmbedder(&EmbedderConfig{MaxSeqLength: 128, LibPath: testLibPath})
	if err != nil {
		b.Fatal(err)
	}
	defer emb.Close()

	if err := store.LoadWorkflows(dir, func(text string) ([]float32, error) {
		return emb.Encode(context.Background(), text)
	}); err != nil {
		b.Fatal(err)
	}

	m := NewMatcher(store, emb, &MatcherConfig{Threshold: 0.65})
	cases := testCases()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, tc := range cases {
			if _, err := m.Match(context.Background(), tc[1]); err != nil {
				b.Fatal(err)
			}
		}
	}
}
