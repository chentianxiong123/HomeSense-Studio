import { useEffect } from "react"

const THEME_STYLE_OWNER_ATTR = "data-picoclaw-highlight-theme"
const THEME_STYLE_OWNER_VALUE = "true"
const MANAGED_THEME_STYLE_SELECTOR = `style[${THEME_STYLE_OWNER_ATTR}="${THEME_STYLE_OWNER_VALUE}"]`
const CHAT_CODE_BLOCK_OVERRIDES = `
[data-picoclaw-code-block] .hljs {
  background: transparent !important;
}
[data-picoclaw-code-block] pre code.hljs,
[data-picoclaw-code-block] code.hljs {
  padding: 0 !important;
  background: transparent !important;
}
`

// Web 版主题:直接内联两份 hljs 配色(取自 highlight.js github / github-dark)。
const LIGHT_THEME_CSS = `
.hljs{color:#24292e;background:#f6f8fa}
.hljs-comment,.hljs-quote{color:#6a737d}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-section{color:#d73a49}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string{color:#032f62}
.hljs-attr,.hljs-variable,.hljs-template-variable,.hljs-type,.hljs-selector-class,.hljs-selector-attr,.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-class,.hljs-title,.hljs-name{color:#6f42c1}
.hljs-built_in,.hljs-builtin-name,.hljs-strong,.hljs-emphasis,.hljs-meta,.hljs-title.function_{color:#005cc5}
.hljs-tag,.hljs-selector-id{color:#22863a}
.hljs-deletion{color:#b31d28}
.hljs-doctag{color:#6a737d}
`
const DARK_THEME_CSS = `
.hljs{color:#c9d1d9;background:#0d1117}
.hljs-comment,.hljs-quote{color:#8b949e}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-section{color:#ff7b72}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string{color:#a5d6ff}
.hljs-attr,.hljs-variable,.hljs-template-variable,.hljs-type,.hljs-selector-class,.hljs-selector-attr,.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-class,.hljs-title,.hljs-name{color:#d2a8ff}
.hljs-built_in,.hljs-builtin-name,.hljs-strong,.hljs-emphasis,.hljs-meta,.hljs-title.function_{color:#79c0ff}
.hljs-tag,.hljs-selector-id{color:#7ee787}
.hljs-deletion{color:#ffa198}
.hljs-doctag{color:#8b949e}
`

function getOrCreateThemeStyleElement(): HTMLStyleElement {
  const managedStyleElement = document.head.querySelector<HTMLStyleElement>(
    MANAGED_THEME_STYLE_SELECTOR,
  )
  if (managedStyleElement) {
    return managedStyleElement
  }
  const styleElement = document.createElement("style")
  styleElement.setAttribute(THEME_STYLE_OWNER_ATTR, THEME_STYLE_OWNER_VALUE)
  document.head.appendChild(styleElement)
  return styleElement
}

export function useHighlightTheme() {
  useEffect(() => {
    const root = document.documentElement
    const styleElement = getOrCreateThemeStyleElement()

    const applyTheme = () => {
      const nextThemeCss = root.classList.contains("dark")
        ? DARK_THEME_CSS
        : LIGHT_THEME_CSS
      styleElement.textContent = `${nextThemeCss}\n${CHAT_CODE_BLOCK_OVERRIDES}`
    }

    applyTheme()

    const observer = new MutationObserver(() => {
      applyTheme()
    })
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })

    return () => {
      observer.disconnect()
    }
  }, [])
}