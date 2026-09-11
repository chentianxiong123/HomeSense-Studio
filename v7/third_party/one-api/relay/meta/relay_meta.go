package meta

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

type Meta struct {
	Mode         int
	ChannelType  int
	ChannelId    int
	TokenId      int
	TokenName    string
	UserId       int
	Group        string
	ModelMapping map[string]string
	// ModelParams holds admin-configured per-model request parameters
	// (max_tokens, temperature, ...), keyed by model name.
	ModelParams map[string]model.ModelParamsConfig
	// BaseURL is the proxy url set in the channel config
	BaseURL  string
	APIKey   string
	APIType  int
	Config   model.ChannelConfig
	IsStream bool
	// OriginModelName is the model name from the raw user request
	OriginModelName string
	// ActualModelName is the model name after mapping
	ActualModelName    string
	RequestURLPath     string
	PromptTokens       int // only for DoResponse
	ForcedSystemPrompt string
	StartTime          time.Time
	// InjectedModelParams is set when admin-configured per-model parameters
	// were applied to the request, forcing a re-serialized body downstream.
	InjectedModelParams bool
}

func GetByContext(c *gin.Context) *Meta {
	meta := Meta{
		Mode:               relaymode.GetByPath(c.Request.URL.Path),
		ChannelType:        c.GetInt(ctxkey.Channel),
		ChannelId:          c.GetInt(ctxkey.ChannelId),
		TokenId:            c.GetInt(ctxkey.TokenId),
		TokenName:          c.GetString(ctxkey.TokenName),
		UserId:             c.GetInt(ctxkey.Id),
		Group:              c.GetString(ctxkey.Group),
		ModelMapping:       c.GetStringMapString(ctxkey.ModelMapping),
		OriginModelName:    c.GetString(ctxkey.RequestModel),
		BaseURL:            c.GetString(ctxkey.BaseURL),
		APIKey:             strings.TrimPrefix(c.Request.Header.Get("Authorization"), "Bearer "),
		RequestURLPath:     c.Request.URL.String(),
		ForcedSystemPrompt: c.GetString(ctxkey.SystemPrompt),
		StartTime:          time.Now(),
	}
	cfg, ok := c.Get(ctxkey.Config)
	if ok {
		meta.Config = cfg.(model.ChannelConfig)
	}
	if v, ok := c.Get(ctxkey.ModelParams); ok {
		if params, ok2 := v.(map[string]model.ModelParamsConfig); ok2 {
			meta.ModelParams = params
		}
	}
	if meta.BaseURL == "" {
		meta.BaseURL = channeltype.ChannelBaseURLs[meta.ChannelType]
	}
	meta.APIType = channeltype.ToAPIType(meta.ChannelType)
	return &meta
}
