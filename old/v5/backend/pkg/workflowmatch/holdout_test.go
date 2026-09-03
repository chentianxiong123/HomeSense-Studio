package workflowmatch

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// Hold-out generalization test:
// - Cards only carry 2-3 CORE anchors (the "safe" phrasings).
// - Test phrases are REAL colloquial variants deliberately NOT in the cards.
// - Measures true generalization (BM25/embedding), not fingerprint rote hits.
//
// NO hard assertions: this is a data-collection run. Human reads the table.
func TestHoldOutGeneralization(t *testing.T) {
	if _, err := os.Stat(testLibPath); err != nil {
		t.Skipf("x64 lib not present: %v", err)
	}
	dir := t.TempDir()
	writeHoldOutCards(t, dir)

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
	_ = m

	cases := [][2]string{
		// home_mode — cards: ["回家","我要回家了","我到家了"]
		{"home_mode", "我回家了"},
		{"home_mode", "到家了"},
		{"home_mode", "回来了"},
		{"home_mode", "我回到家了"},
		{"home_mode", "下班回来了"},
		// away_mode — cards: ["离家","我要出门了","我出去了"]
		{"away_mode", "出门了"},
		{"away_mode", "我出门去了"},
		{"away_mode", "打开离家模式"},
		{"away_mode", "出门上班"},
		{"away_mode", "离开家"},
		// movie_mode — cards: ["电影","我想看电影","看个电影"]
		{"movie_mode", "看电影"},
		{"movie_mode", "我想看个电影"},
		{"movie_mode", "放个电影"},
		{"movie_mode", "打开电影模式"},
		{"movie_mode", "今晚看部电影"},
		// on_lights — cards: ["开灯","把灯打开","开客厅灯"]
		{"on_lights", "帮我开下灯"},
		{"on_lights", "开下灯"},
		{"on_lights", "把客厅灯亮起来"},
		{"on_lights", "打开客厅的灯"},
		{"on_lights", "灯打开"},
		// off_lights — cards: ["关灯","把灯关掉","关客厅灯"]
		{"off_lights", "帮我关下灯"},
		{"off_lights", "关下灯"},
		{"off_lights", "把客厅灯灭了"},
		{"off_lights", "熄灯"},
		{"off_lights", "灯关上"},
		// cast_tv — cards: ["投屏","投屏到电视","手机投屏到电视"]
		{"cast_tv", "投一下屏"},
		{"cast_tv", "把手机投到大屏"},
		{"cast_tv", "投屏手机"},
		{"cast_tv", "手机投屏"},
		{"cast_tv", "投屏到大屏"},
		// volume_down — cards: ["调低音量","音量调小","把声音调小"]
		{"volume_down", "小声点"},
		{"volume_down", "把声音弄小一点"},
		{"volume_down", "声音小点"},
		{"volume_down", "音量要小"},
		{"volume_down", "给我调小声"},
		// volume_up — cards: ["调高音量","音量调大","大声点"]
		{"volume_up", "把声音放大"},
		{"volume_up", "声音大点"},
		{"volume_up", "调大声"},
		{"volume_up", "音量放大"},
		{"volume_up", "再来大点声"},
		// ac_cool — cards: ["开空调","打开空调","开冷气"]
		{"ac_cool", "把空调打开"},
		{"ac_cool", "开下空调"},
		{"ac_cool", "空调开开"},
		{"ac_cool", "制冷"},
		{"ac_cool", "开一下制冷"},
		// hard rejects — should be nil
		{"", "今天天气怎么样"},
		{"", "帮我订个外卖"},
		{"", "播放新闻联播"},
		{"", "我要睡觉了"},
		{"", "电视机怎么开"},
		{"", "手机没电了"},
	}

	for _, i := range []int{0} {
		_ = i
	}

	lines := []string{}
	hit, total := 0, 0
	var miss, fp []string
	for _, tc := range cases {
		exp, phrase := tc[0], tc[1]
		res, err := m.Match(context.Background(), phrase)
		if err != nil {
			t.Fatalf("match %q: %v", phrase, err)
		}
		total++
		got, conf, method := "", float32(0), "-"
		if res != nil {
			got, conf, method = res.ChainID, res.Confidence, res.Method
		}
		ok := (exp != "" && got == exp) || (exp == "" && got == "")
		if ok {
			hit++
		}
		status := "OK "
		if !ok {
			status = "XX "
			if exp == "" {
				fp = append(fp, fmt.Sprintf("  FP  %-14q -> %s (%.2f, %s)", phrase, got, conf, method))
			} else {
				miss = append(miss, fmt.Sprintf("  MISS %-14q -> %-10s (%.2f, %s) want=%s", phrase, got, conf, method, exp))
			}
		}
		lines = append(lines, fmt.Sprintf("%s [%s] %-12q want=%-10s got=%-10s conf=%.2f %s",
			status, phrase, phrase, exp, got, conf, method))
	}
	fmt.Println("=== HOLD-OUT (cards=2-3 anchors, phrases NOT in cards, thr 0.65) ===")
	for _, l := range lines {
		fmt.Println(l)
	}
	fmt.Printf("\nTotal=%d Hit=%d (%.0f%%)\n", total, hit, float64(hit)/float64(total)*100)
	fmt.Println("--- misses ---")
	for _, s := range miss {
		fmt.Println(s)
	}
	fmt.Println("--- false positives ---")
	for _, s := range fp {
		fmt.Println(s)
	}
}

// writeHoldOutCards puts only 2-3 core anchors per intent, so the match has
// NO chance of a fingerprint rote hit on the hold-out phrases.
func writeHoldOutCards(t testing.TB, dir string) {
	t.Helper()
	cards := []struct {
		id, name      string
		intents       []string
		negatives     []string
		confusable    []string
	}{
		{"home_mode", "回家", []string{"回家", "我要回家了", "我到家了"}, []string{"离家", "我要出门了"}, []string{"away_mode"}},
		{"away_mode", "离家", []string{"离家", "我要出门了", "我出去了"}, []string{"回家", "我到家了"}, []string{"home_mode"}},
		{"movie_mode", "电影", []string{"电影", "我想看电影", "看个电影"}, []string{"关电影模式"}, []string{"cast_tv"}},
		{"on_lights", "开灯", []string{"开灯", "把灯打开", "开客厅灯"}, []string{"关灯", "把灯关掉"}, []string{"off_lights"}},
		{"off_lights", "关灯", []string{"关灯", "把灯关掉", "关客厅灯"}, []string{"开灯", "把灯打开"}, []string{"on_lights"}},
		{"cast_tv", "投屏", []string{"投屏", "投屏到电视", "手机投屏到电视"}, []string{"关电视"}, []string{"movie_mode"}},
		{"volume_down", "调低音量", []string{"调低音量", "音量调小", "把声音调小"}, []string{"调高音量", "大声点"}, []string{"volume_up"}},
		{"volume_up", "调高音量", []string{"调高音量", "音量调大", "大声点"}, []string{"调低音量", "小声点"}, []string{"volume_down"}},
		{"ac_cool", "开空调", []string{"开空调", "打开空调", "开冷气"}, []string{"关空调", "调节温度"}, []string{}},
	}
	for _, c := range cards {
		doc := map[string]any{
			"ruleChain": map[string]any{"id": c.id, "name": c.name, "debugMode": true, "root": true},
			"intents":   c.intents, "negative_examples": c.negatives,
		}
		if len(c.confusable) > 0 {
			doc["confusable"] = c.confusable
		}
		data, _ := json.MarshalIndent(doc, "", "  ")
		if err := os.WriteFile(filepath.Join(dir, c.id+".json"), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
}