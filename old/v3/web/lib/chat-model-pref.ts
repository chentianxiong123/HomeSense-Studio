// 用户侧热切换：前端记住当前选的模型，随每条消息带给云大脑，
// 云端只对这条消息生效（不写云端全局配置）。

const STORAGE_KEY = "hs-chat-model"

export function getStoredChatModel(): string {
  try {
    return (localStorage.getItem(STORAGE_KEY) ?? "").trim()
  } catch {
    return ""
  }
}

export function setStoredChatModel(modelName: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, modelName.trim())
  } catch {
    /* 忽略 */
  }
}

export function clearStoredChatModel(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
}