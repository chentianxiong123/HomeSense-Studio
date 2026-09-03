import { IconKey } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@pico/components/page-header"

// 凭据页占位。v3 现在用管理员统一配置的全局模型(BYO/第三方联动以后再做),
// 不再需要 OAuth / token 卡片,全部清空。
export function CredentialsPage() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("navigation.credentials")} />
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="text-muted-foreground flex max-w-md flex-col items-center gap-3 text-center">
          <IconKey className="size-8 opacity-50" />
          <p className="text-sm">
            {t("credentials.placeholder")}
          </p>
        </div>
      </div>
    </div>
  )
}
