package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const DefaultAdminUsername = "admin"

type Config struct {
	Addr, DatabasePath, JWTSecret, AdminUsername, AdminToken, AdminAllowIPs, AllowOrigin, MobileBaseURL string
	SupportQQ, SupportWeChat, SupportEmail                                                              string
	FeedbackNotifyEmail, FeedbackNotifyWebhook, FeedbackNotifyWebhookType                               string
	SMTPHost, SMTPUsername, SMTPPassword, SMTPFrom                                                      string
	SMTPPort                                                                                            int
	DeepSeekKey, DeepSeekURL, DeepSeekModel, AnswerModels                                               string
	ZhipuKey, ZhipuURL, ZhipuVisionModels, ZhipuAudioURL, ZhipuASRModel                                 string
	DashscopeKey, DashscopeURL, TranslationModels, WrittenVisionModels                                  string
	DashscopeKeys                                                                                       []string
	WrittenSolverModels                                                                                 string
	WrittenSolverRetries                                                                                int
	WrittenSolverAttemptTimeout                                                                         time.Duration
	WrittenAnswerThinking, WrittenSolverThinking                                                        bool
	AliyunASRURL, AliyunASRModel                                                                        string
	AliyunASRMaxSilenceMS                                                                               int
	TokenTTL                                                                                            time.Duration
	MaxUpload                                                                                           int64
	AllowMock                                                                                           bool
}

func Load() (Config, error) {
	c := Config{Addr: env("BIND_ADDR", "") + ":" + env("PORT", "3001"), DatabasePath: env("DATABASE_PATH", "./data/miaoda.sqlite"), JWTSecret: strings.TrimSpace(os.Getenv("MIAODA_JWT_SECRET")), AdminUsername: strings.TrimSpace(env("MIAODA_ADMIN_USERNAME", DefaultAdminUsername)), AdminToken: strings.TrimSpace(os.Getenv("MIAODA_ADMIN_TOKEN")), AdminAllowIPs: strings.TrimSpace(os.Getenv("ADMIN_ALLOW_IPS")), AllowOrigin: env("ALLOW_ORIGIN", "http://localhost:5173"), MobileBaseURL: env("MOBILE_BASE_URL", "http://localhost:5173"), SupportQQ: strings.TrimSpace(env("SUPPORT_QQ", "")), SupportWeChat: strings.TrimSpace(env("SUPPORT_WECHAT", "")), SupportEmail: env("SUPPORT_EMAIL", ""), FeedbackNotifyEmail: strings.TrimSpace(os.Getenv("FEEDBACK_NOTIFY_EMAIL")), FeedbackNotifyWebhook: strings.TrimSpace(os.Getenv("FEEDBACK_NOTIFY_WEBHOOK")), FeedbackNotifyWebhookType: strings.ToLower(env("FEEDBACK_NOTIFY_WEBHOOK_TYPE", "generic")), SMTPHost: strings.TrimSpace(os.Getenv("SMTP_HOST")), SMTPPort: envInt("SMTP_PORT", 587), SMTPUsername: strings.TrimSpace(os.Getenv("SMTP_USERNAME")), SMTPPassword: os.Getenv("SMTP_PASSWORD"), SMTPFrom: strings.TrimSpace(os.Getenv("SMTP_FROM")), DeepSeekKey: os.Getenv("DEEPSEEK_API_KEY"), DeepSeekURL: env("DEEPSEEK_BASE_URL", "https://api.deepseek.com"), DeepSeekModel: env("DEEPSEEK_MODEL", "deepseek-v4-flash"), AnswerModels: env("ANSWER_MODELS", "deepseek:deepseek-v4-flash,deepseek:deepseek-v4-pro,aliyun:qwen3.7-plus"), ZhipuKey: first(os.Getenv("ZHIPU_API_KEY"), os.Getenv("BIGMODEL_API_KEY")), ZhipuURL: env("ZHIPU_BASE_URL", "https://api.z.ai/api/paas/v4"), ZhipuVisionModels: env("ZHIPU_VISION_MODELS", "glm-4.6v-flashx"), ZhipuAudioURL: env("ZHIPU_AUDIO_BASE_URL", "https://api.z.ai/api/paas/v4"), ZhipuASRModel: env("ZHIPU_ASR_MODEL", "glm-asr-2512"), DashscopeKey: os.Getenv("DASHSCOPE_API_KEY"), DashscopeURL: env("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"), TranslationModels: env("TRANSLATION_MODELS", "aliyun:qwen-mt-lite"), WrittenVisionModels: env("WRITTEN_VISION_MODELS", "aliyun:qwen3-vl-flash,zhipu:glm-4.6v-flashx"), WrittenSolverModels: env("WRITTEN_SOLVER_MODELS", "aliyun:qwen3.7-plus,aliyun:qwen3.6-plus"), WrittenSolverRetries: envNonNegativeInt("WRITTEN_SOLVER_RETRIES", 1), WrittenSolverAttemptTimeout: time.Duration(envInt("WRITTEN_SOLVER_ATTEMPT_TIMEOUT_SECONDS", 60)) * time.Second, WrittenAnswerThinking: strings.EqualFold(os.Getenv("WRITTEN_ANSWER_THINKING"), "true"), WrittenSolverThinking: strings.EqualFold(env("WRITTEN_SOLVER_THINKING", env("WRITTEN_ANSWER_THINKING", "true")), "true"), TokenTTL: time.Duration(envInt("TOKEN_TTL_HOURS", 12)) * time.Hour, MaxUpload: int64(envInt("MAX_UPLOAD_MB", 3)) << 20, AllowMock: strings.EqualFold(os.Getenv("ALLOW_MODEL_MOCK"), "true")}
	c.DashscopeKeys = uniqueCSV(c.DashscopeKey + "," + os.Getenv("DASHSCOPE_API_KEYS"))
	if c.DashscopeKey == "" && len(c.DashscopeKeys) > 0 {
		c.DashscopeKey = c.DashscopeKeys[0]
	}
	c.AliyunASRURL = env("ALIYUN_ASR_URL", "wss://dashscope.aliyuncs.com/api-ws/v1/inference/")
	c.AliyunASRModel = env("ALIYUN_ASR_MODEL", "fun-asr-realtime")
	c.AliyunASRMaxSilenceMS = envInt("ALIYUN_ASR_MAX_SENTENCE_SILENCE_MS", 800)
	if len(c.JWTSecret) < 32 {
		return c, fmt.Errorf("MIAODA_JWT_SECRET must contain at least 32 characters")
	}
	if c.AdminToken != "" && len(c.AdminToken) < 32 {
		return c, fmt.Errorf("MIAODA_ADMIN_TOKEN must contain at least 32 characters when configured")
	}
	if c.AdminUsername == "" || len([]byte(c.AdminUsername)) > 128 {
		return c, fmt.Errorf("MIAODA_ADMIN_USERNAME must contain between 1 and 128 bytes")
	}
	if strings.Contains(c.AllowOrigin, "*") {
		return c, fmt.Errorf("ALLOW_ORIGIN must list explicit origins; wildcard origins are not allowed")
	}
	return c, nil
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func envInt(k string, d int) int {
	v, e := strconv.Atoi(os.Getenv(k))
	if e == nil && v > 0 {
		return v
	}
	return d
}

func envNonNegativeInt(k string, d int) int {
	v, e := strconv.Atoi(os.Getenv(k))
	if e == nil && v >= 0 {
		return v
	}
	return d
}

func uniqueCSV(value string) []string {
	seen := map[string]bool{}
	var values []string
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		values = append(values, item)
	}
	return values
}
func first(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
