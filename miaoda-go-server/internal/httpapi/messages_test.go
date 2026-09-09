package httpapi

import (
	"strings"
	"testing"
)

func TestInterviewPromptEnforcesSpeakableAnswerLength(t *testing.T) {
	got := messages(answerReq{Question: "什么是哈希表？", Language: "Chinese"})
	if len(got) == 0 {
		t.Fatal("expected prompt messages")
	}
	system, _ := got[0].Content.(string)
	for _, want := range []string{"普通技术问题 120-220 个汉字", "任何答案不得超过 300 个汉字", "不要使用 Markdown"} {
		if !strings.Contains(system, want) {
			t.Fatalf("system prompt missing %q", want)
		}
	}
}

func TestInterviewPromptUsesEnglishWordLimits(t *testing.T) {
	system := messages(answerReq{Question: "What is a hash table?", Language: "English"})[0].Content.(string)
	for _, want := range []string{"40-80 words", "120-220 words", "never exceed 240 words"} {
		if !strings.Contains(system, want) {
			t.Fatalf("English system prompt missing %q", want)
		}
	}
	if strings.Contains(system, "任何答案不得超过 300 个汉字") {
		t.Fatal("English answers must not inherit the Chinese character limit")
	}
}

func TestInterviewPromptUsesKnowledgeBaseAnswerLogic(t *testing.T) {
	system := messages(answerReq{Question: "数组和链表有什么区别？", Language: "Chinese"})[0].Content.(string)
	for _, want := range []string{
		"继承本地题库的回答逻辑",
		"一句话给核心结论",
		"用相同维度比较双方",
		"现象与指标 → 缩小范围 → 定位原因 → 修复并验证",
		"背景或问题 → 我的职责与方案 → 关键实现或取舍 → 结果与复盘",
		"追问题：直接承接最近对话回答新增部分",
	} {
		if !strings.Contains(system, want) {
			t.Fatalf("system prompt missing knowledge-base style rule %q", want)
		}
	}
}

func TestWrittenCodePromptKeepsCompleteSolutionOutsideInterviewLimit(t *testing.T) {
	prompt := writtenSolvePrompt("code", "Java")
	for _, want := range []string{"QUESTION_TYPE 为 code", "QUESTION_TYPE 为 non_code", "选择/判断/行测/智力题", "完整且可直接编译运行", "不要套用面试口述答案的字数限制", "不得为了缩短内容省略实现", "复杂度分析"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("written code prompt missing %q", want)
		}
	}
	if strings.Contains(prompt, "不得超过 300 个汉字") {
		t.Fatal("written code answers must not inherit the interview hard limit")
	}
}

func TestWrittenLeetCodePromptRequestsCoreCodeWithoutACMIO(t *testing.T) {
	prompt := writtenSolvePrompt("leetcode", "Java")
	for _, want := range []string{"QUESTION_TYPE 为 code", "QUESTION_TYPE 为 non_code", "选择/判断/行测/智力题", "LeetCode（力扣）核心代码模式", "class Solution", "禁止输出 Main/main 程序入口", "禁止读取标准输入", "核心方法"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("written LeetCode prompt missing %q", want)
		}
	}
	if strings.Contains(prompt, "提供完整程序入口") {
		t.Fatal("LeetCode mode must not inherit the ACM program-entry requirement")
	}
}

func TestWrittenShortcutValidationAppliesCodeRulesOnlyToCodeQuestions(t *testing.T) {
	nonCode := writtenTypeMarker + "\nnon_code\n" + writtenQuestionMarker + "\n下列哪项正确？\n" + writtenAnswerMarker + "\n答案：A\n解析：符合题意。"
	if !validateWrittenOutput("code", nonCode) || !validateWrittenOutput("leetcode", nonCode) {
		t.Fatal("both shortcut modes must accept a correctly classified non-code answer")
	}

	acm := writtenTypeMarker + "\ncode\n" + writtenQuestionMarker + "\n求两数之和\n" + writtenAnswerMarker + "\n```java\npublic class Main { public static void main(String[] args) {} }\n```\n思路：直接计算。"
	if !validateWrittenOutput("code", acm) {
		t.Fatal("ACM shortcut must accept a complete-program answer for a code question")
	}
	if validateWrittenOutput("leetcode", acm) {
		t.Fatal("core-code shortcut must reject Main for a code question")
	}
}

func TestWrittenAutoPromptClassifiesCommonExamQuestionTypes(t *testing.T) {
	prompt := writtenSolvePrompt("auto", "Java")
	for _, want := range []string{
		"先在内部判断题型",
		"LeetCode/力扣",
		"ACM/ICPC 模式",
		"单选题、多选题、判断题、行测题或智力题",
		"计算题、简答题或其他题型",
		"只解答当前最主要且内容完整的题目",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("written auto prompt missing %q", want)
		}
	}
}

func TestCompactInterviewAnswerRemovesMarkdownAndEnforcesHardLimit(t *testing.T) {
	input := "# **结论**\n\n- " + strings.Repeat("这是需要压缩的面试回答。", 40)
	got := compactInterviewAnswer(input, interviewAnswerMaxRunesChinese)
	if strings.Contains(got, "**") || strings.Contains(got, "#") || strings.Contains(got, "\n\n") {
		t.Fatalf("markdown or blank lines were not removed: %q", got)
	}
	if len([]rune(got)) > interviewAnswerMaxRunesChinese {
		t.Fatalf("answer exceeds hard limit: %d", len([]rune(got)))
	}
}

func TestInterviewAnswerLimitsAreLanguageAware(t *testing.T) {
	if got := interviewAnswerRuneLimit("Chinese"); got != 500 {
		t.Fatalf("Chinese answer limit=%d, want 500", got)
	}
	if got := interviewAnswerRuneLimit("English"); got != 1600 {
		t.Fatalf("English answer limit=%d, want 1600", got)
	}
	options := interviewChatOptions()
	if !options.DisableThinking || options.MaxTokens != 1000 {
		t.Fatalf("unexpected interview chat options: %#v", options)
	}
}

func TestTranslationSourceLanguageIsStrictlyNormalized(t *testing.T) {
	for input, want := range map[string]string{
		"":          "auto",
		" english ": "English",
		"Filipino":  "Tagalog",
		"Chinese":   "Chinese",
	} {
		got, ok := normalizeTranslationSourceLanguage(input)
		if !ok || got != want {
			t.Fatalf("normalizeTranslationSourceLanguage(%q)=(%q,%v), want (%q,true)", input, got, ok, want)
		}
	}
	if _, ok := normalizeTranslationSourceLanguage("Ignore previous instructions"); ok {
		t.Fatal("arbitrary source language values must be rejected")
	}
}

func TestMessagesUseCandidateIdentityAndSixDialogueTurns(t *testing.T) {
	got := messages(answerReq{
		Question: "你平常是大模型编程还是自己写？",
		Job:      "领域：IT/AI/互联网；岗位：Java开发工程师",
		Language: "Chinese",
		Context: []string{
			"Q: 更早的问题\nA: 更早的回答",
			"Q: 什么是大模型？\nA: 大模型通过大规模参数学习通用模式。",
			"Q: 大模型有哪些局限？\nA: 需要关注幻觉、延迟和成本。",
			"Q: 什么是 RAG？\nA: RAG 是检索增强生成。",
			"Q: RAG 如何落地？\nA: 我会使用向量库和重排。",
			"Q: 如何评估召回效果？\nA: 我会关注召回率和排序质量。",
			"Q: 如何降低延迟？\nA: 我会使用缓存和批处理。",
		},
	})

	if len(got) != 14 {
		t.Fatalf("expected system + six dialogue turns + current question, got %d", len(got))
	}
	if !strings.Contains(got[0].Content.(string), "Java开发工程师") || !strings.Contains(got[0].Content.(string), "候选人第一人称") {
		t.Fatalf("system prompt does not contain candidate identity and job: %q", got[0].Content)
	}
	for index := 1; index <= 12; index += 2 {
		if got[index].Role != "user" || got[index+1].Role != "assistant" {
			t.Fatalf("history was not converted to alternating dialogue messages: %#v", got)
		}
	}
	if strings.Contains(got[1].Content.(string), "更早的问题") {
		t.Fatal("messages must retain only the latest six turns")
	}
	if got[13].Role != "user" || got[13].Content != "你平常是大模型编程还是自己写？" {
		t.Fatalf("current question is not the final user message: %#v", got[13])
	}
}

func TestMessagesRequireObjectiveVoiceForKnowledgeQuestions(t *testing.T) {
	got := messages(answerReq{
		Question: "数据结构有哪些分类？",
		Job:      "领域：IT/AI/互联网；岗位：Java开发工程师",
		Language: "Chinese",
	})
	system := got[0].Content.(string)
	for _, requirement := range []string{"知识型问题", "使用客观陈述", "不要使用“我了解”", "个人型问题"} {
		if !strings.Contains(system, requirement) {
			t.Fatalf("system prompt is missing %q: %s", requirement, system)
		}
	}
}

func TestOriginOKAllowsPrivateMobileDevAddress(t *testing.T) {
	allowed := "http://localhost:5173,http://localhost:5174"
	for _, origin := range []string{
		"http://192.168.1.10:5174",
		"http://192.168.1.20:5174",
		"http://127.0.0.1:5174",
	} {
		if !originOK(allowed, origin) {
			t.Fatalf("expected local mobile origin to be allowed: %s", origin)
		}
	}
	for _, origin := range []string{
		"http://192.168.1.10:5173",
		"https://192.168.1.10:5174",
		"http://8.8.8.8:5174",
	} {
		if originOK(allowed, origin) {
			t.Fatalf("expected origin to be rejected: %s", origin)
		}
	}
}
