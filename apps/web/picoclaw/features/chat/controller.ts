// PicoClaw chat controller — pi 引擎适配版
//
// 对外接口与原版完全一致(usePicoChat 的依赖),底层全部委托给
// pi-bridge(REST + SSE)。组件层调用方无需任何改动。

export {
  connectChat,
  disconnectChat,
  hydrateActiveSession,
  initializeChatStore,
  newChatSession,
  sendChatMessage,
  switchChatSession,
  teardownChatStore,
} from "@pico/features/chat/pi-bridge"