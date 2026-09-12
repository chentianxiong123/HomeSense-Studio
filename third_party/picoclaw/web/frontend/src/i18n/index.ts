import dayjs from "dayjs"
import "dayjs/locale/zh-cn"
import localizedFormat from "dayjs/plugin/localizedFormat"
import relativeTime from "dayjs/plugin/relativeTime"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import zh from "./locales/zh.json"

dayjs.extend(relativeTime)
dayjs.extend(localizedFormat)
dayjs.locale("zh-cn")

i18n.use(initReactI18next).init({
  resources: {
    zh: {
      translation: zh,
    },
  },
  lng: "zh",
  fallbackLng: "zh",
  debug: false,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
